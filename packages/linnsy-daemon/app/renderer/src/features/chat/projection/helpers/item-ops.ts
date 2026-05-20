// ProjectionState 上的不可变操作集。
// 任何修改 state 的代码都必须经此处函数返回新 state，禁止 reducer 自己写 new Map(...) 拼装。

import type { ProjectionState } from '../state.js';
import type { ConversationItem } from '../types.js';

import { completeThoughtChunks } from './thought-ops.js';

// 追加 item 到末尾。若 itemId 已存在则视为编程错误（reducer 应该走 replaceItem 而非 appendItem）。
export function appendItem(state: ProjectionState, item: ConversationItem): ProjectionState {
  if (state.itemsById.has(item.id)) {
    return replaceItem(state, item);
  }
  const nextItems = new Map(state.itemsById);
  nextItems.set(item.id, item);
  return {
    ...state,
    itemsById: nextItems,
    itemOrder: [...state.itemOrder, item.id]
  };
}

// 原地替换 item 内容（保持 itemOrder 不变）。
export function replaceItem(state: ProjectionState, item: ConversationItem): ProjectionState {
  if (!state.itemsById.has(item.id)) {
    return appendItem(state, item);
  }
  const nextItems = new Map(state.itemsById);
  nextItems.set(item.id, item);
  return {
    ...state,
    itemsById: nextItems
  };
}

// 把一个 itemId 从 itemOrder 中移除并删 itemsById（用于 optimistic→authoritative 切换时的旧槽清理）。
// itemOrder 中保留新 itemId 在原位置（caller 通过 swapItemId 一次性完成 ID 切换 + 替换 payload）。
export function removeItem(state: ProjectionState, itemId: string): ProjectionState {
  if (!state.itemsById.has(itemId)) {
    return state;
  }
  const nextItems = new Map(state.itemsById);
  nextItems.delete(itemId);
  return {
    ...state,
    itemsById: nextItems,
    itemOrder: state.itemOrder.filter((id) => id !== itemId)
  };
}

// 在 itemOrder 中把 oldId 的位置原地切换为 newItem.id，并更新 itemsById。
// 用于：
//   - optimistic 局部消息（id=clientMessageId）→ 后端权威消息（id=messageId）
//   - 流式 AssistantBubble（id=`stream:${runId}:${answerId}`）→ complete 后的 messageId
// 永不 push 到末尾——保证多答复段、跨 turn 顺序稳定（守坑 #7）。
export function swapItemId(
  state: ProjectionState,
  oldId: string,
  newItem: ConversationItem
): ProjectionState {
  if (oldId === newItem.id) {
    return replaceItem(state, newItem);
  }
  const nextItems = new Map(state.itemsById);
  nextItems.delete(oldId);
  nextItems.set(newItem.id, newItem);
  const nextOrder = state.itemOrder.map((id) => id === oldId ? newItem.id : id);
  // oldId 不在 itemOrder（理论上不该发生）则把 newItem 追加到末尾兜底，避免静默丢失。
  if (!nextOrder.includes(newItem.id)) {
    nextOrder.push(newItem.id);
  }
  return {
    ...state,
    itemsById: nextItems,
    itemOrder: nextOrder
  };
}

// 把 eventId 加入 seenEventIds。返回新 state 引用。
export function markEventSeen(state: ProjectionState, eventId: string): ProjectionState {
  if (state.seenEventIds.has(eventId)) {
    return state;
  }
  const next = new Set(state.seenEventIds);
  next.add(eventId);
  return {
    ...state,
    seenEventIds: next
  };
}

// 把 runId 标记为 settled（后续同 runId 的 delta 必须 no-op）。
export function markRunSettled(state: ProjectionState, runId: string): ProjectionState {
  if (state.settledRunIds.has(runId) && !state.streamingItemIdByRun.has(runId)) {
    return state;
  }
  const nextSettledRunIds: ReadonlySet<string> = state.settledRunIds.has(runId)
    ? state.settledRunIds
    : new Set([...state.settledRunIds, runId]);
  // 同时把 streamingItemIdByRun 中该 runId 抹掉（流式槽位回收）。
  let nextStreamingMap: ReadonlyMap<string, string> = state.streamingItemIdByRun;
  if (state.streamingItemIdByRun.has(runId)) {
    const mutable = new Map(state.streamingItemIdByRun);
    mutable.delete(runId);
    nextStreamingMap = mutable;
  }
  return {
    ...state,
    settledRunIds: nextSettledRunIds,
    streamingItemIdByRun: nextStreamingMap
  };
}

// run 已经结束，但权威 message.complete 可能稍后才到：先把 run 标记为 settled，
// 阻止迟到 delta 继续追加；同时保留 streamingItemIdByRun，方便 message.complete 到达时
// 仍能把流式气泡原地替换成最终消息，避免重复气泡。
export function markRunSettledKeepingStreamingSlot(state: ProjectionState, runId: string): ProjectionState {
  if (state.settledRunIds.has(runId)) {
    return state;
  }
  const next = new Set(state.settledRunIds);
  next.add(runId);
  return {
    ...state,
    settledRunIds: next
  };
}

export function bindStreamingItem(
  state: ProjectionState,
  runId: string,
  itemId: string
): ProjectionState {
  if (state.streamingItemIdByRun.get(runId) === itemId) {
    return state;
  }
  const next = new Map(state.streamingItemIdByRun);
  next.set(runId, itemId);
  return {
    ...state,
    streamingItemIdByRun: next
  };
}

// 工具调用索引：tool_call.start 创建卡片时建立 toolCallId → itemId 映射；
// tool_call.result 来时按 toolCallId 反查 itemId 进行 patch（守"同一 toolCallId 只对应一张卡"不变量）。
export function bindToolCall(
  state: ProjectionState,
  toolCallId: string,
  itemId: string
): ProjectionState {
  if (state.toolCallsById.get(toolCallId) === itemId) {
    return state;
  }
  const next = new Map(state.toolCallsById);
  next.set(toolCallId, itemId);
  return {
    ...state,
    toolCallsById: next
  };
}

export function stopActiveAssistantStreaming(
  state: ProjectionState,
  runId: string,
  stoppedAt: number
): ProjectionState {
  const activeItemId = state.streamingItemIdByRun.get(runId);
  if (activeItemId === undefined) {
    return state;
  }
  const activeItem = state.itemsById.get(activeItemId);
  if (
    activeItem === undefined ||
    activeItem.kind !== 'assistant_bubble' ||
    (!activeItem.streaming && activeItem.thoughtChunks.every((c) => c.completed))
  ) {
    return state;
  }
  return replaceItem(state, {
    ...activeItem,
    streaming: false,
    thoughtChunks: completeThoughtChunks(activeItem.thoughtChunks, stoppedAt)
  });
}

export function closeActiveAssistantSegment(
  state: ProjectionState,
  runId: string,
  stoppedAt: number
): ProjectionState {
  const stopped = stopActiveAssistantStreaming(state, runId, stoppedAt);
  if (!stopped.streamingItemIdByRun.has(runId)) {
    return stopped;
  }
  // 工具调用是时间线边界：旧 assistant 段已经停笔，后续 thought / answer 必须开新段。
  const nextStreamingMap = new Map(stopped.streamingItemIdByRun);
  nextStreamingMap.delete(runId);
  return {
    ...stopped,
    streamingItemIdByRun: nextStreamingMap
  };
}
