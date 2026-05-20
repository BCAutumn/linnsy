import type React from 'react';
import { describe, expect, test, vi } from 'vitest';

import type { ChannelDesktopStatus } from '@renderer/contracts';
import type { ApplicationConnectionsSnapshot } from '@renderer/contracts';
import {
  canEditCurrentConversation,
  canSendCurrentDesktopMessage,
  archiveConversation,
  deleteConversation,
  renameConversation,
  selectConversation,
  sendDesktopMessage,
  setConversationPinned,
  startNewDesktopConversation,
  type ChatAppState
} from '../chat-actions.js';
import type { DaemonApiClient, ModelSettings, UiPreferences } from '../daemon-api.js';
import { historyEventHydrationLimit } from '../history-hydration.js';
import { createTerminalBindingOptions } from '../../features/settings/terminal-binding-options.js';
import { createInitialState } from '../../features/chat/projection/state.js';

describe('chat actions', () => {
  test('starts a pending desktop conversation without touching daemon state', () => {
    const harness = createStateHarness(appState({
      selectedConversationId: 'conv_1'
    }));

    startNewDesktopConversation(harness.setState);

    expect(harness.state.selectedConversationId).toBeNull();
    expect(harness.state.pendingDesktopConversation).toBe(true);
    expect(harness.state.projection.itemOrder).toEqual([]);
    expect(harness.state.projection.conversationId).toBeNull();
  });

  test('creates a desktop conversation before sending the first pending message', async () => {
    const createDesktopConversation = vi.fn<DaemonApiClient['createDesktopConversation']>(() => Promise.resolve({
      conversationId: 'conv_new',
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:branch:new',
      updatedAt: 10,
      lastActivityAt: 10
    }));
    const sendDesktop = vi.fn<DaemonApiClient['sendDesktopMessage']>(() => Promise.resolve());
    const setUiPreference = vi.fn<DaemonApiClient['setUiPreference']>(() => Promise.resolve());
    const harness = createStateHarness(appState({
      client: daemonClient({
        createDesktopConversation,
        sendDesktopMessage: sendDesktop,
        setUiPreference
      }),
      conversations: [],
      selectedConversationId: null,
      pendingDesktopConversation: true
    }));

    await sendDesktopMessage('第一句', harness.state, harness.setState);

    expect(createDesktopConversation).toHaveBeenCalledTimes(1);
    expect(setUiPreference).toHaveBeenCalledWith('last_opened_conversation_id', 'conv_new');
    expect(sendDesktop).toHaveBeenCalledWith(expect.objectContaining({
      text: '第一句',
      conversationId: 'conv_new'
    }));
    expect(createDesktopConversation.mock.invocationCallOrder[0]).toBeLessThan(sendDesktop.mock.invocationCallOrder[0] ?? 0);
    expect(harness.state.selectedConversationId).toBe('conv_new');
    expect(harness.state.pendingDesktopConversation).toBe(false);
    expect(harness.state.conversations[0]).toMatchObject({
      conversationId: 'conv_new',
      title: '第一句'
    });
  });

  test('does not move the user back to a pending conversation after they switch away during creation', async () => {
    const createDesktopConversationDeferred = createDeferred<Awaited<ReturnType<DaemonApiClient['createDesktopConversation']>>>();
    const createDesktopConversation = vi.fn<DaemonApiClient['createDesktopConversation']>(() => (
      createDesktopConversationDeferred.promise
    ));
    const sendDesktop = vi.fn<DaemonApiClient['sendDesktopMessage']>(() => Promise.resolve());
    const harness = createStateHarness(appState({
      client: daemonClient({
        createDesktopConversation,
        sendDesktopMessage: sendDesktop
      }),
      conversations: [{
        conversationId: 'conv_other',
        platform: 'desktop',
        chatType: 'private',
        chatId: 'window:branch:other',
        updatedAt: 20,
        lastActivityAt: 20
      }],
      selectedConversationId: null,
      pendingDesktopConversation: true,
      projection: createInitialState(null)
    }));

    const sending = sendDesktopMessage('第一句', harness.state, harness.setState);
    harness.setState((current) => ({
      ...current,
      selectedConversationId: 'conv_other',
      pendingDesktopConversation: false,
      projection: createInitialState('conv_other')
    }));
    createDesktopConversationDeferred.resolve({
      conversationId: 'conv_new',
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:branch:new',
      updatedAt: 10,
      lastActivityAt: 10
    });
    await sending;

    expect(sendDesktop).toHaveBeenCalledWith(expect.objectContaining({
      text: '第一句',
      conversationId: 'conv_new'
    }));
    expect(harness.state.selectedConversationId).toBe('conv_other');
    expect(harness.state.projection.conversationId).toBe('conv_other');
    expect(harness.state.projection.itemOrder).toEqual([]);
  });

  test('sends existing desktop conversations without creating a new one', async () => {
    const createDesktopConversation = vi.fn<DaemonApiClient['createDesktopConversation']>(() => Promise.reject(new Error('not used')));
    const sendDesktop = vi.fn<DaemonApiClient['sendDesktopMessage']>(() => Promise.resolve());
    const harness = createStateHarness(appState({
      client: daemonClient({
        createDesktopConversation,
        sendDesktopMessage: sendDesktop
      })
    }));

    await sendDesktopMessage('继续聊', harness.state, harness.setState);

    expect(createDesktopConversation).not.toHaveBeenCalled();
    expect(sendDesktop).toHaveBeenCalledWith(expect.objectContaining({
      text: '继续聊',
      conversationId: 'conv_1'
    }));
  });

  test('sends from desktop into an existing phone conversation by conversation id', async () => {
    const sendDesktop = vi.fn<DaemonApiClient['sendDesktopMessage']>(() => Promise.resolve());
    const harness = createStateHarness(appState({
      client: daemonClient({ sendDesktopMessage: sendDesktop }),
      conversations: [
        {
          conversationId: 'conv_wechat',
          platform: 'wechat',
          chatType: 'private',
          chatId: 'wx_user_1',
          updatedAt: 2,
          lastActivityAt: 2
        }
      ],
      selectedConversationId: 'conv_wechat',
      pendingDesktopConversation: false
    }));

    expect(canEditCurrentConversation(harness.state)).toBe(true);
    expect(canSendCurrentDesktopMessage(harness.state, '可以发')).toBe(true);
    await sendDesktopMessage('可以发', harness.state, harness.setState);

    expect(sendDesktop).toHaveBeenCalledWith(expect.objectContaining({
      text: '可以发',
      conversationId: 'conv_wechat'
    }));
  });

  test('uses conversation title for phone terminal binding options', () => {
    const options = createTerminalBindingOptions(appState({
      conversations: [
        {
          conversationId: 'conv_1',
          title: '上午项目讨论',
          platform: 'desktop',
          chatType: 'private',
          chatId: 'window:main',
          updatedAt: 1,
          lastActivityAt: 1
        }
      ]
    }), 'zh-CN');

    expect(options).toEqual([{ value: 'conv_1', text: '上午项目讨论' }]);
  });

  test('selects a conversation with the full recent event hydration window', async () => {
    const readEvents = vi.fn<DaemonApiClient['readEvents']>(() => Promise.resolve([]));
    const setUiPreference = vi.fn<DaemonApiClient['setUiPreference']>(() => Promise.resolve());
    const harness = createStateHarness(appState({
      client: daemonClient({
        readEvents,
        setUiPreference
      })
    }));

    await selectConversation('conv_1', harness.state, harness.setState);

    expect(readEvents).toHaveBeenCalledWith('conv_1', { limit: historyEventHydrationLimit });
    expect(setUiPreference).toHaveBeenCalledWith('last_opened_conversation_id', 'conv_1');
  });

  test('renames and pins conversations through the daemon client', async () => {
    const rename = vi.fn<DaemonApiClient['renameConversation']>((conversationId, title) => Promise.resolve({
      conversationId,
      ...(title === null ? {} : { title }),
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:main',
      updatedAt: 10,
      lastActivityAt: 1
    }));
    const pin = vi.fn<DaemonApiClient['setConversationPinned']>((conversationId, pinned) => Promise.resolve({
      conversationId,
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:main',
      updatedAt: 11,
      lastActivityAt: 1,
      ...(pinned ? { pinnedAt: 11 } : {})
    }));
    const harness = createStateHarness(appState({
      client: daemonClient({
        renameConversation: rename,
        setConversationPinned: pin
      })
    }));

    await renameConversation('conv_1', '项目讨论', harness.state, harness.setState);
    await setConversationPinned('conv_1', true, harness.state, harness.setState);

    expect(rename).toHaveBeenCalledWith('conv_1', '项目讨论');
    expect(pin).toHaveBeenCalledWith('conv_1', true);
    expect(harness.state.conversations[0]).toMatchObject({
      conversationId: 'conv_1',
      pinnedAt: 11
    });
  });

  test('archives or deletes the selected conversation and returns to pending chat', async () => {
    const archive = vi.fn<DaemonApiClient['archiveConversation']>((conversationId) => Promise.resolve({
      conversationId,
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:main',
      updatedAt: 2,
      lastActivityAt: 1,
      archivedAt: 2
    }));
    const deleteById = vi.fn<DaemonApiClient['deleteConversation']>(() => Promise.resolve(true));
    const setUiPreference = vi.fn<DaemonApiClient['setUiPreference']>(() => Promise.resolve());
    const archiveHarness = createStateHarness(appState({
      client: daemonClient({
        archiveConversation: archive,
        setUiPreference
      })
    }));

    await archiveConversation('conv_1', archiveHarness.state, archiveHarness.setState);

    expect(archiveHarness.state.conversations).toEqual([]);
    expect(archiveHarness.state.selectedConversationId).toBeNull();
    expect(archiveHarness.state.pendingDesktopConversation).toBe(true);
    expect(setUiPreference).toHaveBeenCalledWith('last_opened_conversation_id', null);

    const deleteHarness = createStateHarness(appState({
      client: daemonClient({
        deleteConversation: deleteById,
        setUiPreference
      })
    }));
    await deleteConversation('conv_1', deleteHarness.state, deleteHarness.setState);
    expect(deleteById).toHaveBeenCalledWith('conv_1');
    expect(deleteHarness.state.conversations).toEqual([]);
    expect(deleteHarness.state.selectedConversationId).toBeNull();
  });
});

