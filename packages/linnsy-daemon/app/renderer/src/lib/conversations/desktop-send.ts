import type { RuntimeClientEvent, ConversationSummary } from '../daemon-api.js';
import { t } from '../i18n.js';
import { reduce as reduceProjection } from '../../features/chat/projection/reducer.js';
import { createInitialState } from '../../features/chat/projection/state.js';
import type { ChatAppState, ChatStateSetter } from '../../stores/chat-app-state.js';
import { moveConversationToTopAfterMessage, upsertConversation } from './list-ops.js';
import { projectionFromHistory } from './hydrate-actions.js';

export function startNewDesktopConversation(setState: ChatStateSetter): void {
  setState((current) => ({
    ...current,
    selectedConversationId: null,
    pendingDesktopConversation: true,
    projection: createInitialState(null),
    status: t(current.preferences.language, 'connectionStatusConnected')
  }));
}

export async function sendDesktopMessage(
  text: string,
  state: ChatAppState,
  setState: ChatStateSetter
): Promise<void> {
  const client = state.client;
  if (client === null) return;

  const selectedConversation = findSelectedConversation(state);
  setState((current) => ({
    ...current,
    status: t(current.preferences.language, 'connectionStatusSending')
  }));

  const targetConversation = selectedConversation ?? await createPendingDesktopConversation(state, client, setState);
  const clientMessageId = `local_${String(Date.now())}`;
  const createdAt = Date.now();
  // optimistic 写入：构造一条本地 inbound 事件喂 projection reducer。
  // messageId 用 clientMessageId 占位；权威态从 daemon 回流时，inbound projector 通过
  // metadata.clientMessageId 找到这条 optimistic UserBubble 并 swapItemId 切换到真正 messageId。
  const optimisticEvent: RuntimeClientEvent = {
    eventId: `optimistic:${clientMessageId}`,
    seq: -1,
    kind: 'message.inbound',
    createdAt,
    conversationId: targetConversation.conversationId,
    messageId: clientMessageId,
    payload: {
      message: {
        messageId: clientMessageId,
        conversationId: targetConversation.conversationId,
        role: 'user',
        source: 'inbound',
        text,
        metadata: { clientMessageId },
        createdAt
      }
    }
  };

  setState((current) => ({
    ...current,
    conversations: moveConversationToTopAfterMessage(
      current.conversations,
      targetConversation.conversationId,
      {
        text,
        role: 'user',
        source: 'inbound',
        updatedAt: createdAt
      }
    ),
    selectedConversationId: current.selectedConversationId === targetConversation.conversationId
      ? targetConversation.conversationId
      : current.selectedConversationId,
    pendingDesktopConversation: current.selectedConversationId === targetConversation.conversationId
      ? false
      : current.pendingDesktopConversation,
    projection: current.selectedConversationId === targetConversation.conversationId
      ? reduceProjection(current.projection, optimisticEvent)
      : current.projection,
    status: t(current.preferences.language, 'connectionStatusSending')
  }));

  await client.sendDesktopMessage({
    text,
    conversationId: targetConversation.conversationId,
    metadata: { clientMessageId }
  });

  setState((current) => ({
    ...current,
    status: current.client === client
      ? t(current.preferences.language, 'connectionStatusSent')
      : current.status
  }));
}

export function canEditCurrentConversation(state: ChatAppState): boolean {
  void state;
  return true;
}

export function canSendCurrentDesktopMessage(state: ChatAppState, text: string): boolean {
  return state.client !== null
    && text.trim().length > 0
    && canEditCurrentConversation(state);
}

function findSelectedConversation(state: ChatAppState): ConversationSummary | undefined {
  if (state.selectedConversationId === null) {
    return undefined;
  }
  return state.conversations.find((conversation) => conversation.conversationId === state.selectedConversationId);
}

async function createPendingDesktopConversation(
  state: ChatAppState,
  client: NonNullable<ChatAppState['client']>,
  setState: ChatStateSetter
): Promise<ConversationSummary> {
  const conversation = await client.createDesktopConversation();
  await client.setUiPreference('last_opened_conversation_id', conversation.conversationId);
  setState((current) => ({
    ...current,
    conversations: upsertConversation(current.conversations, conversation),
    selectedConversationId: current.pendingDesktopConversation && current.selectedConversationId === null
      ? conversation.conversationId
      : current.selectedConversationId,
    pendingDesktopConversation: current.pendingDesktopConversation && current.selectedConversationId === null
      ? false
      : current.pendingDesktopConversation,
    projection: current.pendingDesktopConversation && current.selectedConversationId === null
      ? projectionFromHistory(conversation.conversationId, [])
      : current.projection,
    preferences: {
      ...current.preferences,
      last_opened_conversation_id: conversation.conversationId
    }
  }));
  return conversation;
}
