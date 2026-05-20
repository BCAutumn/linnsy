import type { ChatAppState } from '../stores/chat-app-state.js';
import type {
  ConversationMessage,
  ConversationSummary,
  DaemonApiClient,
  TerminalBindingSnapshot,
  UiPreferences
} from '../lib/daemon-api.js';
import type { RuntimeEventEnvelope } from '@renderer/contracts';
import type { ApplicationConnectionsSnapshot } from '@renderer/contracts';
import { historyEventHydrationLimit } from '../lib/history-hydration.js';
export { defaultPreferences } from '../stores/default-preferences.js';

export interface InitialDesktopData {
  preferences: UiPreferences;
  conversations: ChatAppState['conversations'];
  terminalBinding: TerminalBindingSnapshot;
  applicationConnections: ApplicationConnectionsSnapshot;
  selectedConversationId: string | null;
  messages: ConversationMessage[];
  // S2.4 起追加：events 表里的 tool_call.* / subagent.* / system.event。
  // 旧 daemon 不存在该 endpoint 时降级为空数组（caller 已做兜底）。
  events: RuntimeEventEnvelope[];
}

export async function loadInitialDesktopData(
  client: DaemonApiClient,
  onRetry: () => void,
  options: { timeoutMs?: number; retryIntervalMs?: number } = {}
): Promise<InitialDesktopData> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const retryIntervalMs = options.retryIntervalMs ?? 300;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      return await loadDesktopDataSnapshot(client, {
        currentSelectedConversationId: null,
        pendingDesktopConversation: false
      });
    } catch (error: unknown) {
      if (!isRetryableConnectionError(error)) {
        throw error;
      }
      lastError = error;
      onRetry();
      await delay(retryIntervalMs);
    }
  }

  throw lastError;
}

export async function loadDesktopDataForState(
  client: DaemonApiClient,
  state: ChatAppState
): Promise<InitialDesktopData> {
  return loadDesktopDataSnapshot(client, {
    currentSelectedConversationId: state.selectedConversationId,
    pendingDesktopConversation: state.pendingDesktopConversation
  });
}

export function isRetryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('load failed')
    || message.includes('econnrefused');
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function loadDesktopDataSnapshot(
  client: DaemonApiClient,
  selection: {
    currentSelectedConversationId: string | null;
    pendingDesktopConversation: boolean;
  }
): Promise<InitialDesktopData> {
  const [preferences, terminalBinding, applicationConnections] = await Promise.all([
    client.getUiPreferences(),
    client.getTerminalBinding(),
    client.getApplicationConnections()
  ]);
  const conversations = await client.listConversations();
  const selectedConversationId = resolveSelectedConversationId({
    conversations,
    preferences,
    currentSelectedConversationId: selection.currentSelectedConversationId,
    pendingDesktopConversation: selection.pendingDesktopConversation
  });
  const [messages, events] = selectedConversationId === null
    ? [[] as ConversationMessage[], [] as RuntimeEventEnvelope[]]
    : await Promise.all([
        client.readMessages(selectedConversationId),
        client.readEvents(selectedConversationId, { limit: historyEventHydrationLimit }).catch(() => [] as RuntimeEventEnvelope[])
      ]);
  return {
    preferences,
    conversations,
    terminalBinding,
    applicationConnections,
    selectedConversationId,
    messages,
    events
  };
}

function resolveSelectedConversationId(input: {
  conversations: readonly ConversationSummary[];
  preferences: UiPreferences;
  currentSelectedConversationId: string | null;
  pendingDesktopConversation: boolean;
}): string | null {
  const conversationIds = new Set(input.conversations.map((conversation) => conversation.conversationId));
  if (input.pendingDesktopConversation) {
    return null;
  }
  if (
    input.currentSelectedConversationId !== null
    && conversationIds.has(input.currentSelectedConversationId)
  ) {
    return input.currentSelectedConversationId;
  }
  if (
    input.preferences.last_opened_conversation_id !== null
    && conversationIds.has(input.preferences.last_opened_conversation_id)
  ) {
    return input.preferences.last_opened_conversation_id;
  }
  return input.conversations[0]?.conversationId ?? null;
}
