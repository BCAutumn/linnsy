// ProjectionState → 渲染层数据的读侧。
// 渲染层（Message.tsx / ChatView.tsx）只允许通过本文件的函数读 state，禁止直读 itemsById。

import type { ProjectionState } from '../state.js';
import type { ConversationItem } from '../types.js';

// 按 itemOrder 拼出有序 ConversationItem 数组，用于渲染。
// itemOrder 中存在但 itemsById 缺失的 itemId 会被静默跳过（理论上不应发生；保留兜底防御）。
export function selectAllItems(state: ProjectionState): ConversationItem[] {
  const result: ConversationItem[] = [];
  for (const id of state.itemOrder) {
    const item = state.itemsById.get(id);
    if (item !== undefined) {
      result.push(item);
    }
  }
  return result;
}

// 找出当前正在流式的 AssistantBubble itemId（用于流式 watch key / 光标渲染）。
export function selectStreamingItemId(state: ProjectionState, runId: string): string | undefined {
  return state.streamingItemIdByRun.get(runId);
}
