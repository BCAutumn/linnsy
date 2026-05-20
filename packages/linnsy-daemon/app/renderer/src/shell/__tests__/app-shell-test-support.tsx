// @vitest-environment happy-dom

import { act } from 'react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';

import type {
  ConversationMessage,
  CreateCronInput,
  DaemonApiClient,
  MemoryItemWriteInput,
  ModelSettings,
  SystemPromptPreview,
  UiPreferences
} from '../../lib/daemon-api.js';
import type { LinnsyDesktopBridge } from '../../lib/desktop-bridge.js';
import type { ApplicationConnectionsSnapshot } from '@renderer/contracts';
import { AppShell } from '../AppShell.js';

vi.mock('@tiptap/react', async () => {
  const react = await import('react');
  function useEditor(options: {
    content?: string;
    onUpdate?: (input: { editor: FakeTiptapEditor }) => void;
  }): FakeTiptapEditor {
    const valueRef = react.useRef(options.content ?? '');
    const optionsRef = react.useRef(options);
    optionsRef.current = options;
    return react.useMemo(() => new FakeTiptapEditor(valueRef, optionsRef), []);
  }
  function EditorContent(props: {
    className?: string;
    editor: FakeTiptapEditor | null;
  }): React.JSX.Element {
    return react.createElement('div', {
      className: props.className,
      'data-markdown': props.editor?.getMarkdown() ?? ''
    });
  }
  class FakeTiptapEditor {
    public readonly commands = {
      setContent: (value: string): boolean => {
        this.valueRef.current = value;
        return true;
      }
    };
    public constructor(
      private readonly valueRef: React.MutableRefObject<string>,
      private readonly optionsRef: React.MutableRefObject<{
        content?: string;
        onUpdate?: (input: { editor: FakeTiptapEditor }) => void;
      }>
    ) {}
    public getMarkdown(): string {
      return this.valueRef.current;
    }
    public chain(): FakeTiptapCommandChain {
      return new FakeTiptapCommandChain(this);
    }
    public appendCommand(command: string): void {
      this.valueRef.current = `${this.valueRef.current}\n${command}`;
      this.optionsRef.current.onUpdate?.({ editor: this });
    }
  }
  class FakeTiptapCommandChain {
    private command = '';
    public constructor(private readonly editor: FakeTiptapEditor) {}
    public focus(): this { return this; }
    public toggleBold(): this { this.command = 'bold'; return this; }
    public toggleItalic(): this { this.command = 'italic'; return this; }
    public toggleHeading(): this { this.command = 'heading'; return this; }
    public toggleBulletList(): this { this.command = 'bulletList'; return this; }
    public toggleOrderedList(): this { this.command = 'orderedList'; return this; }
    public toggleBlockquote(): this { this.command = 'quote'; return this; }
    public run(): boolean {
      this.editor.appendCommand(this.command);
      return true;
    }
  }
  return { EditorContent, useEditor };
});

const reactActGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  delete window.linnsyDesktop;
});

afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

export const preferences: UiPreferences = {
  'theme.mode': 'auto',
  'theme.primary_color': 'pine_cypress',
  'font.size': 'medium',
  'sidebar.width_px': 260,
  'sidebar.archived_collapsed': true,
  last_opened_conversation_id: 'conv_1',
  language: 'zh-CN',
  'scheduled.skip_inactive_delete_confirm': false
};

export async function renderApp(initialPath: string, client = daemonClient()): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(AppShell, {
      initialPath,
      clientFactory: () => Promise.resolve(client)
    }));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

