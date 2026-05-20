// 事件 payload 的类型守卫。每个 projector 共享同一组 reader，避免在多处写 isRecord 检查。
// 任何 reader 失败（必填字段缺失 / 类型不匹配）都返回 null，由 reducer 视为 "事件协议异常 → no-op"。

import type { ConversationMessage } from '../../../../lib/daemon-api.js';
import {
  isSystemEventSourceKind,
  type MessageDeltaPayload,
  type MessageThoughtCompletePayload,
  type MessageThoughtDeltaPayload,
  type SubagentProgressPayload,
  type SubagentSummaryPayload,
  type SystemEventPayload,
  type ToolCallErrorKind,
  type ToolCallProgressPayload,
  type ToolCallResultPayload,
  type ToolCallStartPayload,
  type ToolCallStatus
} from '@renderer/contracts';

export function readDeltaPayload(payload: unknown): MessageDeltaPayload | null {
  if (!isRecord(payload)) {
    return null;
  }
  const turnId = readString(payload.turnId);
  const answerId = readString(payload.answerId);
  const chunkSeq = readInteger(payload.chunkSeq);
  const delta = typeof payload.delta === 'string' ? payload.delta : null;
  if (turnId === null || answerId === null || chunkSeq === null || delta === null) {
    return null;
  }
  return { turnId, answerId, chunkSeq, delta };
}

export function readThoughtDeltaPayload(payload: unknown): MessageThoughtDeltaPayload | null {
  if (!isRecord(payload)) {
    return null;
  }
  const turnId = readString(payload.turnId);
  const thoughtId = readString(payload.thoughtId);
  const chunk = typeof payload.chunk === 'string' ? payload.chunk : null;
  const chunkSeq = readInteger(payload.chunkSeq);
  if (turnId === null || thoughtId === null || chunk === null || chunkSeq === null) {
    return null;
  }
  return { turnId, thoughtId, chunk, chunkSeq };
}

export function readThoughtCompletePayload(payload: unknown): MessageThoughtCompletePayload | null {
  if (!isRecord(payload)) {
    return null;
  }
  const turnId = readString(payload.turnId);
  const thoughtId = readString(payload.thoughtId);
  const text = typeof payload.text === 'string' ? payload.text : null;
  if (turnId === null || thoughtId === null || text === null) {
    return null;
  }
  return { turnId, thoughtId, text };
}

// 从 message.inbound / message.complete 的 payload 里把 ConversationMessage 抽出来。
export function readMessagePayload(
  payload: unknown,
  fallbackConversationId?: string
): ConversationMessage | null {
  if (!isRecord(payload)) {
    return null;
  }
  const raw = payload.message;
  if (!isRecord(raw)) {
    return null;
  }
  const messageId = readString(raw.messageId);
  const role = readString(raw.role);
  const source = readString(raw.source);
  const createdAt = readInteger(raw.createdAt);
  if (messageId === null || role === null || source === null || createdAt === null) {
    return null;
  }
  const conversationId = readString(raw.conversationId) ?? fallbackConversationId;
  const message: ConversationMessage = {
    messageId,
    role,
    source,
    createdAt
  };
  if (conversationId !== undefined) {
    message.conversationId = conversationId;
  }
  const text = readString(raw.text);
  if (text !== null) {
    message.text = text;
  }
  const runId = readString(raw.runId);
  if (runId !== null) {
    message.runId = runId;
  }
  if (isRecord(raw.metadata)) {
    message.metadata = raw.metadata;
  }
  if ('streaming' in raw && typeof raw.streaming === 'boolean') {
    message.streaming = raw.streaming;
  }
  return message;
}

// === S2 新增：4 种对话流元素事件的 payload 守卫 ===

export function readToolCallStartPayload(payload: unknown): ToolCallStartPayload | null {
  if (!isRecord(payload)) return null;
  const toolCallId = readString(payload.toolCallId);
  const toolName = readString(payload.toolName);
  const startedAt = readInteger(payload.startedAt);
  if (toolCallId === null || toolName === null || startedAt === null) return null;
  if (!isRecord(payload.args)) return null;
  const result: ToolCallStartPayload = {
    toolCallId,
    toolName,
    args: payload.args,
    startedAt
  };
  const turnId = readString(payload.turnId);
  if (turnId !== null) result.turnId = turnId;
  return result;
}

