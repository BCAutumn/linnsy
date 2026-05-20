import type {
  ConversationPermanentDeleteResult,
  ConversationRecord,
  ConversationStorePort
} from '../../../../persistence/stores/conversation/conversation-store-port.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { ClockPort } from '../../../../shared/ports.js';
import { systemClock } from '../../../../shared/ports.js';

export interface ConversationManagementPort {
  rename(conversationId: string, title: string | null): Promise<ConversationRecord>;
  setPinned(conversationId: string, pinned: boolean): Promise<ConversationRecord>;
  archive(conversationId: string): Promise<ConversationRecord>;
  permanentDelete(conversationId: string): Promise<void>;
}

export interface ConversationTerminalBindingLookupPort {
  getBinding(): Promise<{ conversationId: string }>;
}

export interface ConversationPromptInvalidationPort {
  invalidate(conversationId: string): void;
}

export interface CreateConversationManagementServiceOptions {
  conversations: ConversationStorePort;
  terminalBinding: ConversationTerminalBindingLookupPort;
  systemPromptAssembler?: ConversationPromptInvalidationPort;
  clock?: ClockPort;
}

const CONVERSATION_TITLE_MAX_LENGTH = 100;
const ACTIVE_RUN_STATUSES = ['pending', 'running', 'awaiting_user'] as const;
const ACTIVE_TASK_STATUSES = ['received', 'dispatched', 'in_progress', 'paused'] as const;

export function createConversationManagementService(
  options: CreateConversationManagementServiceOptions
): ConversationManagementPort {
  const clock = options.clock ?? systemClock;

  async function rename(conversationId: string, title: string | null): Promise<ConversationRecord> {
    const normalized = normalizeConversationTitle(title);
    const now = clock.now();
    const renamed = await options.conversations.rename(conversationId, normalized, now);
    if (!renamed) {
      throwConversationNotFound(conversationId);
    }
    options.systemPromptAssembler?.invalidate(conversationId);
    return readExistingConversation(options.conversations, conversationId);
  }

  async function setPinned(conversationId: string, pinned: boolean): Promise<ConversationRecord> {
    const now = clock.now();
    const updated = await options.conversations.setPinned(conversationId, pinned ? now : null, now);
    if (!updated) {
      throwConversationNotFound(conversationId);
    }
    return readExistingConversation(options.conversations, conversationId);
  }

  async function archive(conversationId: string): Promise<ConversationRecord> {
    await assertNotTerminalBound(conversationId, LINNSY_ERROR_CODES.CONVERSATION_ARCHIVE_TERMINAL_BOUND);
    const archivedAt = clock.now();
    const archived = await options.conversations.archive(conversationId, archivedAt);
    if (!archived) {
      throwConversationNotFound(conversationId);
    }
    options.systemPromptAssembler?.invalidate(conversationId);
    return readExistingConversation(options.conversations, conversationId);
  }

  async function permanentDelete(conversationId: string): Promise<void> {
    await assertNotTerminalBound(conversationId, LINNSY_ERROR_CODES.CONVERSATION_DELETE_TERMINAL_BOUND);
    const result = await options.conversations.permanentDeleteShortTermData(conversationId, {
      activeRunStatuses: ACTIVE_RUN_STATUSES,
      activeTaskStatuses: ACTIVE_TASK_STATUSES
    });
    assertPermanentDeleteSucceeded(conversationId, result);
    options.systemPromptAssembler?.invalidate(conversationId);
  }

  async function assertNotTerminalBound(conversationId: string, code: string): Promise<void> {
    const binding = await options.terminalBinding.getBinding();
    if (binding.conversationId !== conversationId) {
      return;
    }
    throw new LinnsyError(code, `conversation ${conversationId} is bound to the mobile terminal`, false);
  }

  return {
    rename,
    setPinned,
    archive,
    permanentDelete
  };
}

function assertPermanentDeleteSucceeded(
  conversationId: string,
  result: ConversationPermanentDeleteResult
): void {
  if (result.status === 'deleted') {
    return;
  }
  if (result.status === 'not_found') {
    throwConversationNotFound(conversationId);
  }
  throw new LinnsyError(
    LINNSY_ERROR_CODES.CONVERSATION_DELETE_HAS_ACTIVE_RUN,
    '还有正在进行的任务，请先停掉再删除',
    false
  );
}

function normalizeConversationTitle(title: string | null): string | null {
  if (title === null) {
    return null;
  }
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length > CONVERSATION_TITLE_MAX_LENGTH) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.CONVERSATION_TITLE_INVALID,
      `conversation title must be at most ${String(CONVERSATION_TITLE_MAX_LENGTH)} characters`,
      false
    );
  }
  return normalized;
}

async function readExistingConversation(
  conversations: ConversationStorePort,
  conversationId: string
): Promise<ConversationRecord> {
  const record = await conversations.get(conversationId);
  if (record === null) {
    throwConversationNotFound(conversationId);
  }
  return record;
}

function throwConversationNotFound(conversationId: string): never {
  throw new LinnsyError(
    LINNSY_ERROR_CODES.CONVERSATION_NOT_FOUND,
    `conversation ${conversationId} does not exist`,
    false
  );
}
