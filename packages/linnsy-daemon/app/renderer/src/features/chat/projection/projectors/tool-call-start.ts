// tool_call.start 投影器：创建一张 status='running' 的 ToolCallCardItem。
//
// 守住的不变量：
//   - 同 toolCallId 只产生一张卡（重复 start 事件视为协议异常 → 取首次，后续 no-op）
//   - progress 先于 start 到达时，start 负责回填占位卡的 args / turnId 等语义字段
//   - 跨会话隔离：不属于当前 conversation 的事件被忽略
//   - args 来时一次写定，不再变（result 阶段只 patch status / result / error / endedAt）

import type { ProjectionState } from '../state.js';
import type { EventEnvelope, ToolCallCardItem } from '../types.js';
import { toolCallItemId } from '../helpers/ids.js';
import { appendItem, bindToolCall, closeActiveAssistantSegment, replaceItem } from '../helpers/item-ops.js';
import { readToolCallStartPayload } from '../helpers/payload-readers.js';

function hasRecordEntries(record: Record<string, unknown>): boolean {
  return Object.keys(record).length > 0;
}

export function reduceToolCallStart(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const payload = readToolCallStartPayload(event.payload);
  if (payload === null) return state;
  if (state.conversationId !== null && event.conversationId !== state.conversationId) {
    return state;
  }
  const itemId = toolCallItemId(payload.toolCallId);
  const existing = state.itemsById.get(itemId);
  if (existing !== undefined) {
    if (existing.kind !== 'tool_call_card') {
      return state;
    }
    if (hasRecordEntries(existing.args)) {
      // 重复 start：保留首次 args，避免后续修订把"用户已经看到的 args"洗掉。
      return state;
    }
    // progress 事件可能先于 start 落库或抵达前端。此时已有一张 args={} 的
    // 占位卡，迟到的 start 必须把工具语义补回来，否则自定义工具卡无法命中。
    const patched: ToolCallCardItem = {
      ...existing,
      toolName: payload.toolName,
      args: payload.args,
      startedAt: payload.startedAt,
      runId: event.runId ?? existing.runId,
      ...(payload.turnId === undefined ? {} : { turnId: payload.turnId })
    };
    const nextState = event.runId !== undefined ? closeActiveAssistantSegment(state, event.runId, event.createdAt) : state;
    const next = replaceItem(nextState, patched);
    return bindToolCall(next, payload.toolCallId, itemId);
  }
  const item: ToolCallCardItem = {
    kind: 'tool_call_card',
    id: itemId,
    conversationId: event.conversationId ?? '',
    createdAt: event.createdAt,
    toolCallId: payload.toolCallId,
    toolName: payload.toolName,
    status: 'running',
    args: payload.args,
    progressChunks: [],
    startedAt: payload.startedAt,
    runId: event.runId ?? '',
    ...(payload.turnId === undefined ? {} : { turnId: payload.turnId })
  };

  const nextState = event.runId !== undefined ? closeActiveAssistantSegment(state, event.runId, event.createdAt) : state;
  const next = appendItem(nextState, item);
  return bindToolCall(next, payload.toolCallId, itemId);
}