function createStateHarness(initial: ChatAppState): {
  readonly state: ChatAppState;
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>;
} {
  let current = initial;
  return {
    get state() {
      return current;
    },
    setState(action) {
      current = typeof action === 'function' ? action(current) : action;
    }
  };
}

function createDeferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolveValue: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (resolveValue === undefined) {
        throw new Error('deferred promise was not initialized');
      }
      resolveValue(value);
    }
  };
}

function appState(overrides: Partial<ChatAppState> = {}): ChatAppState {
  return {
    client: daemonClient({}),
    conversations: [
      {
        conversationId: 'conv_1',
        platform: 'desktop',
        chatType: 'private',
        chatId: 'window:main',
        updatedAt: 1,
        lastActivityAt: 1
      }
    ],
    selectedConversationId: 'conv_1',
    pendingDesktopConversation: false,
    terminalBinding: {
      terminalId: 'mobile',
      conversationId: 'conv_1',
      updatedAt: 1,
      updatedBy: 'test'
    },
    applicationConnections: createApplicationConnections(),
    projection: createInitialState('conv_1'),
    preferences,
    channelStatuses: new Map<string, ChannelDesktopStatus>(),
    status: '已连接',
    error: null,
    ...overrides
  };
}

const preferences: UiPreferences = {
  'theme.mode': 'auto',
  'theme.primary_color': 'pine_cypress',
  'font.size': 'medium',
  'sidebar.width_px': 260,
  'sidebar.archived_collapsed': true,
  last_opened_conversation_id: 'conv_1',
  language: 'zh-CN',
  'scheduled.skip_inactive_delete_confirm': false
};

