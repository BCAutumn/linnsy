// message.inbound 投影器：把入站消息映射成 UserBubble / AssistantBubble。
//
// 守住的不变量：
//   - 坑 #4：同 messageId 二次到达 no-op（state 引用不变）
//   - 坑 #8：不属于当前 conversation 的事件被忽略（caller 已在 reducer 主入口判断；这里再做一层防御）
//   - clientMessageId 替换 optimistic 时，保持 itemOrder 中的位置不变（不 push 末尾）

import type { ProjectionState } from '../state.js';
import type {
  AssistantBubbleItem,
  EventEnvelope,
  UserBubbleItem
} from '../types.js';
import { settledAssistantItemId, userBubbleItemId } from '../helpers/ids.js';
import { appendItem, swapItemId } from '../helpers/item-ops.js';
import { readMessagePayload } from '../helpers/payload-readers.js';

export function reduceInbound(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const message = readMessagePayload(event.payload, event.conversationId);
  if (message === null) {
    return state;
  }
  if (state.conversationId !== null && message.conversationId !== state.conversationId) {
    return state;
  }

  if (message.role === 'user') {
    const targetId = userBubbleItemId(message.messageId);
    if (state.itemsById.has(targetId)) {
      return state;
    }
    const optimisticId = readClientMessageId(message.metadata);
    const item: UserBubbleItem = {
      kind: 'user_bubble',
      id: targetId,
      conversationId: message.conversationId ?? '',
      createdAt: message.createdAt,
      text: message.text ?? '',
      messageId: message.messageId,
      ...(optimisticId === undefined ? {} : { clientMessageId: optimisticId }),
      ...(message.metadata === undefined ? {} : { metadata: message.metadata })
    };
    if (optimisticId !== undefined && state.itemsById.has(optimisticId)) {
      return swapItemId(state, optimisticId, item);
    }
    return appendItem(state, item);
  }

  // 非 user 的 inbound（assistant outbound 落库回放 / system 注入）→ AssistantBubble，已 settled。
  const assistantId = settledAssistantItemId(message.messageId);
  if (state.itemsById.has(assistantId)) {
    return state;
  }
  const assistantItem: AssistantBubbleItem = {
    kind: 'assistant_bubble',
    id: assistantId,
    conversationId: message.conversationId ?? '',
    createdAt: message.createdAt,
    text: message.text ?? '',
    streaming: false,
    messageId: message.messageId,
    runId: message.runId ?? '',
    answerId: '',
    chunks: new Map(),
    thoughtChunks: [],
    ...(message.metadata === undefined ? {} : { metadata: message.metadata })
  };
  return appendItem(state, assistantItem);
}

function readClientMessageId(metadata: Record<string, unknown> | undefined): string | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  const value = metadata.clientMessageId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
