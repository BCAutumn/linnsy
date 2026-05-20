// tool_call.progress 投影器：把 linnkit tool_process 中间态追加到同一张工具卡。
//
// 守住的不变量：
//   - 同 eventId 由 reducer 主入口幂等拦截，本投影器只负责按 toolCallId 追加过程行
//   - progress 先于 start 到达时创建 running 占位卡，避免过程事件丢失
//   - progress 不改写 args / result / terminal status，仅补充可观察过程

import type { ProjectionState } from '../state.js';
import type { EventEnvelope, ToolCallCardItem, ToolCallProgressChunk } from '../types.js';
import { toolCallItemId } from '../helpers/ids.js';
import { appendItem, bindToolCall, replaceItem, stopActiveAssistantStreaming } from '../helpers/item-ops.js';
import { readToolCallProgressPayload } from '../helpers/payload-readers.js';

export function reduceToolCallProgress(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const payload = readToolCallProgressPayload(event.payload);
  if (payload === null) return state;
  if (state.conversationId !== null && event.conversationId !== state.conversationId) {
    return state;
  }

  const targetItemId = state.toolCallsById.get(payload.toolCallId) ?? toolCallItemId(payload.toolCallId);
  const existing = state.itemsById.get(targetItemId);
  const chunk: ToolCallProgressChunk = {
    id: event.eventId,
    phase: payload.phase,
    status: payload.status,
    occurredAt: payload.occurredAt,
    ...(payload.detail === undefined ? {} : { detail: payload.detail }),
    ...(payload.metadata === undefined ? {} : { metadata: payload.metadata })
  };

  const nextState = event.runId !== undefined ? stopActiveAssistantStreaming(state, event.runId, event.createdAt) : state;

  if (existing !== undefined && existing.kind === 'tool_call_card') {
    const patched: ToolCallCardItem = {
      ...existing,
      progressChunks: [...(existing.progressChunks ?? []), chunk]
    };
    return replaceItem(nextState, patched);
  }

  const item: ToolCallCardItem = {
    kind: 'tool_call_card',
    id: targetItemId,
    conversationId: event.conversationId ?? '',
    createdAt: event.createdAt,
    toolCallId: payload.toolCallId,
    toolName: payload.toolName,
    status: 'running',
    args: {},
    progressChunks: [chunk],
    startedAt: payload.occurredAt,
    runId: event.runId ?? ''
  };
  const next = appendItem(nextState, item);
  return bindToolCall(next, payload.toolCallId, targetItemId);
}
