// run.status_change 投影器：run 结束时立刻停止当前 assistant 气泡的流式状态。
//
// daemon 的 message.complete 需要等 outbound 发送与持久化后才到；但 LLM/run 结束这一刻，
// AI 已经不会再输出正文了，正文光标必须先消失。这里不创建新 UI，只修正已有流式气泡状态。

import type { ProjectionState } from '../state.js';
import type { EventEnvelope } from '../types.js';
import {
  markRunSettledKeepingStreamingSlot,
  stopActiveAssistantStreaming
} from '../helpers/item-ops.js';

export function reduceRunStatusChange(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const runId = event.runId;
  if (runId === undefined || runId.length === 0 || !isRunFinished(event.payload)) {
    return state;
  }
  if (state.conversationId !== null
    && event.conversationId !== undefined
    && event.conversationId !== state.conversationId) {
    return state;
  }

  const stateWithStoppedCursor = stopActiveAssistantStreaming(state, runId, event.createdAt);
  return markRunSettledKeepingStreamingSlot(stateWithStoppedCursor, runId);
}

function isRunFinished(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }
  const status = payload.status;
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
