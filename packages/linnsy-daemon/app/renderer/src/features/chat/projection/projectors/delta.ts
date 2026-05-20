// message.delta 投影器：把流式 chunk 拼接到对应 AssistantBubble。
//
// 守住的不变量：
//   - 坑 #2：起止换行 / 多字节字符不 trim；空 chunk no-op
//   - 坑 #3：不存在则用流式 itemId 创建一条新 AssistantBubble；存在则原地 append
//   - 坑 #4：runId 已 settled → no-op
//   - 坑 #6：chunks 用 Map<chunkSeq, content> 存储，text 字段每次按 key 排序后重拼
//   - 坑 #7：不同 answerId 形成不同的 streaming itemId（streamingAssistantItemId 派生）

import type { ProjectionState } from '../state.js';
import type {
  AssistantBubbleItem,
  ConversationItem,
  EventEnvelope
} from '../types.js';
import { streamingAssistantItemId } from '../helpers/ids.js';
import {
  appendItem,
  bindStreamingItem,
  swapItemId,
  replaceItem
} from '../helpers/item-ops.js';
import { readDeltaPayload } from '../helpers/payload-readers.js';
import { completeThoughtChunks } from '../helpers/thought-ops.js';

export function reduceDelta(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const runId = event.runId;
  if (runId === undefined || runId.length === 0) {
    return state;
  }
  if (state.settledRunIds.has(runId)) {
    return state;
  }
  const payload = readDeltaPayload(event.payload);
  if (payload === null) {
    return state;
  }
  if (payload.delta.length === 0) {
    return state;
  }
  if (state.conversationId !== null
    && event.conversationId !== undefined
    && event.conversationId !== state.conversationId) {
    return state;
  }

  const itemId = streamingAssistantItemId(runId, payload.answerId);
  const activeItemId = state.streamingItemIdByRun.get(runId);
  const activeItem = activeItemId === undefined ? undefined : state.itemsById.get(activeItemId);
  const shouldAdoptActiveThoughtItem =
    activeItem !== undefined &&
    activeItem.kind === 'assistant_bubble' &&
    activeItem.streaming &&
    activeItem.text.length === 0 &&
    activeItem.thoughtChunks.length > 0 &&
    activeItem.id !== itemId;
  const stateWithPreviousSegmentSettled = settlePreviousAnswerSegment({
    state,
    activeItem,
    nextItemId: itemId,
    shouldAdoptActiveThoughtItem
  });
  const existingRaw = stateWithPreviousSegmentSettled.itemsById.get(itemId)
    ?? (shouldAdoptActiveThoughtItem ? activeItem : undefined);
  const existing = existingRaw?.kind === 'assistant_bubble' ? existingRaw : undefined;

  if (existing === undefined) {
    const chunks = new Map<number, string>();
    chunks.set(payload.chunkSeq, payload.delta);
    const item: AssistantBubbleItem = {
      kind: 'assistant_bubble',
      id: itemId,
      conversationId: event.conversationId ?? state.conversationId ?? '',
      createdAt: event.createdAt,
      text: payload.delta,
      streaming: true,
      messageId: itemId,
      runId,
      answerId: payload.answerId,
      chunks,
      thoughtChunks: []
    };
    const withItem = appendItem(stateWithPreviousSegmentSettled, item);
    return bindStreamingItem(withItem, runId, itemId);
  }

  if (existing.chunks.has(payload.chunkSeq)) {
    return state;
  }
  const nextChunks = new Map(existing.chunks);
  nextChunks.set(payload.chunkSeq, payload.delta);
  const nextItem: AssistantBubbleItem = {
    ...existing,
    id: itemId,
    messageId: itemId,
    answerId: payload.answerId,
    chunks: nextChunks,
    text: concatChunks(nextChunks),
    createdAt: event.createdAt,
    // 正文第一帧到达时，上一段思考已经结束；有些 provider 只给 thought delta，
    // 不补 thought_complete，所以这里由投影层按时序事实收尾，避免思考链光标残留。
    thoughtChunks: completeThoughtChunks(existing.thoughtChunks, event.createdAt)
  };
  const replaced = existing.id === itemId
    ? replaceItem(stateWithPreviousSegmentSettled, nextItem)
    : swapItemId(stateWithPreviousSegmentSettled, existing.id, nextItem);
  return bindStreamingItem(replaced, runId, itemId);
}

function settlePreviousAnswerSegment(input: {
  state: ProjectionState;
  activeItem: ConversationItem | undefined;
  nextItemId: string;
  shouldAdoptActiveThoughtItem: boolean;
}): ProjectionState {
  const activeItem = input.activeItem;
  if (
    activeItem === undefined ||
    activeItem.kind !== 'assistant_bubble' ||
    activeItem.id === input.nextItemId ||
    !activeItem.streaming ||
    input.shouldAdoptActiveThoughtItem
  ) {
    return input.state;
  }
  // 同一个 run 内出现新的 answerId，说明上一段回答已经停笔，后续 delta 应写入新气泡。
  // 不标记 run settled，因为同一 run 还会继续产生工具卡与下一段回答。
  return replaceItem(input.state, {
    ...activeItem,
    streaming: false
  });
}

// 按 chunkSeq 升序拼接。即使 chunks 乱序到达，最终 text 总是正序的。
function concatChunks(chunks: ReadonlyMap<number, string>): string {
  const seqs = Array.from(chunks.keys()).sort((a, b) => a - b);
  let text = '';
  for (const seq of seqs) {
    text += chunks.get(seq) ?? '';
  }
  return text;
}
