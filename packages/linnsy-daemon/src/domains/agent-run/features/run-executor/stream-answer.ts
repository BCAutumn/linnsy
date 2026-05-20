import {
  createFinalAnswerChunkEvent,
  createThoughtEvent,
  type RuntimeEvent
} from '@linnlabs/linnkit/contracts';

import { isRecord } from '../../../../shared/json.js';
import type { RunExecutorEventPort } from './types.js';
import { mapAgentProcessEventToRuntimeInputs } from './agent-event-bridge.js';

export function createStreamCollectorSink(conversationId: string, turnId: string): (event: unknown) => RuntimeEvent[];
export function createStreamCollectorSink(input: {
  conversationId: string;
  turnId: string;
  runId?: string;
  events?: RunExecutorEventPort;
}): (event: unknown) => RuntimeEvent[];
export function createStreamCollectorSink(
  inputOrConversationId: string | {
    conversationId: string;
    turnId: string;
    runId?: string;
    events?: RunExecutorEventPort;
  },
  legacyTurnId?: string
): (event: unknown) => RuntimeEvent[] {
  const input = typeof inputOrConversationId === 'string'
    ? {
        conversationId: inputOrConversationId,
        turnId: legacyTurnId ?? inputOrConversationId
      }
    : inputOrConversationId;
  // 全局自递增 seq：跨多次 LLM call 共享，永远不信任上游 event.seq（多次 LLM
  // call 时上游会各自从 0 开始，导致 readFinalAnswer 按 seq 排序时字符级穿插）。
  let nextSeq = 0;
  // 多次 LLM call 时 bump 后缀，保证每段 final answer 拿到独立 answer_id；
  // readFinalAnswer 按 answer_id 分组取最后一组，避免把"搞定了" + "其实没搞定"
  // 两段语义冲突的回复同时返回给用户。
  let baseAnswerId: string | undefined;
  let activeAnswerId: string | undefined;
  let callIndex = 0;
  let lastUpstreamSeq: number | undefined;
  const nextThoughtSeqById = new Map<string, number>();
  return (event) => {
    if (!isRecord(event)) {
      return [];
    }
    if (input.events !== undefined) {
      const bridgeInputs = mapAgentProcessEventToRuntimeInputs(event, {
        conversationId: input.conversationId,
        turnId: input.turnId,
        ...(input.runId === undefined ? {} : { runId: input.runId })
      });
      for (const bridgeInput of bridgeInputs) {
        input.events.publish(bridgeInput);
      }
      if (bridgeInputs.length > 0) {
        return [];
      }
    }
    if (event.type === 'thought') {
      return collectThoughtEvent({
        event,
        conversationId: input.conversationId,
        turnId: input.turnId,
        nextThoughtSeqById,
        ...(input.events === undefined ? {} : { events: input.events }),
        ...(input.runId === undefined ? {} : { runId: input.runId })
      });
    }
    if (event.type !== 'stream_chunk') {
      return [];
    }
    // 必须保留 chunk content 中的所有空白（包括起止 \n / 双 \n 段落分隔）。
    // 不能用 readNonEmptyString —— 它会 trim 掉 chunk 边界的换行，导致 LLM
    // 切出来的 markdown 列表 "**A**" / "\n- item" / "\n\n**B**" 拼接后丢失全部
    // \n，微信里看到全部要点挤一行（2026-04-27 二次复盘根因）。
    const rawContent = event.content;
    if (typeof rawContent !== 'string' || rawContent.length === 0) {
      return [];
    }
    const content = rawContent;
    const upstreamAnswerId = readNonEmptyString(event.answer_id);
    const upstreamSeq = readInteger(event.seq);
    if (upstreamAnswerId !== undefined) {
      if (activeAnswerId !== undefined && activeAnswerId !== upstreamAnswerId) {
        callIndex += 1;
      }
      activeAnswerId = upstreamAnswerId;
      baseAnswerId ??= upstreamAnswerId;
    } else {
      baseAnswerId ??= `answer_${input.turnId}`;
      // 上游不发 answer_id：用 seq 倒退 (新 stream 通常从 0 开始) 启发式探测新 LLM call。
      if (
        upstreamSeq !== undefined &&
        upstreamSeq === 0 &&
        lastUpstreamSeq !== undefined &&
        lastUpstreamSeq > 0
      ) {
        callIndex += 1;
      }
      activeAnswerId = callIndex === 0 ? baseAnswerId : `${baseAnswerId}#${callIndex.toString()}`;
    }
    lastUpstreamSeq = upstreamSeq;
    const seq = nextSeq;
    nextSeq += 1;
    const eventId = readNonEmptyString(event.id) ?? `chunk_${input.turnId}_${seq.toString()}`;
    const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
    input.events?.publish({
      kind: 'message.delta',
      conversationId: input.conversationId,
      createdAt: timestamp,
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      payload: {
        turnId: input.turnId,
        answerId: activeAnswerId,
        chunkSeq: seq,
        delta: content
      }
    });
    return [
      createFinalAnswerChunkEvent(eventId, input.conversationId, input.turnId, activeAnswerId, seq, content, {
        timestamp,
        ephemeral: true
      })
    ];
  };
}

