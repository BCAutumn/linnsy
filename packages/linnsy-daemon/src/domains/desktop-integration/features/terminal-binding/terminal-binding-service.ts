import type { ConversationRecord, ConversationStorePort } from '../../../../persistence/stores/conversation/conversation-store-port.js';
import type {
  TerminalBindingStorePort,
  TerminalBindingRecord
} from '../../persistence/terminal-binding/terminal-binding-store-port.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { LinnsyMessage, Platform } from '../../../../shared/messaging.js';
import type { ClockPort, LoggerPort } from '../../../../shared/ports.js';
import { consoleLogger, systemClock } from '../../../../shared/ports.js';
import type { SessionLookup, SessionRouterPort } from '../../../conversation/features/session-routing/types.js';

export const MOBILE_TERMINAL_ID = 'mobile';

const MOBILE_TERMINAL_PLATFORMS = new Set<Platform>(['wechat', 'feishu', 'telegram']);

export interface TerminalBindingSnapshot {
  terminalId: string;
  conversationId: string;
  updatedAt: number;
  updatedBy: string;
}

export interface TerminalBindingServicePort {
  ensureDefaultBinding(): Promise<TerminalBindingSnapshot>;
  getBinding(): Promise<TerminalBindingSnapshot>;
  bindToConversation(conversationId: string, updatedBy: string): Promise<TerminalBindingSnapshot>;
  resolveInboundSession(message: LinnsyMessage): Promise<SessionLookup | null>;
}

export interface CreateTerminalBindingServiceOptions {
  bindings: TerminalBindingStorePort;
  conversations: ConversationStorePort;
  sessionRouter: SessionRouterPort;
  clock?: ClockPort;
  logger?: LoggerPort;
}

export function createTerminalBindingService(
  options: CreateTerminalBindingServiceOptions
): TerminalBindingServicePort {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? consoleLogger;

  async function ensureDefaultBinding(): Promise<TerminalBindingSnapshot> {
    const existing = await options.bindings.get(MOBILE_TERMINAL_ID);
    if (existing !== null && await conversationExists(existing.conversationId)) {
      return toSnapshot(existing);
    }

    const defaultSession = await options.sessionRouter.resolve({
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:main',
      metadata: { createdBy: 'mobile-terminal-default-binding' }
    });
    const record = createBindingRecord(defaultSession.conversationId, 'system-default');
    await options.bindings.upsert(record);
    logger.info('mobile terminal default binding ensured', {
      terminalId: record.terminalId,
      conversationId: record.conversationId
    });
    return toSnapshot(record);
  }

  async function getBinding(): Promise<TerminalBindingSnapshot> {
    return ensureDefaultBinding();
  }

  async function bindToConversation(conversationId: string, updatedBy: string): Promise<TerminalBindingSnapshot> {
    const conversation = await options.conversations.get(conversationId);
    if (conversation === null || conversation.archivedAt !== undefined) {
      throw new LinnsyError(
        LINNSY_ERROR_CODES.SESSION_NOT_FOUND,
        `conversation ${conversationId} does not exist`,
        false
      );
    }
    const record = createBindingRecord(conversation.conversationId, updatedBy);
    await options.bindings.upsert(record);
    logger.info('mobile terminal binding changed', {
      terminalId: record.terminalId,
      conversationId: record.conversationId,
      updatedBy
    });
    return toSnapshot(record);
  }

  async function resolveInboundSession(message: LinnsyMessage): Promise<SessionLookup | null> {
    if (!isMobileTerminalPlatform(message.platform)) {
      return null;
    }
    const binding = await ensureDefaultBinding();
    return options.sessionRouter.resolveConversation({
      conversationId: binding.conversationId,
      ...(message.userId === undefined ? {} : { userId: message.userId }),
      ...(message.metadata === undefined ? {} : { metadata: message.metadata })
    });
  }

  function createBindingRecord(conversationId: string, updatedBy: string): TerminalBindingRecord {
    return {
      terminalId: MOBILE_TERMINAL_ID,
      conversationId,
      updatedAt: clock.now(),
      updatedBy
    };
  }

  async function conversationExists(conversationId: string): Promise<boolean> {
    const conversation: ConversationRecord | null = await options.conversations.get(conversationId);
    return conversation !== null && conversation.archivedAt === undefined;
  }

  return {
    ensureDefaultBinding,
    getBinding,
    bindToConversation,
    resolveInboundSession
  };
}

function isMobileTerminalPlatform(platform: Platform): boolean {
  return MOBILE_TERMINAL_PLATFORMS.has(platform);
}

function toSnapshot(record: TerminalBindingRecord): TerminalBindingSnapshot {
  return {
    terminalId: record.terminalId,
    conversationId: record.conversationId,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy
  };
}
