import type { RuntimeEventEnvelope } from '@renderer/contracts';
import { hydrateFromMessages, hydrateFromMessagesAndEvents } from '../../features/chat/projection/hydration.js';
import { createInitialState, type ProjectionState } from '../../features/chat/projection/state.js';
import type { ChatAppState, ChatStateSetter } from '../../stores/chat-app-state.js';
import type { ConversationMessage } from '../daemon-api.js';
import { historyEventHydrationLimit } from '../history-hydration.js';

const emptyRuntimeEvents: readonly RuntimeEventEnvelope[] = [];

// 把 daemon readMessages 拿到的历史消息列表同步进 projection 状态。
// selectConversation / 启动时初始 hydration 都走这条路径，保证“历史 / 增量”同源。
export function projectionFromHistory(
  conversationId: string | null,
  messages: readonly ConversationMessage[]
): ProjectionState {
  if (conversationId === null) {
    return createInitialState(null);
  }
  return hydrateFromMessages(conversationId, messages);
}

// 双源 hydrate：messages（消息表权威）+ events（事件流原始日志）。
// caller 负责并发请求两个 endpoint，再把结果都喂进来。
export function projectionFromHistoryWithEvents(
  conversationId: string | null,
  messages: readonly ConversationMessage[],
  events: readonly RuntimeEventEnvelope[]
): ProjectionState {
  if (conversationId === null) {
    return createInitialState(null);
  }
  return hydrateFromMessagesAndEvents(conversationId, messages, events);
}

export async function selectConversation(
  conversationId: string,
  state: ChatAppState,
  setState: ChatStateSetter
): Promise<void> {
  if (state.client === null) return;
  // 并发拉两个源：messages 是消息状态权威；events 是事件流原始日志。
  // events 出错时降级为单源（messages）以兼容旧 daemon。
  const [messages, events] = await Promise.all([
    state.client.readMessages(conversationId),
    state.client.readEvents(conversationId, { limit: historyEventHydrationLimit }).catch(() => emptyRuntimeEvents)
  ]);
  await state.client.setUiPreference('last_opened_conversation_id', conversationId);
  setState((current) => ({
    ...current,
    selectedConversationId: conversationId,
    pendingDesktopConversation: false,
    projection: projectionFromHistoryWithEvents(conversationId, messages, events),
    preferences: {
      ...current.preferences,
      last_opened_conversation_id: conversationId
    }
  }));
}
