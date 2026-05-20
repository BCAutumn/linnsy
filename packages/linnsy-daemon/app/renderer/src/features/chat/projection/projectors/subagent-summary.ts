// subagent.summary 投影器：把子 agent 完成汇报映射成 SubagentSummaryItem。
//
// 守住的不变量：
//   - 同 childRunId 只产生一张汇报气泡（重复事件 no-op；childRunId 全局唯一由 daemon 保证）
//   - 跨会话隔离：daemon 已经把 conversationId 设为主会话，前端不再做"主子会话过滤"
//     （linnsy 子 run 的 RuntimeEvent 永远归属主会话）

import type { ProjectionState } from '../state.js';
import type { EventEnvelope, SubagentSummaryItem } from '../types.js';
import { subagentSummaryItemId } from '../helpers/ids.js';
import { appendItem, replaceItem } from '../helpers/item-ops.js';
import { readSubagentProgressPayload, readSubagentSummaryPayload } from '../helpers/payload-readers.js';

export function reduceSubagentSummary(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const payload = readSubagentSummaryPayload(event.payload);
  if (payload === null) return state;
  if (state.conversationId !== null && event.conversationId !== state.conversationId) {
    return state;
  }
  const itemId = subagentSummaryItemId(payload.childRunId);
  const existing = state.itemsById.get(itemId);
  if (existing !== undefined && existing.kind === 'subagent_summary') {
    if (existing.summary.length > 0) {
      return state;
    }
    const patched: SubagentSummaryItem = {
      ...existing,
      taskId: payload.taskId,
      childConversationId: payload.childConversationId,
      summary: payload.summary
    };
    return replaceItem(state, patched);
  }
  if (existing !== undefined) {
    return state;
  }
  const item: SubagentSummaryItem = {
    kind: 'subagent_summary',
    id: itemId,
    conversationId: event.conversationId ?? '',
    createdAt: event.createdAt,
    taskId: payload.taskId,
    childRunId: payload.childRunId,
    childConversationId: payload.childConversationId,
    summary: payload.summary,
    progressChunks: []
  };
  return appendItem(state, item);
}

export function reduceSubagentProgress(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const payload = readSubagentProgressPayload(event.payload);
  if (payload === null) return state;
  if (state.conversationId !== null && event.conversationId !== state.conversationId) {
    return state;
  }

  const itemId = subagentSummaryItemId(payload.childRunId);
  const existing = state.itemsById.get(itemId);
  const chunk = {
    id: event.eventId,
    parentToolCallId: payload.parentToolCallId,
    kind: payload.kind,
    occurredAt: payload.occurredAt,
    ...(payload.status === undefined ? {} : { status: payload.status }),
    ...(payload.toolName === undefined ? {} : { toolName: payload.toolName }),
    ...(payload.toolCallId === undefined ? {} : { toolCallId: payload.toolCallId }),
    ...(payload.phase === undefined ? {} : { phase: payload.phase }),
    ...(payload.detail === undefined ? {} : { detail: payload.detail }),
    ...(payload.metadata === undefined ? {} : { metadata: payload.metadata })
  };

  if (existing !== undefined && existing.kind === 'subagent_summary') {
    const patched: SubagentSummaryItem = {
      ...existing,
      progressChunks: [...(existing.progressChunks ?? []), chunk]
    };
    return replaceItem(state, patched);
  }

  const item: SubagentSummaryItem = {
    kind: 'subagent_summary',
    id: itemId,
    conversationId: event.conversationId ?? '',
    createdAt: event.createdAt,
    taskId: payload.parentToolCallId,
    childRunId: payload.childRunId,
    childConversationId: '',
    summary: '',
    progressChunks: [chunk]
  };
  return appendItem(state, item);
}