export async function settleEditorImport(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

export function messageFromDb(messageId: string, text: string): ConversationMessage {
  return { messageId, role: 'assistant', source: 'outbound', text, createdAt: 2 };
}

export function systemPromptPreview(...sections: Array<{
  scope: SystemPromptPreview['sections'][number]['scope'];
  body: string;
}>): SystemPromptPreview {
  const previewSections = sections.map((section) => ({
    scope: section.scope,
    heading: section.scope,
    body: section.body,
    editable: true
  }));
  return {
    agentId: 'linnsy_main',
    role: 'system',
    shapingVersion: 'test',
    assembledPrompt: previewSections.map((section) => section.body).join('\n\n'),
    sections: previewSections
  };
}

export function desktopBridge(overrides: Partial<LinnsyDesktopBridge> = {}): LinnsyDesktopBridge {
  return {
    getApiConfig: vi.fn(() => Promise.resolve({ baseUrl: 'http://127.0.0.1:7700', bearerToken: 'dev-secret' })),
    getDaemonStatus: vi.fn(() => Promise.resolve({ lifecycle: 'running' as const, running: true })),
    onDaemonStatusChanged: vi.fn(() => () => undefined),
    listChannels: vi.fn(() => Promise.resolve([{ channelId: 'wechat', lifecycle: 'idle' as const, autoConnect: false }])),
    getChannelStatus: vi.fn(() => Promise.resolve({ channelId: 'wechat', lifecycle: 'idle' as const, autoConnect: false })),
    invokeChannelAction: vi.fn((input: { channelId: string; action: { type: string } }) => Promise.resolve({
      channelId: input.channelId,
      lifecycle: input.action.type === 'stop' ? 'idle' as const : 'starting' as const,
      autoConnect: false
    })),
    onChannelStatusChanged: vi.fn(() => () => {}),
    ...overrides
  };
}

export function daemonClient(overrides: Partial<DaemonApiClient> = {}): DaemonApiClient {
  const defaultModelSettings: ModelSettings = { chatModelId: null, models: [], userModels: [] };
  const defaultApplicationConnections: ApplicationConnectionsSnapshot = {
    codex: { status: 'not_found', command: 'codex', checkedAt: 1, errorMessage: 'spawn codex ENOENT' },
    claudeCode: { status: 'unsupported' },
    cursor: { status: 'unsupported' }
  };
  return {
    listConversations: vi.fn(() => Promise.resolve([{ conversationId: 'conv_1', title: 'Desktop', platform: 'desktop', chatType: 'private', chatId: 'window:main', updatedAt: 1, lastActivityAt: 1 }])),
    createDesktopConversation: vi.fn(() => Promise.resolve({ conversationId: 'conv_new', platform: 'desktop', chatType: 'private', chatId: 'window:branch:new', updatedAt: 3, lastActivityAt: 3 })),
    renameConversation: vi.fn((conversationId: string, title: string | null) => Promise.resolve({ conversationId, ...(title === null ? {} : { title }), platform: 'desktop', chatType: 'private', chatId: 'window:branch:new', updatedAt: 4, lastActivityAt: 1 })),
    setConversationPinned: vi.fn((conversationId: string, pinned: boolean) => Promise.resolve({ conversationId, platform: 'desktop', chatType: 'private', chatId: 'window:branch:new', updatedAt: 4, lastActivityAt: 1, ...(pinned ? { pinnedAt: 4 } : {}) })),
    archiveConversation: vi.fn((conversationId: string) => Promise.resolve({ conversationId, platform: 'desktop', chatType: 'private', chatId: 'window:branch:new', updatedAt: 4, lastActivityAt: 1, archivedAt: 4 })),
    deleteConversation: vi.fn(() => Promise.resolve(true)),
    getTerminalBinding: vi.fn(() => Promise.resolve({ terminalId: 'mobile', conversationId: 'conv_1', updatedAt: 1, updatedBy: 'test' })),
    updateTerminalBinding: vi.fn((conversationId: string) => Promise.resolve({ terminalId: 'mobile', conversationId, updatedAt: 4, updatedBy: 'test' })),
    getApplicationConnections: vi.fn(() => Promise.resolve(defaultApplicationConnections)),
    probeCodexConnection: vi.fn(() => Promise.resolve(defaultApplicationConnections.codex)),
    readMessages: vi.fn(() => Promise.resolve([{ messageId: 'msg_1', role: 'assistant', source: 'outbound', text: 'hello from db', createdAt: 2 }])),
    readEvents: vi.fn(() => Promise.resolve([])),
    sendDesktopMessage: vi.fn(() => Promise.resolve()),
    openEventStream: vi.fn(() => ({ close: vi.fn() })),
    getUiPreferences: vi.fn(() => Promise.resolve(preferences)),
    setUiPreference: vi.fn(() => Promise.resolve()),
    resetUiPreferences: vi.fn(() => Promise.resolve(preferences)),
    getModelSettings: vi.fn<DaemonApiClient['getModelSettings']>(() => Promise.resolve(defaultModelSettings)),
    saveModelSettings: vi.fn<DaemonApiClient['saveModelSettings']>((input) => Promise.resolve({
      chatModelId: input.chatModelId,
      models: input.userModels.map((model) => ({
        id: `user.${model.id}`,
        provider: `user_${model.providerType}_${model.id}`,
        apiProtocol: model.providerType === 'openai_compatible' ? 'openai_chat' : 'anthropic_messages',
        modelName: model.modelName,
        ...(model.displayName === undefined ? {} : { displayName: model.displayName }),
        baseUrl: model.baseUrl,
        source: 'user' as const,
        hasApiKey: model.apiKey !== undefined
      })),
      userModels: input.userModels.map((model) => ({ ...model, hasApiKey: model.apiKey !== undefined }))
    })),
    listMemoryItems: vi.fn(() => Promise.resolve([])),
    getSystemPromptPreview: vi.fn(() => Promise.resolve({ agentId: 'linnsy_main', role: 'system' as const, shapingVersion: 'test', assembledPrompt: 'backend system prompt', sections: [] })),
    createMemoryItem: vi.fn((input: MemoryItemWriteInput) => Promise.resolve({ memoryId: 'mem_new', scope: input.scope, body: input.body, createdAt: 1, updatedAt: 1 })),
    updateMemoryItem: vi.fn((memoryId: string, input: MemoryItemWriteInput) => Promise.resolve({ memoryId, scope: input.scope, body: input.body, createdAt: 1, updatedAt: 1 })),
    deleteMemoryItem: vi.fn(() => Promise.resolve(true)),
    listCron: vi.fn(() => Promise.resolve([])),
    createCron: vi.fn((input: CreateCronInput) => Promise.resolve({ jobId: 'cron_created', enabled: true, nextRunAt: input.schedule.kind === 'one_shot' ? input.schedule.atMs : 1, query: input.query, schedule: input.schedule })),
    deleteCron: vi.fn(() => Promise.resolve(true)),
    setCronEnabled: vi.fn(() => Promise.resolve(true)),
    listCronRuns: vi.fn(() => Promise.resolve([])),
    getCronRunOutput: vi.fn(() => Promise.reject(new Error('not used'))),
    ...overrides
  };
}

export function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor === undefined || descriptor.set === undefined) {
    throw new Error('input value setter should exist');
  }
  descriptor.set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
