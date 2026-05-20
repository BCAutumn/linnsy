import type { ChatAppState } from '../../stores/chat-app-state.js';
import { getConversationDisplayName } from '../../lib/conversation-list.js';
import { t, type Locale } from '../../lib/i18n.js';

export function createTerminalBindingOptions(
  state: ChatAppState,
  locale: Locale
): ReadonlyArray<{ value: string; text: string }> {
  if (state.conversations.length === 0) {
    return [{ value: '', text: t(locale, 'conversationEmpty') }];
  }
  return state.conversations.map((conversation) => ({
    value: conversation.conversationId,
    text: getConversationDisplayName(conversation)
  }));
}