export function readToolCallResultPayload(payload: unknown): ToolCallResultPayload | null {
  if (!isRecord(payload)) return null;
  const toolCallId = readString(payload.toolCallId);
  const toolName = readString(payload.toolName);
  const status = readToolCallStatus(payload.status);
  const durationMs = readInteger(payload.durationMs);
  const endedAt = readInteger(payload.endedAt);
  if (toolCallId === null || toolName === null || status === null || durationMs === null || endedAt === null) {
    return null;
  }
  const out: ToolCallResultPayload = {
    toolCallId,
    toolName,
    status,
    durationMs,
    endedAt
  };
  if (isRecord(payload.data)) out.data = payload.data;
  if (typeof payload.observation === 'string') out.observation = payload.observation;
  if (typeof payload.error === 'string') out.error = payload.error;
  const errorKind = readToolCallErrorKind(payload.errorKind);
  if (errorKind !== null) out.errorKind = errorKind;
  return out;
}

export function readToolCallProgressPayload(payload: unknown): ToolCallProgressPayload | null {
  if (!isRecord(payload)) return null;
  const toolCallId = readString(payload.toolCallId);
  const toolName = readString(payload.toolName);
  const phase = readToolCallPhase(payload.phase);
  const status = readProgressStatus(payload.status);
  const occurredAt = readInteger(payload.occurredAt);
  if (toolCallId === null || toolName === null || phase === null || status === null || occurredAt === null) {
    return null;
  }
  const out: ToolCallProgressPayload = { toolCallId, toolName, phase, status, occurredAt };
  const detail = readString(payload.detail);
  if (detail !== null) out.detail = detail;
  if (isRecord(payload.metadata)) out.metadata = payload.metadata;
  return out;
}

export function readSubagentSummaryPayload(payload: unknown): SubagentSummaryPayload | null {
  if (!isRecord(payload)) return null;
  const taskId = readString(payload.taskId);
  const childRunId = readString(payload.childRunId);
  const childConversationId = readString(payload.childConversationId);
  const summary = typeof payload.summary === 'string' ? payload.summary : null;
  if (taskId === null || childRunId === null || childConversationId === null || summary === null) {
    return null;
  }
  return { taskId, childRunId, childConversationId, summary };
}

export function readSubagentProgressPayload(payload: unknown): SubagentProgressPayload | null {
  if (!isRecord(payload)) return null;
  const childRunId = readString(payload.childRunId);
  const parentToolCallId = readString(payload.parentToolCallId);
  const kind = readSubagentProgressKind(payload.kind);
  const occurredAt = readInteger(payload.occurredAt);
  if (childRunId === null || parentToolCallId === null || kind === null || occurredAt === null) {
    return null;
  }
  const out: SubagentProgressPayload = { childRunId, parentToolCallId, kind, occurredAt };
  const status = readProgressStatus(payload.status);
  if (status !== null) out.status = status;
  const toolName = readString(payload.toolName);
  if (toolName !== null) out.toolName = toolName;
  const toolCallId = readString(payload.toolCallId);
  if (toolCallId !== null) out.toolCallId = toolCallId;
  const phase = readToolCallPhase(payload.phase);
  if (phase !== null) out.phase = phase;
  const detail = readString(payload.detail);
  if (detail !== null) out.detail = detail;
  if (isRecord(payload.metadata)) out.metadata = payload.metadata;
  return out;
}

export function readSystemEventPayload(payload: unknown): SystemEventPayload | null {
  if (!isRecord(payload)) return null;
  const sourceKind = readSystemEventSourceKind(payload.sourceKind);
  const detail = typeof payload.detail === 'string' ? payload.detail : null;
  const occurredAt = readInteger(payload.occurredAt);
  if (sourceKind === null || detail === null || occurredAt === null) return null;
  const out: SystemEventPayload = { sourceKind, detail, occurredAt };
  const refId = readString(payload.refId);
  if (refId !== null) out.refId = refId;
  return out;
}

function readToolCallStatus(value: unknown): ToolCallStatus | null {
  return value === 'success' || value === 'error' || value === 'blocked' ? value : null;
}

function readProgressStatus(value: unknown): ToolCallProgressPayload['status'] | null {
  return value === 'loading' || value === 'success' || value === 'error' ? value : null;
}

function readToolCallPhase(value: unknown): ToolCallProgressPayload['phase'] | null {
  return value === 'start' || value === 'update' || value === 'complete' || value === 'error'
    ? value
    : null;
}

function readSubagentProgressKind(value: unknown): SubagentProgressPayload['kind'] | null {
  return value === 'thought_delta' ||
    value === 'thought_complete' ||
    value === 'tool_call_decision' ||
    value === 'tool_process' ||
    value === 'tool_output' ||
    value === 'final_answer_chunk' ||
    value === 'final_answer'
    ? value
    : null;
}

function readSystemEventSourceKind(value: unknown): SystemEventPayload['sourceKind'] | null {
  return isSystemEventSourceKind(value) ? value : null;
}

function readToolCallErrorKind(value: unknown): ToolCallErrorKind | null {
  return value === 'protocol' || value === 'execution' ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readInteger(value: unknown): number | null {
  return Number.isInteger(value) && typeof value === 'number' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
