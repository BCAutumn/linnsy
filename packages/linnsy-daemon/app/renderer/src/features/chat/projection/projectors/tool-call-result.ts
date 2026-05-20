// tool_call.result 投影器：按 toolCallId 找到对应的 ToolCallCardItem，patch 终态字段。
//
// 守住的不变量：
//   - 找不到 start 卡片时（result 先到 / 单独到达 blocked）也能立刻创建一张终态卡，
//     避免事件穿透到无人响应（守"不丢失"原则）
//   - status / data / observation / error / errorKind / durationMs / endedAt 一次写定，
//     幂等：相同 eventId 第二次走 reducer 主入口的 seenEventIds 闸门即被拦下
//   - 跨会话隔离

import type { ProjectionState } from '../state.js';
import type { EventEnvelope, ToolCallCardItem } from '../types.js';
import { toolCallItemId } from '../helpers/ids.js';
import { appendItem, bindToolCall, closeActiveAssistantSegment, replaceItem } from '../helpers/item-ops.js';
import { readToolCallResultPayload } from '../helpers/payload-readers.js';

export function reduceToolCallResult(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const payload = readToolCallResultPayload(event.payload);
  if (payload === null) return state;
  if (state.conversationId !== null && event.conversationId !== state.conversationId) {
    return state;
  }

  const targetItemId = state.toolCallsById.get(payload.toolCallId) ?? toolCallItemId(payload.toolCallId);
  const existing = state.itemsById.get(targetItemId);

  const nextState = event.runId !== undefined ? closeActiveAssistantSegment(state, event.runId, event.createdAt) : state;

  if (existing !== undefined && existing.kind === 'tool_call_card') {
    // patch 终态字段，args / startedAt / toolName / runId / turnId 保持来自 start 的不变。
    const patched: ToolCallCardItem = {
      ...existing,
      status: payload.status,
      endedAt: payload.endedAt,
      durationMs: payload.durationMs,
      ...(payload.data === undefined ? {} : { data: payload.data }),
      ...(payload.observation === undefined ? {} : { observation: payload.observation }),
      ...(payload.error === undefined ? {} : { error: payload.error }),
      ...(payload.errorKind === undefined ? {} : { errorKind: payload.errorKind })
    };
    return replaceItem(nextState, patched);
  }

  // result 先于 start 到达（理论上不该发生，但 blocked 路径下会出现：policy-scoped
  // runtime 直接发 result(blocked) 而无 start）。这里兜底创建一张终态卡。
  const item: ToolCallCardItem = {
    kind: 'tool_call_card',
    id: targetItemId,
    conversationId: event.conversationId ?? '',
    createdAt: event.createdAt,
    toolCallId: payload.toolCallId,
    toolName: payload.toolName,
    status: payload.status,
    args: {},
    progressChunks: [],
    startedAt: event.createdAt,
    endedAt: payload.endedAt,
    durationMs: payload.durationMs,
    runId: event.runId ?? '',
    ...(payload.data === undefined ? {} : { data: payload.data }),
    ...(payload.observation === undefined ? {} : { observation: payload.observation }),
    ...(payload.error === undefined ? {} : { error: payload.error }),
    ...(payload.errorKind === undefined ? {} : { errorKind: payload.errorKind })
  };
  const next = appendItem(nextState, item);
  return bindToolCall(next, payload.toolCallId, targetItemId);
}
