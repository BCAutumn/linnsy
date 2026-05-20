// message.complete 投影器：流式 AssistantBubble 收尾，切换为权威 messageId。
//
// 守住的不变量：
//   - 坑 #4：完成后 runId 进 settledRunIds；后续同 runId 的 delta 必须被 reduceDelta 丢弃
//   - 坑 #1：同 messageId（最终态）二次 complete no-op（state 引用不变）
//   - 坑 #7：仅替换"该 runId 当前流式槽位"对应的 itemId；同 runId 早期 answerId 的 settled item 保持不变

import type { ProjectionState } from '../state.js';
import type {
  AssistantBubbleItem,
  EventEnvelope
} from '../types.js';
import { settledAssistantItemId } from '../helpers/ids.js';
import {
  appendItem,
  markRunSettled,
  swapItemId
} from '../helpers/item-ops.js';
import { readMessagePayload } from '../helpers/payload-readers.js';
import { completeThoughtChunks } from '../helpers/thought-ops.js';

export function reduceComplete(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const message = readMessagePayload(event.payload, event.conversationId);
  if (message === null) {
    return state;
  }
  if (state.conversationId !== null
    && message.conversationId !== state.conversationId) {
    return state;
  }
  const runId = event.runId ?? message.runId;
  const settledId = settledAssistantItemId(message.messageId);

  if (state.itemsById.has(settledId)) {
    return runId === undefined ? state : markRunSettled(state, runId);
  }

  const streamingItemId = runId === undefined
    ? undefined
    : state.streamingItemIdByRun.get(runId);
  const existing = streamingItemId === undefined
    ? undefined
    : state.itemsById.get(streamingItemId);

  const finalText = message.text ?? (existing?.kind === 'assistant_bubble' ? existing.text : '');
  const thoughtChunks = existing?.kind === 'assistant_bubble'
    ? completeThoughtChunks(existing.thoughtChunks, message.createdAt)
    : [];
  // settled AssistantBubble 的内部缓存（chunks / answerId）在收尾后不再有意义——
  // 把它们清空，让 "实时 reduce" 和 "历史 hydrate" 两条路径出来的 settled bubble
  // 在结构上完全 deep-equal（守 §3.5 第 4 条不变量"回放等价"）。
  const baseItem: AssistantBubbleItem = {
    kind: 'assistant_bubble',
    id: settledId,
    conversationId: message.conversationId ?? state.conversationId ?? '',
    createdAt: message.createdAt,
    text: finalText,
    streaming: false,
    messageId: message.messageId,
    runId: runId ?? message.runId ?? '',
    answerId: '',
    chunks: new Map(),
    thoughtChunks,
    ...(message.metadata === undefined ? {} : { metadata: message.metadata })
  };

  const stateAfterReplace = streamingItemId === undefined
    ? appendItem(state, baseItem)
    : swapItemId(state, streamingItemId, baseItem);

  return runId === undefined ? stateAfterReplace : markRunSettled(stateAfterReplace, runId);
}
