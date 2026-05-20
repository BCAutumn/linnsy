import { describe, expect, test } from 'vitest';

import type { ConversationSummary } from '../daemon-api.js';
import { orderConversationsForSidebar } from '../conversation-list.js';

describe('orderConversationsForSidebar', () => {
  test('keeps the mobile-bound conversation first, then pinned, then normal conversations', () => {
    const ordered = orderConversationsForSidebar([
      conversation({ conversationId: 'normal_old', updatedAt: 1 }),
      conversation({ conversationId: 'pinned_old', updatedAt: 2, pinnedAt: 20 }),
      conversation({ conversationId: 'bound', updatedAt: 3 }),
      conversation({ conversationId: 'pinned_new', updatedAt: 4, pinnedAt: 30 }),
      conversation({ conversationId: 'normal_new', updatedAt: 5 })
    ], 'bound');

    expect(ordered.map((item) => item.conversationId)).toEqual([
      'bound',
      'pinned_new',
      'pinned_old',
      'normal_new',
      'normal_old'
    ]);
  });

  test('hides archived conversations by default', () => {
    const ordered = orderConversationsForSidebar([
      conversation({ conversationId: 'archived', archivedAt: 10, updatedAt: 100 }),
      conversation({ conversationId: 'visible', updatedAt: 1 })
    ], null);

    expect(ordered.map((item) => item.conversationId)).toEqual(['visible']);
    expect(orderConversationsForSidebar([
      conversation({ conversationId: 'archived', archivedAt: 10, updatedAt: 100 }),
      conversation({ conversationId: 'visible', updatedAt: 1 })
    ], null, { includeArchived: true }).map((item) => item.conversationId)).toEqual(['archived', 'visible']);
  });

  test('orders normal conversations by visible activity time instead of record update time', () => {
    const ordered = orderConversationsForSidebar([
      conversation({ conversationId: 'renamed_recently', updatedAt: 100, lastActivityAt: 1 }),
      conversation({ conversationId: 'talked_recently', updatedAt: 2, lastActivityAt: 50 })
    ], null);

    expect(ordered.map((item) => item.conversationId)).toEqual(['talked_recently', 'renamed_recently']);
  });
});

function conversation(input: Partial<ConversationSummary> & { conversationId: string }): ConversationSummary {
  const updatedAt = input.updatedAt ?? 1;
  return {
    platform: 'desktop',
    chatType: 'private',
    chatId: input.conversationId,
    updatedAt,
    lastActivityAt: input.lastActivityAt ?? updatedAt,
    ...input
  };
}
