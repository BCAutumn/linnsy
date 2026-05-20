// message.thought_* 投影器：把 LLM 思考链归到同一个 AssistantBubble 内部。
//
// 守住的不变量：
//   - 思考链不单开 thought_bubble，避免把同一段回复拆成两条主线消息
//   - chunkSeq 乱序到达时按 seq 拼接，和 final answer delta 同样可回放
//   - final answer 第一帧到达后，delta.ts 会把 thought 占位气泡切换为真实 answerId

import type { ProjectionState } from '../state.js';
import type {
  AssistantBubbleItem,
  AssistantThoughtChunk,
  EventEnvelope
} from '../types.js';
import { thoughtAssistantItemId } from '../helpers/ids.js';
import {
  appendItem,
  bindStreamingItem,
  replaceItem
} from '../helpers/item-ops.js';
import {
  readThoughtCompletePayload,
  readThoughtDeltaPayload
} from '../helpers/payload-readers.js';

export function reduceThoughtDelta(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const runId = event.runId;
  if (runId === undefined || runId.length === 0 || state.settledRunIds.has(runId)) {
    return state;
  }
  if (state.conversationId !== null
    && event.conversationId !== undefined
    && event.conversationId !== state.conversationId) {
    return state;
  }
  const payload = readThoughtDeltaPayload(event.payload);
  if (payload === null || payload.chunk.length === 0) {
    return state;
  }

  const item = readOrCreateThoughtItem(state, event, runId, payload.thoughtId);
  const existingThought = item.thoughtChunks.find((chunk) => chunk.id === payload.thoughtId);
  if (existingThought?.chunks.has(payload.chunkSeq) === true) {
    return state;
  }
  const nextThought = appendThoughtDelta(existingThought, payload.thoughtId, payload.chunkSeq, payload.chunk, event.createdAt);
  const nextItem = replaceThoughtChunk(item, nextThought);
  const nextState = item.id === nextItem.id && state.itemsById.has(nextItem.id)
    ? replaceItem(state, nextItem)
    : appendItem(state, nextItem);
  return bindStreamingItem(nextState, runId, nextItem.id);
}

export function reduceThoughtComplete(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const runId = event.runId;
  if (runId === undefined || runId.length === 0) {
    return state;
  }
  if (state.conversationId !== null
    && event.conversationId !== undefined
    && event.conversationId !== state.conversationId) {
    return state;
  }
  const payload = readThoughtCompletePayload(event.payload);
  if (payload === null) {
    return state;
  }

  const item = readOrCreateThoughtItem(state, event, runId, payload.thoughtId);
  const existingThought = item.thoughtChunks.find((chunk) => chunk.id === payload.thoughtId);
  const completedThought = completeThought(existingThought, payload.thoughtId, payload.text, event.createdAt);
  const nextItem = replaceThoughtChunk(item, completedThought);
  const nextState = item.id === nextItem.id && state.itemsById.has(nextItem.id)
    ? replaceItem(state, nextItem)
    : appendItem(state, nextItem);
  return bindStreamingItem(nextState, runId, nextItem.id);
}

function readOrCreateThoughtItem(
  state: ProjectionState,
  event: EventEnvelope,
  runId: string,
  thoughtId: string
): AssistantBubbleItem {
  const activeItemId = state.streamingItemIdByRun.get(runId);
  const activeItem = activeItemId === undefined ? undefined : state.itemsById.get(activeItemId);
  if (activeItem?.kind === 'assistant_bubble' && activeItem.streaming && activeItem.text.length === 0) {
    // 只有“仍在流式中、且还没开始输出正文”的 assistant 气泡能继续承接 thought。
    // 工具调用后，同一个 run 可能再次进入 LLM 思考；如果旧气泡已经有正文，
    // 新 thought 必须先形成新的占位气泡，等待下一段 answer delta 来领走。
    return activeItem;
  }

  const itemId = thoughtAssistantItemId(runId, thoughtId);
  return {
    kind: 'assistant_bubble',
    id: itemId,
    conversationId: event.conversationId ?? state.conversationId ?? '',
    createdAt: event.createdAt,
    text: '',
    streaming: true,
    messageId: itemId,
    runId,
    answerId: '',
    chunks: new Map(),
    thoughtChunks: []
  };
}

function appendThoughtDelta(
  existing: AssistantThoughtChunk | undefined,
  thoughtId: string,
  chunkSeq: number,
  chunk: string,
  occurredAt: number
): AssistantThoughtChunk {
  const chunks = new Map(existing?.chunks ?? []);
  chunks.set(chunkSeq, chunk);
  return {
    id: thoughtId,
    chunks,
    text: concatChunks(chunks),
    completed: existing?.completed ?? false,
    startedAt: Math.min(existing?.startedAt ?? occurredAt, occurredAt),
    updatedAt: Math.max(existing?.updatedAt ?? occurredAt, occurredAt),
    ...(existing?.completedAt === undefined ? {} : { completedAt: existing.completedAt })
  };
}

function completeThought(
  existing: AssistantThoughtChunk | undefined,
  thoughtId: string,
  text: string,
  occurredAt: number
): AssistantThoughtChunk {
  const chunks = existing?.chunks ?? new Map<number, string>();
  return {
    id: thoughtId,
    chunks,
    text: text.length > 0 ? text : (existing?.text ?? ''),
    completed: true,
    startedAt: existing?.startedAt ?? occurredAt,
    updatedAt: occurredAt,
    completedAt: occurredAt
  };
}

function replaceThoughtChunk(
  item: AssistantBubbleItem,
  thought: AssistantThoughtChunk
): AssistantBubbleItem {
  const existingIndex = item.thoughtChunks.findIndex((chunk) => chunk.id === thought.id);
  if (existingIndex >= 0) {
    const nextThoughts = item.thoughtChunks.map((chunk, index) => index === existingIndex ? thought : chunk);
    return {
      ...item,
      thoughtChunks: nextThoughts
    };
  }
  return {
    ...item,
    thoughtChunks: [...item.thoughtChunks, thought]
  };
}

function concatChunks(chunks: ReadonlyMap<number, string>): string {
  const seqs = Array.from(chunks.keys()).sort((a, b) => a - b);
  let text = '';
  for (const seq of seqs) {
    text += chunks.get(seq) ?? '';
  }
  return text;
}
