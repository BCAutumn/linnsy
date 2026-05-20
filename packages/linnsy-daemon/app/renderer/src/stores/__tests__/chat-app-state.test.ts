import { beforeEach, describe, expect, it } from 'vitest';

import {
  getChatAppStateSnapshot,
  resetChatStores,
  setChatAppState,
  type ChatAppState
} from '../chat-app-state.js';
import { defaultPreferences } from '../default-preferences.js';
import { useApplicationConnectionsStore } from '../application-connections-store.js';
import { useConversationStore } from '../conversation-store.js';
import { usePreferencesStore } from '../preferences-store.js';
import { useProjectionStore } from '../projection-store.js';
import { createInitialState } from '../../features/chat/projection/state.js';

describe('chat app zustand stores', () => {
  beforeEach(() => {
    resetChatStores(createState());
  });

  it('keeps the legacy ChatAppState snapshot assembled from isolated stores', () => {
    const state = createState({
      selectedConversationId: 'conversation-a',
      pendingDesktopConversation: false,
      status: 'connected',
      channelStatuses: new Map([
        ['wechat', { channelId: 'wechat', lifecycle: 'connected', autoConnect: true }]
      ])
    });

    resetChatStores(state);

    expect(getChatAppStateSnapshot()).toEqual(state);
  });

  it('applies functional ChatAppState updates across store boundaries', () => {
    setChatAppState((current) => ({
      ...current,
      selectedConversationId: 'conversation-b',
      pendingDesktopConversation: false,
      preferences: {
        ...current.preferences,
        language: 'en-US'
      },
      applicationConnections: {
        codex: {
          status: 'available',
          command: 'codex',
          checkedAt: 1
        },
        claudeCode: { status: 'unsupported' },
        cursor: { status: 'unsupported' }
      }
    }));

    const snapshot = getChatAppStateSnapshot();
    expect(snapshot.selectedConversationId).toBe('conversation-b');
    expect(snapshot.pendingDesktopConversation).toBe(false);
    expect(snapshot.preferences.language).toBe('en-US');
    expect(snapshot.applicationConnections?.codex.status).toBe('available');
  });

  it('only writes store slices whose values actually changed', () => {
    const notifications = {
      conversation: 0,
      projection: 0,
      preferences: 0,
      connections: 0
    };
    const unsubscribers = [
      useConversationStore.subscribe(() => {
        notifications.conversation += 1;
      }),
      useProjectionStore.subscribe(() => {
        notifications.projection += 1;
      }),
      usePreferencesStore.subscribe(() => {
        notifications.preferences += 1;
      }),
      useApplicationConnectionsStore.subscribe(() => {
        notifications.connections += 1;
      })
    ];

    try {
      setChatAppState((current) => ({
        ...current,
        status: 'connected'
      }));

      expect(notifications).toEqual({
        conversation: 1,
        projection: 0,
        preferences: 0,
        connections: 0
      });
    } finally {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    }
  });
});

function createState(overrides: Partial<ChatAppState> = {}): ChatAppState {
  return {
    client: null,
    conversations: [],
    selectedConversationId: null,
    pendingDesktopConversation: true,
    terminalBinding: null,
    applicationConnections: null,
    projection: createInitialState(null),
    preferences: defaultPreferences,
    channelStatuses: new Map(),
    status: '',
    error: null,
    ...overrides
  };
}
