const DEFAULT_LARGE_CONVERSATION_THRESHOLD = 300;

const warnedConversationIds = new Set<string>();

export interface LargeConversationWarningOptions {
  conversationId: string | null;
  itemCount: number;
  enabled?: boolean;
  threshold?: number;
  warn?: (message: string, detail: LargeConversationWarningDetail) => void;
}

export interface LargeConversationWarningDetail {
  conversationId: string;
  itemCount: number;
  threshold: number;
}

export function maybeWarnLargeConversation(options: LargeConversationWarningOptions): void {
  const enabled = options.enabled ?? isChatRenderObserverEnabled();
  const threshold = options.threshold ?? DEFAULT_LARGE_CONVERSATION_THRESHOLD;
  const warn = options.warn ?? console.warn;
  const { conversationId, itemCount } = options;

  if (!enabled || conversationId === null || itemCount <= threshold || warnedConversationIds.has(conversationId)) {
    return;
  }

  warnedConversationIds.add(conversationId);
  warn('[linnsy chat] large conversation render observation point', {
    conversationId,
    itemCount,
    threshold
  });
}

export function resetLargeConversationWarningsForTest(): void {
  warnedConversationIds.clear();
}

function isChatRenderObserverEnabled(): boolean {
  return import.meta.env.DEV;
}
