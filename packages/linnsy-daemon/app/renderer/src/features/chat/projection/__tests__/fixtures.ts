// 测试夹具：构造投影 reducer 所需的 EventEnvelope。
// 严格匹配 daemon 端 publish 形态（参考 packages/linnsy-daemon/src/domains/agent-run/features/run-executor/stream-answer.ts
// 与 src/app/orchestration/turn-handler.ts），任何字段命名变化必须同步本文件。

import type { ConversationMessage } from '../../../../lib/daemon-api.js';
import type { EventEnvelope } from '../types.js';

let nextSeq = 1;
let nextEventId = 1;

export function resetFixtureCounters(): void {
  nextSeq = 1;
  nextEventId = 1;
}

export function inbound(input: {
  conversationId?: string;
  message: Partial<ConversationMessage> & Pick<ConversationMessage, 'messageId' | 'role' | 'source' | 'createdAt'>;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  const conversationId = input.conversationId ?? input.message.conversationId ?? 'conv_test';
  const message: ConversationMessage = {
    conversationId,
    text: input.message.text ?? '',
    ...input.message
  };
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'message.inbound',
    createdAt: input.message.createdAt,
    conversationId,
    messageId: input.message.messageId,
    payload: { message }
  };
}

export function delta(input: {
  conversationId?: string;
  runId: string;
  turnId: string;
  answerId: string;
  chunkSeq: number;
  delta: string;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'message.delta',
    createdAt: input.createdAt ?? input.chunkSeq + 1,
    conversationId: input.conversationId ?? 'conv_test',
    runId: input.runId,
    payload: {
      turnId: input.turnId,
      answerId: input.answerId,
      chunkSeq: input.chunkSeq,
      delta: input.delta
    }
  };
}

export function thoughtDelta(input: {
  conversationId?: string;
  runId: string;
  turnId: string;
  thoughtId: string;
  chunkSeq: number;
  chunk: string;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'message.thought_delta',
    createdAt: input.createdAt ?? input.chunkSeq + 1,
    conversationId: input.conversationId ?? 'conv_test',
    runId: input.runId,
    payload: {
      turnId: input.turnId,
      thoughtId: input.thoughtId,
      chunkSeq: input.chunkSeq,
      chunk: input.chunk
    }
  };
}

export function thoughtComplete(input: {
  conversationId?: string;
  runId: string;
  turnId: string;
  thoughtId: string;
  text: string;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'message.thought_complete',
    createdAt: input.createdAt ?? 1,
    conversationId: input.conversationId ?? 'conv_test',
    runId: input.runId,
    payload: {
      turnId: input.turnId,
      thoughtId: input.thoughtId,
      text: input.text
    }
  };
}

export function runStatusChange(input: {
  conversationId?: string;
  runId: string;
  status: string;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'run.status_change',
    createdAt: input.createdAt ?? 1,
    conversationId: input.conversationId ?? 'conv_test',
    runId: input.runId,
    payload: {
      status: input.status,
      updatedAt: input.createdAt ?? 1
    }
  };
}

export function toolCallStart(input: {
  conversationId?: string;
  runId?: string;
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  turnId?: string;
  startedAt?: number;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  const startedAt = input.startedAt ?? input.createdAt ?? 1;
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'tool_call.start',
    createdAt: input.createdAt ?? startedAt,
    conversationId: input.conversationId ?? 'conv_test',
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    payload: {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      args: input.args ?? {},
      startedAt,
      ...(input.turnId === undefined ? {} : { turnId: input.turnId })
    }
  };
}

export function toolCallResult(input: {
  conversationId?: string;
  runId?: string;
  toolCallId: string;
  toolName: string;
  status: 'success' | 'error' | 'blocked';
  data?: Record<string, unknown>;
  observation?: string;
  error?: string;
  errorKind?: 'protocol' | 'execution';
  durationMs?: number;
  endedAt?: number;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  const endedAt = input.endedAt ?? input.createdAt ?? 2;
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'tool_call.result',
    createdAt: input.createdAt ?? endedAt,
    conversationId: input.conversationId ?? 'conv_test',
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    payload: {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      status: input.status,
      durationMs: input.durationMs ?? 1,
      endedAt,
      ...(input.data === undefined ? {} : { data: input.data }),
      ...(input.observation === undefined ? {} : { observation: input.observation }),
      ...(input.error === undefined ? {} : { error: input.error }),
      ...(input.errorKind === undefined ? {} : { errorKind: input.errorKind })
    }
  };
}

