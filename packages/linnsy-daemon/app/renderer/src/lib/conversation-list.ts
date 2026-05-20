import type { ConversationSummary } from './daemon-api.js';

export function orderConversationsForSidebar(
  conversations: ConversationSummary[],
  boundConversationId: string | null,
  options: { includeArchived?: boolean } = {}
): ConversationSummary[] {
  const visible = options.includeArchived === true
    ? conversations
    : conversations.filter((conversation) => conversation.archivedAt === undefined);
  return [...visible].sort((left, right) => {
    const leftRank = readSidebarConversationRank(left, boundConversationId);
    const rightRank = readSidebarConversationRank(right, boundConversationId);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    if (leftRank === 1) {
      return (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0);
    }
    return right.lastActivityAt - left.lastActivityAt;
  });
}

function readSidebarConversationRank(
  conversation: ConversationSummary,
  boundConversationId: string | null
): 0 | 1 | 2 {
  if (conversation.conversationId === boundConversationId) {
    return 0;
  }
  if (conversation.pinnedAt !== undefined) {
    return 1;
  }
  return 2;
}

export function getConversationDisplayName(conversation: ConversationSummary): string {
  const title = conversation.title?.trim();
  if (title !== undefined && title.length > 0) {
    return title;
  }
  return conversation.platform;
}
