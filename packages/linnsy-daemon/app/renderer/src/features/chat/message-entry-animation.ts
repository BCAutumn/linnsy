// 消息入场动画只服务“实时新增 item”。
// 历史回放 / 切换会话 / daemon 重启后的整批 hydrate 都应直接稳定显示，避免整屏重播动画。

import type { ConversationItem } from './projection/types.js';

export interface MessageEntryAnimationEntry {
  itemId: string;
  continuityKey: string;
}

export interface MessageEntryAnimationState {
  initialized: boolean;
  resetKey: string | null;
  seenItemIds: ReadonlySet<string>;
  previousEntries: readonly MessageEntryAnimationEntry[];
}

export interface MessageEntryAnimationResult {
  animatedItemIds: ReadonlySet<string>;
  nextState: MessageEntryAnimationState;
}

export function createInitialMessageEntryAnimationState(): MessageEntryAnimationState {
  return {
    initialized: false,
    resetKey: null,
    seenItemIds: new Set(),
    previousEntries: []
  };
}

export function deriveMessageEntryAnimation(
  state: MessageEntryAnimationState,
  resetKey: string | null,
  entries: readonly MessageEntryAnimationEntry[]
): MessageEntryAnimationResult {
  const nextSeenItemIds = new Set(state.seenItemIds);
  for (const entry of entries) {
    nextSeenItemIds.add(entry.itemId);
  }
  if (!state.initialized || state.resetKey !== resetKey) {
    return {
      animatedItemIds: new Set(),
      nextState: {
        initialized: true,
        resetKey,
        seenItemIds: new Set(entries.map((entry) => entry.itemId)),
        previousEntries: entries
      }
    };
  }

  const animatedItemIds = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (state.seenItemIds.has(entry.itemId)) continue;
    const previousAtSameIndex = state.previousEntries[index];
    const isContinuousReplacement = previousAtSameIndex?.continuityKey === entry.continuityKey;
    if (!isContinuousReplacement) {
      animatedItemIds.add(entry.itemId);
    }
  }

  return {
    animatedItemIds,
    nextState: {
      initialized: true,
      resetKey,
      seenItemIds: nextSeenItemIds,
      previousEntries: entries
    }
  };
}

export function toMessageEntryAnimationEntries(
  items: readonly ConversationItem[]
): readonly MessageEntryAnimationEntry[] {
  return items.map((item) => ({
    itemId: item.id,
    continuityKey: continuityKeyForItem(item)
  }));
}

function continuityKeyForItem(item: ConversationItem): string {
  if (item.kind === 'assistant_bubble') {
    return `assistant:${item.conversationId}:${item.runId}`;
  }
  return `${item.kind}:${item.id}`;
}