function collectThoughtEvent(input: {
  event: Record<string, unknown>;
  conversationId: string;
  turnId: string;
  runId?: string;
  events?: RunExecutorEventPort;
  nextThoughtSeqById: Map<string, number>;
}): RuntimeEvent[] {
  const thoughtId =
    readNonEmptyString(input.event.thought_message_id) ??
    readNonEmptyString(input.event.id) ??
    `thought_${input.turnId}`;
  const eventId = readNonEmptyString(input.event.id) ?? `thought_${input.turnId}_${thoughtId}`;
  const timestamp = typeof input.event.timestamp === 'number' ? input.event.timestamp : Date.now();
  const isComplete = input.event.is_complete === true;

  if (isComplete) {
    const text = typeof input.event.content === 'string' ? input.event.content : '';
    input.events?.publish({
      kind: 'message.thought_complete',
      conversationId: input.conversationId,
      createdAt: timestamp,
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      payload: {
        turnId: input.turnId,
        thoughtId,
        text
      }
    });
    return [
      createThoughtEvent(eventId, input.conversationId, input.turnId, text, {
        timestamp,
        thought_message_id: thoughtId,
        is_complete: true
      })
    ];
  }

  const chunk = typeof input.event.delta === 'string'
    ? input.event.delta
    : typeof input.event.content === 'string'
      ? input.event.content
      : '';
  if (chunk.length === 0) {
    return [];
  }
  const chunkSeq = input.nextThoughtSeqById.get(thoughtId) ?? 0;
  input.nextThoughtSeqById.set(thoughtId, chunkSeq + 1);
  input.events?.publish({
    kind: 'message.thought_delta',
    conversationId: input.conversationId,
    createdAt: timestamp,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    payload: {
      turnId: input.turnId,
      thoughtId,
      chunk,
      chunkSeq
    }
  });
  return [
    createThoughtEvent(eventId, input.conversationId, input.turnId, '', {
      timestamp,
      thought_message_id: thoughtId,
      delta: chunk,
      is_complete: false,
      ephemeral: true
    })
  ];
}

export function readFinalAnswer(events: RuntimeEvent[], local: Record<string, unknown> | undefined): string | undefined {
  const allEvents = uniqueRuntimeEvents([...events, ...readLocalHistory(local)]);
  for (const event of allEvents.slice().reverse()) {
    if (event.type === 'final_answer' && 'content' in event && typeof event.content === 'string') {
      return event.content;
    }
  }
  const chunks = allEvents.filter((event) => event.type === 'final_answer_chunk');
  if (chunks.length > 0) {
    // 多 LLM call 时同 turn 可能产生若干段 final_answer_chunk（不同 answer_id）。
    // 第一段往往是"我先说搞定"这类后被自我否定的稿，第二段才是真正给用户的最终答；
    // 因此按 answer_id 出现顺序分组、组内按 seq 升序拼接、只返回最后一组。
    const groups = new Map<string, { firstIndex: number; chunks: typeof chunks }>();
    chunks.forEach((chunk, index) => {
      const group = groups.get(chunk.answer_id);
      if (group === undefined) {
        groups.set(chunk.answer_id, { firstIndex: index, chunks: [chunk] });
      } else {
        group.chunks.push(chunk);
      }
    });
    let lastGroup: { firstIndex: number; chunks: typeof chunks } | undefined;
    for (const group of groups.values()) {
      if (lastGroup === undefined || group.firstIndex > lastGroup.firstIndex) {
        lastGroup = group;
      }
    }
    if (lastGroup !== undefined) {
      return lastGroup.chunks
        .slice()
        .sort((left, right) => left.seq - right.seq)
        .map((event) => event.content)
        .join('');
    }
  }
  if (local !== undefined && typeof local.finalAnswer === 'string') {
    return local.finalAnswer;
  }
  return undefined;
}

function uniqueRuntimeEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  const seen = new Set<string>();
  const result: RuntimeEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    result.push(event);
  }
  return result;
}

function readLocalHistory(local: Record<string, unknown> | undefined): RuntimeEvent[] {
  if (local === undefined || !Array.isArray(local.history)) {
    return [];
  }
  return local.history.filter(isRuntimeEvent);
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  return isRecord(value) && typeof value.type === 'string' && typeof value.id === 'string';
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readInteger(value: unknown): number | undefined {
  return Number.isInteger(value) ? Number(value) : undefined;
}
