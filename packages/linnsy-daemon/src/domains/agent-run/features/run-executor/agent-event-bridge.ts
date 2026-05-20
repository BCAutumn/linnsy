// linnkit 过程事件 → Linnsy wire 事件桥。
//
// linnkit 的 RuntimeEvent/AnyAgentEvent 比前端需要的种类更细；这里把 host 关心的
// tool_process / subrun_trace 收敛成 Linnsy 自己的 progress 事件，守住“前端不吃 provider
// 或 framework 方言”的边界。

import { isRecord } from '../../../../shared/json.js';
import type { RuntimeEventPublishInput } from '../../../observability/definitions/runtime-events.js';

export interface AgentProcessBridgeContext {
  conversationId: string;
  turnId: string;
  runId?: string;
}

export function mapAgentProcessEventToRuntimeInputs(
  event: unknown,
  context: AgentProcessBridgeContext
): RuntimeEventPublishInput[] {
  if (!isRecord(event)) {
    return [];
  }
  if (event.type === 'tool_process') {
    const input = mapToolProcessEvent(event, context);
    return input === null ? [] : [input];
  }
  if (event.type === 'subrun_trace') {
    const input = mapSubrunTraceEvent(event, context);
    return input === null ? [] : [input];
  }
  return [];
}

function mapToolProcessEvent(
  event: Record<string, unknown>,
  context: AgentProcessBridgeContext
): RuntimeEventPublishInput | null {
  const toolCallId = readString(event.tool_call_id);
  const toolName = readString(event.tool_name);
  const phase = readToolCallPhase(event.phase);
  const status = readProgressStatus(event.status);
  const occurredAt = readNumber(event.timestamp);
  if (toolCallId === null || toolName === null || phase === null || status === null || occurredAt === null) {
    return null;
  }
  return {
    kind: 'tool_call.progress',
    conversationId: context.conversationId,
    ...(context.runId === undefined ? {} : { runId: context.runId }),
    createdAt: occurredAt,
    payload: {
      toolCallId,
      toolName,
      phase,
      status,
      occurredAt,
      ...readDetailAndMetadata(event)
    }
  };
}

function mapSubrunTraceEvent(
  event: Record<string, unknown>,
  context: AgentProcessBridgeContext
): RuntimeEventPublishInput | null {
  const childRunId = readString(event.subrun_id);
  const parentToolCallId = readString(event.parent_tool_call_id);
  const kind = readSubrunTraceKind(event.kind);
  const occurredAt = readNumber(event.timestamp);
  if (childRunId === null || parentToolCallId === null || kind === null || occurredAt === null) {
    return null;
  }
  const status = readProgressStatus(event.status);
  const phase = readToolCallPhase(event.phase);
  const toolName = readString(event.tool_name);
  const toolCallId = readString(event.tool_call_id);

  return {
    kind: 'subagent.progress',
    conversationId: context.conversationId,
    ...(context.runId === undefined ? {} : { runId: context.runId }),
    createdAt: occurredAt,
    payload: {
      childRunId,
      parentToolCallId,
      kind,
      occurredAt,
      ...(status === null ? {} : { status }),
      ...(phase === null ? {} : { phase }),
      ...(toolName === null ? {} : { toolName }),
      ...(toolCallId === null ? {} : { toolCallId }),
      ...readDetailAndMetadata(event)
    }
  };
}

function readDetailAndMetadata(event: Record<string, unknown>): {
  detail?: string;
  metadata?: Record<string, unknown>;
} {
  const detail =
    readString(event.content) ??
    readString(event.delta) ??
    readStringFromRecord(event.payload, 'message') ??
    readStringFromRecord(event.payload, 'detail') ??
    readStringFromRecord(event.metadata, 'message') ??
    readStringFromRecord(event.metadata, 'detail');
  return {
    ...(detail === null ? {} : { detail }),
    ...(isRecord(event.metadata) ? { metadata: event.metadata } : {})
  };
}

function readStringFromRecord(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return readString(value[key]);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readProgressStatus(value: unknown): 'loading' | 'success' | 'error' | null {
  return value === 'loading' || value === 'success' || value === 'error' ? value : null;
}

function readToolCallPhase(value: unknown): 'start' | 'update' | 'complete' | 'error' | null {
  return value === 'start' || value === 'update' || value === 'complete' || value === 'error'
    ? value
    : null;
}

function readSubrunTraceKind(value: unknown):
  | 'thought_delta'
  | 'thought_complete'
  | 'tool_call_decision'
  | 'tool_process'
  | 'tool_output'
  | 'final_answer_chunk'
  | 'final_answer'
  | null {
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