function daemonClient(overrides: Partial<DaemonApiClient>): DaemonApiClient {
  const modelSettings: ModelSettings = {
    chatModelId: null,
    models: [],
    userModels: []
  };
  return {
    listConversations: () => Promise.resolve([]),
    createDesktopConversation: () => Promise.resolve({
      conversationId: 'conv_new',
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:branch:new',
      updatedAt: 1,
      lastActivityAt: 1
    }),
    renameConversation: (conversationId, title) => Promise.resolve({
      conversationId,
      ...(title === null ? {} : { title }),
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:branch:new',
      updatedAt: 2,
      lastActivityAt: 1
    }),
    setConversationPinned: (conversationId, pinned) => Promise.resolve({
      conversationId,
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:branch:new',
      updatedAt: 2,
      lastActivityAt: 1,
      ...(pinned ? { pinnedAt: 2 } : {})
    }),
    archiveConversation: (conversationId) => Promise.resolve({
      conversationId,
      platform: 'desktop',
      chatType: 'private',
      chatId: 'window:branch:new',
      updatedAt: 2,
      lastActivityAt: 1,
      archivedAt: 2
    }),
    deleteConversation: () => Promise.resolve(true),
    getTerminalBinding: () => Promise.resolve({
      terminalId: 'mobile',
      conversationId: 'conv_1',
      updatedAt: 1,
      updatedBy: 'test'
    }),
    updateTerminalBinding: (conversationId) => Promise.resolve({
      terminalId: 'mobile',
      conversationId,
      updatedAt: 2,
      updatedBy: 'test'
    }),
    getApplicationConnections: () => Promise.resolve(createApplicationConnections()),
    probeCodexConnection: () => Promise.resolve(createApplicationConnections().codex),
    readMessages: () => Promise.resolve([]),
    readEvents: () => Promise.resolve([]),
    sendDesktopMessage: () => Promise.resolve(),
    openEventStream: () => ({ close: () => undefined }),
    getUiPreferences: () => Promise.resolve(preferences),
    setUiPreference: () => Promise.resolve(),
    resetUiPreferences: () => Promise.resolve(preferences),
    getModelSettings: () => Promise.resolve(modelSettings),
    saveModelSettings: () => Promise.resolve(modelSettings),
    listMemoryItems: () => Promise.resolve([]),
    getSystemPromptPreview: () => Promise.resolve({
      agentId: 'linnsy_main',
      role: 'system' as const,
      shapingVersion: 'test',
      assembledPrompt: 'backend system prompt',
      sections: []
    }),
    createMemoryItem: (input) => Promise.resolve({
      memoryId: 'mem_1',
      createdAt: 1,
      updatedAt: 1,
      ...input
    }),
    updateMemoryItem: (memoryId, input) => Promise.resolve({
      memoryId,
      createdAt: 1,
      updatedAt: 2,
      ...input
    }),
    deleteMemoryItem: () => Promise.resolve(true),
    listCron: () => Promise.resolve([]),
    createCron: (input) => Promise.resolve({
      jobId: 'cron_created',
      enabled: true,
      nextRunAt: input.schedule.kind === 'one_shot' ? input.schedule.atMs : 1,
      query: input.query,
      schedule: input.schedule
    }),
    deleteCron: () => Promise.resolve(true),
    setCronEnabled: () => Promise.resolve(true),
    listCronRuns: () => Promise.resolve([]),
    getCronRunOutput: () => Promise.reject(new Error('not used')),
    ...overrides
  };
}

function createApplicationConnections(): ApplicationConnectionsSnapshot {
  return {
    codex: {
      status: 'not_found',
      command: 'codex',
      checkedAt: 1
    },
    claudeCode: { status: 'unsupported' },
    cursor: { status: 'unsupported' }
  };
}
