import { useMemo, type Dispatch, type SetStateAction } from 'react';

import {
  replaceConversationStore,
  useConversationStore
} from './conversation-store.js';
import {
  replaceProjectionStore,
  useProjectionStore
} from './projection-store.js';
import {
  replacePreferencesStore,
  usePreferencesStore
} from './preferences-store.js';
import {
  replaceApplicationConnectionsStore,
  useApplicationConnectionsStore
} from './application-connections-store.js';
import {
  didApplicationConnectionsSliceChange,
  didConversationSliceChange,
  didPreferencesSliceChange,
  didProjectionSliceChange,
  splitChatAppState,
  type ChatAppState
} from './chat-app-state-slices.js';

export type { ChatAppState } from './chat-app-state-slices.js';

export type ChatStateSetter = Dispatch<SetStateAction<ChatAppState>>;

export function useChatAppStateSnapshot(): ChatAppState {
  const conversation = useConversationStore();
  const projection = useProjectionStore((state) => state.projection);
  const preferences = usePreferencesStore((state) => state.preferences);
  const connections = useApplicationConnectionsStore();

  return useMemo(() => ({
    ...conversation,
    projection,
    preferences,
    applicationConnections: connections.applicationConnections,
    channelStatuses: connections.channelStatuses
  }), [
    conversation,
    projection,
    preferences,
    connections.applicationConnections,
    connections.channelStatuses
  ]);
}

export function getChatAppStateSnapshot(): ChatAppState {
  const conversation = useConversationStore.getState();
  const projection = useProjectionStore.getState();
  const preferences = usePreferencesStore.getState();
  const connections = useApplicationConnectionsStore.getState();
  return {
    ...conversation,
    ...projection,
    ...preferences,
    ...connections
  };
}

export function resetChatStores(state: ChatAppState): void {
  const slices = splitChatAppState(state);
  replaceConversationStore(slices.conversation);
  replaceProjectionStore(slices.projection);
  replacePreferencesStore(slices.preferences);
  replaceApplicationConnectionsStore(slices.applicationConnections);
}

export const setChatAppState: ChatStateSetter = (update) => {
  const current = getChatAppStateSnapshot();
  const next = typeof update === 'function' ? update(current) : update;
  const slices = splitChatAppState(next);
  if (didConversationSliceChange(current, next)) {
    replaceConversationStore(slices.conversation);
  }
  if (didProjectionSliceChange(current, next)) {
    replaceProjectionStore(slices.projection);
  }
  if (didPreferencesSliceChange(current, next)) {
    replacePreferencesStore(slices.preferences);
  }
  if (didApplicationConnectionsSliceChange(current, next)) {
    replaceApplicationConnectionsStore(slices.applicationConnections);
  }
};
