import type { ConversationSummary } from '../daemon-api.js';

export function upsertConversation(
  conversations: ConversationSummary[],
  incoming: ConversationSummary
): ConversationSummary[] {
  const found = conversations.some((conversation) => conversation.conversationId === incoming.conversationId);
  const next = found
    ? conversations.map((conversation) => conversation.conversationId === incoming.conversationId ? incoming : conversation)
    : [incoming, ...conversations];
  return next.sort((left, right) => right.lastActivityAt - left.lastActivityAt);
}

export function moveConversationToTopAfterMessage(
  conversations: ConversationSummary[],
  conversationId: string | undefined,
  message: {
    text: string;
    role: string;
    source: string;
    updatedAt: number;
  }
): ConversationSummary[] {
  if (conversationId === undefined) {
    return conversations;
  }
  const normalizedText = message.text.trim().replace(/\s+/g, ' ');
  const updated = conversations.map((conversation) => conversation.conversationId === conversationId
    ? {
        ...conversation,
        ...(shouldSetConversationTitle(conversation, message, normalizedText)
          ? { title: normalizedText }
          : {}),
        updatedAt: Math.max(conversation.updatedAt, message.updatedAt),
        lastActivityAt: Math.max(conversation.lastActivityAt, message.updatedAt)
      }
    : conversation);
  return updated.sort((left, right) => right.lastActivityAt - left.lastActivityAt);
}

export function markConversationVisibleActivity(
  conversations: ConversationSummary[],
  conversationId: string | undefined,
  activityAt: number
): ConversationSummary[] {
  if (conversationId === undefined) {
    return conversations;
  }
  const target = conversations.find((conversation) => conversation.conversationId === conversationId);
  if (target === undefined) {
    return conversations;
  }
  const updatedAt = Math.max(target.updatedAt, activityAt);
  const lastActivityAt = Math.max(target.lastActivityAt, activityAt);
  if (updatedAt === target.updatedAt && lastActivityAt === target.lastActivityAt) {
    return conversations;
  }
  const updated = conversations.map((conversation) => conversation.conversationId === conversationId
    ? {
        ...conversation,
        updatedAt,
        lastActivityAt
      }
    : conversation);
  return updated.sort((left, right) => right.lastActivityAt - left.lastActivityAt);
}

function shouldSetConversationTitle(
  conversation: ConversationSummary,
  message: { role: string; source: string },
  normalizedText: string
): boolean {
  return normalizedText.length > 0
    && message.role === 'user'
    && message.source === 'inbound'
    && (conversation.title === undefined || conversation.title.trim().length === 0);
}