export function toolCallProgress(input: {
  conversationId?: string;
  runId?: string;
  toolCallId: string;
  toolName: string;
  phase?: 'start' | 'update' | 'complete' | 'error';
  status?: 'loading' | 'success' | 'error';
  detail?: string;
  occurredAt?: number;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  const occurredAt = input.occurredAt ?? input.createdAt ?? 2;
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'tool_call.progress',
    createdAt: input.createdAt ?? occurredAt,
    conversationId: input.conversationId ?? 'conv_test',
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    payload: {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      phase: input.phase ?? 'update',
      status: input.status ?? 'loading',
      occurredAt,
      ...(input.detail === undefined ? {} : { detail: input.detail })
    }
  };
}

export function subagentSummary(input: {
  conversationId?: string;
  taskId: string;
  childRunId: string;
  childConversationId: string;
  summary: string;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'subagent.summary',
    createdAt: input.createdAt ?? 1,
    conversationId: input.conversationId ?? 'conv_test',
    payload: {
      taskId: input.taskId,
      childRunId: input.childRunId,
      childConversationId: input.childConversationId,
      summary: input.summary
    }
  };
}

export function subagentProgress(input: {
  conversationId?: string;
  runId?: string;
  childRunId: string;
  parentToolCallId: string;
  kind?: 'thought_delta' | 'thought_complete' | 'tool_call_decision' | 'tool_process' | 'tool_output' | 'final_answer_chunk' | 'final_answer';
  status?: 'loading' | 'success' | 'error';
  toolName?: string;
  toolCallId?: string;
  phase?: 'start' | 'update' | 'complete' | 'error';
  detail?: string;
  occurredAt?: number;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  const occurredAt = input.occurredAt ?? input.createdAt ?? 2;
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'subagent.progress',
    createdAt: input.createdAt ?? occurredAt,
    conversationId: input.conversationId ?? 'conv_test',
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    payload: {
      childRunId: input.childRunId,
      parentToolCallId: input.parentToolCallId,
      kind: input.kind ?? 'tool_process',
      occurredAt,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.toolName === undefined ? {} : { toolName: input.toolName }),
      ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      ...(input.detail === undefined ? {} : { detail: input.detail })
    }
  };
}

export function systemEvent(input: {
  conversationId?: string;
  runId?: string;
  sourceKind: 'cron' | 'user_interjection' | 'task_execution_notice' | 'channel_status';
  detail: string;
  refId?: string;
  occurredAt?: number;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  const occurredAt = input.occurredAt ?? input.createdAt ?? 1;
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'system.event',
    createdAt: input.createdAt ?? occurredAt,
    conversationId: input.conversationId ?? 'conv_test',
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    payload: {
      sourceKind: input.sourceKind,
      detail: input.detail,
      occurredAt,
      ...(input.refId === undefined ? {} : { refId: input.refId })
    }
  };
}

export function legacyTaskStatusSystemEvent(input: {
  conversationId?: string;
  runId?: string;
  detail: string;
  refId?: string;
  occurredAt?: number;
  createdAt?: number;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  const occurredAt = input.occurredAt ?? input.createdAt ?? 1;
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'system.event',
    createdAt: input.createdAt ?? occurredAt,
    conversationId: input.conversationId ?? 'conv_test',
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    payload: {
      sourceKind: 'task_status_change',
      detail: input.detail,
      occurredAt,
      ...(input.refId === undefined ? {} : { refId: input.refId })
    }
  };
}

export function complete(input: {
  conversationId?: string;
  runId?: string;
  message: Partial<ConversationMessage> & Pick<ConversationMessage, 'messageId' | 'role' | 'source' | 'createdAt'>;
  eventId?: string;
  seq?: number;
}): EventEnvelope {
  const conversationId = input.conversationId ?? input.message.conversationId ?? 'conv_test';
  const runId = input.runId ?? input.message.runId;
  const message: ConversationMessage = {
    conversationId,
    text: input.message.text ?? '',
    ...input.message,
    ...(runId === undefined ? {} : { runId })
  };
  return {
    eventId: input.eventId ?? `evt_${(nextEventId++).toString()}`,
    seq: input.seq ?? nextSeq++,
    kind: 'message.complete',
    createdAt: input.message.createdAt,
    conversationId,
    messageId: input.message.messageId,
    ...(runId === undefined ? {} : { runId }),
    payload: { message }
  };
}
