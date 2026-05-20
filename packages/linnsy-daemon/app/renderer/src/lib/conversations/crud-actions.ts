import { createInitialState } from '../../features/chat/projection/state.js';
import type { ChatAppState, ChatStateSetter } from '../../stores/chat-app-state.js';
import { translateDaemonError } from '../error-translation.js';
import { t } from '../i18n.js';
import { upsertConversation } from './list-ops.js';

export async function renameConversation(
  conversationId: string,
  title: string | null,
  state: ChatAppState,
  setState: ChatStateSetter
): Promise<void> {
  if (state.client === null) return;
  try {
    const conversation = await state.client.renameConversation(conversationId, title);
    setState((current) => ({
      ...current,
      conversations: upsertConversation(current.conversations, conversation),
      error: null
    }));
  } catch (error: unknown) {
    applyDaemonErrorToState(error, state, setState);
  }
}

export async function setConversationPinned(
  conversationId: string,
  pinned: boolean,
  state: ChatAppState,
  setState: ChatStateSetter
): Promise<void> {
  if (state.client === null) return;
  try {
    const conversation = await state.client.setConversationPinned(conversationId, pinned);
    setState((current) => ({
      ...current,
      conversations: upsertConversation(current.conversations, conversation),
      error: null
    }));
  } catch (error: unknown) {
    applyDaemonErrorToState(error, state, setState);
  }
}

export async function archiveConversation(
  conversationId: string,
  state: ChatAppState,
  setState: ChatStateSetter
): Promise<void> {
  if (state.client === null) return;
  try {
    await state.client.archiveConversation(conversationId);
    if (state.selectedConversationId === conversationId) {
      await state.client.setUiPreference('last_opened_conversation_id', null);
    }
    setState((current) => removeConversationFromState(current, conversationId));
  } catch (error: unknown) {
    applyDaemonErrorToState(error, state, setState);
  }
}

export async function deleteConversation(
  conversationId: string,
  state: ChatAppState,
  setState: ChatStateSetter
): Promise<void> {
  if (state.client === null) return;
  try {
    await state.client.deleteConversation(conversationId);
    if (state.selectedConversationId === conversationId) {
      await state.client.setUiPreference('last_opened_conversation_id', null);
    }
    setState((current) => removeConversationFromState(current, conversationId));
  } catch (error: unknown) {
    applyDaemonErrorToState(error, state, setState);
  }
}

export function applyDaemonErrorToState(
  error: unknown,
  state: ChatAppState,
  setState: ChatStateSetter
): void {
  const code = readDaemonErrorCode(error);
  const message = code === null
    ? t(state.preferences.language, 'operationRetryLater')
    : formatTranslatedError(code, state);
  setState((current) => ({
    ...current,
    error: message
  }));
}

function removeConversationFromState(current: ChatAppState, conversationId: string): ChatAppState {
  const nextConversations = current.conversations.filter((conversation) => conversation.conversationId !== conversationId);
  if (current.selectedConversationId !== conversationId) {
    return {
      ...current,
      conversations: nextConversations,
      error: null
    };
  }
  return {
    ...current,
    conversations: nextConversations,
    selectedConversationId: null,
    pendingDesktopConversation: true,
    projection: createInitialState(null),
    preferences: {
      ...current.preferences,
      last_opened_conversation_id: null
    },
    error: null,
    status: t(current.preferences.language, 'connectionStatusConnected')
  };
}

function formatTranslatedError(code: string, state: ChatAppState): string {
  const copy = translateDaemonError(code, state.preferences.language);
  return t(state.preferences.language, 'errorJoiner', {
    title: copy.title,
    suggestion: copy.suggestion
  });
}

function readDaemonErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
  ) {
    return error.code;
  }
  return null;
}
