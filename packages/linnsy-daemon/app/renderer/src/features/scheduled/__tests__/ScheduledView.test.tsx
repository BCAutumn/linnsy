// @vitest-environment happy-dom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

import type { ChatAppState } from '../../../lib/chat-actions.js';
import type { CreateCronInput, CronListEntry, DaemonApiClient, UiPreferences } from '../../../lib/daemon-api.js';
import type { ApplicationConnectionsSnapshot } from '@renderer/contracts';
import { ScheduledView } from '../ScheduledView.js';
import { createInitialState } from '../../chat/projection/state.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
});

describe('ScheduledView', () => {
  it('confirms scheduled item deletion before calling the client', async () => {
    const rendered = await renderView({
      reminders: [createReminder({ jobId: 'cron_1', query: '喝水' })]
    });

    await click(findButton('删除'));

    expect(document.body.textContent).toContain('确定删除这条定时安排吗');
    await click(findTextButton('删除'));

    expect(rendered.deleteCron).toHaveBeenCalledWith('cron_1');
  });

  it('shows icon action tooltip below the scheduled row action', async () => {
    await renderView({
      reminders: [createReminder({ jobId: 'cron_1', query: '喝水' })]
    });

    await hoverAction(findButton('删除'));

    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('删除');
  });

  it('keeps disabled and undelivered reminders in separate collapsed sections', async () => {
    await renderView({
      reminders: [
        createReminder({ jobId: 'active', enabled: true, query: 'Active reminder' }),
        createReminder({
          jobId: 'disabled',
          enabled: false,
          query: 'Disabled recurring',
          schedule: { kind: 'interval', intervalMs: 60_000 }
        }),
        createReminder({
          jobId: 'undelivered',
          enabled: false,
          query: 'Missed one-shot',
          schedule: { kind: 'one_shot', atMs: 1 }
        })
      ]
    });

    const disabled = document.querySelector('details.scheduled-view-archived--muted');
    const undelivered = document.querySelector('details.scheduled-view-archived--failed');
    if (!(disabled instanceof HTMLDetailsElement) || !(undelivered instanceof HTMLDetailsElement)) {
      throw new Error('reminder status sections should render as details');
    }
    expect(disabled.open).toBe(false);
    expect(disabled.textContent).toContain('已停用（1）');
    expect(disabled.textContent).toContain('Disabled recurring');
    expect(undelivered.open).toBe(false);
    expect(undelivered.textContent).toContain('未送达（1）');
    expect(undelivered.textContent).not.toContain('上次到点没送达');
  });

  it('creates a scheduled item from the scheduled page', async () => {
    const rendered = await renderView({});

    await click(findTextButton('新建'));
    const textarea = document.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('create scheduled item textarea should exist');
    }
    await input(textarea, '每周准备周报');
    await click(findTextButton('创建'));

    const created = rendered.createCron.mock.calls[0]?.[0];
    expect(created?.query).toBe('每周准备周报');
    expect(created?.schedule.kind).toBe('one_shot');
  });
});

async function renderView(input: {
  reminders?: CronListEntry[];
}): Promise<RenderedView> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const client = createClient(input);

  act(() => {
    root?.render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={['/schedule']}
      >
        <ScheduledView state={createState(client)} />
      </MemoryRouter>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });

  return client;
}

interface RenderedView extends DaemonApiClient {
  createCron: MockedFunction<DaemonApiClient['createCron']>;
  deleteCron: MockedFunction<DaemonApiClient['deleteCron']>;
}

function createState(client: DaemonApiClient): ChatAppState {
  return {
    client,
    conversations: [],
    selectedConversationId: null,
    pendingDesktopConversation: false,
    terminalBinding: null,
    applicationConnections: createApplicationConnections(),
    projection: createInitialState(null),
    preferences: createPreferences(),
    channelStatuses: new Map(),
    status: '',
    error: null
  };
}

function createClient(input: {
  reminders?: CronListEntry[];
}): RenderedView {
  const deleteCron: MockedFunction<DaemonApiClient['deleteCron']> = vi.fn((jobId: string) => {
    void jobId;
    return Promise.resolve(true);
  });
  const createCron: MockedFunction<DaemonApiClient['createCron']> = vi.fn((cronInput: CreateCronInput) => Promise.resolve({
    jobId: 'cron_created',
    enabled: true,
    nextRunAt: cronInput.schedule.kind === 'one_shot' ? cronInput.schedule.atMs : 1,
    query: cronInput.query,
    schedule: cronInput.schedule
  }));
  return {
    listConversations: vi.fn(() => Promise.resolve([])),
    createDesktopConversation: vi.fn(() => Promise.reject(new Error('not used'))),
    renameConversation: vi.fn(() => Promise.reject(new Error('not used'))),
    setConversationPinned: vi.fn(() => Promise.reject(new Error('not used'))),
    archiveConversation: vi.fn(() => Promise.reject(new Error('not used'))),
    deleteConversation: vi.fn(() => Promise.reject(new Error('not used'))),
    getTerminalBinding: vi.fn(() => Promise.reject(new Error('not used'))),
    updateTerminalBinding: vi.fn(() => Promise.reject(new Error('not used'))),
    getApplicationConnections: vi.fn(() => Promise.resolve(createApplicationConnections())),
    probeCodexConnection: vi.fn(() => Promise.resolve(createApplicationConnections().codex)),
    readMessages: vi.fn(() => Promise.resolve([])),
    readEvents: vi.fn(() => Promise.resolve([])),
    sendDesktopMessage: vi.fn(() => Promise.resolve()),
    openEventStream: vi.fn(() => ({ close: vi.fn() })),
    getUiPreferences: vi.fn(() => Promise.resolve(createPreferences())),
    setUiPreference: vi.fn(() => Promise.resolve()),
    resetUiPreferences: vi.fn(() => Promise.resolve(createPreferences())),
    getModelSettings: vi.fn(() => Promise.reject(new Error('not used'))),
    saveModelSettings: vi.fn(() => Promise.reject(new Error('not used'))),
    listMemoryItems: vi.fn(() => Promise.resolve([])),
    getSystemPromptPreview: vi.fn(() => Promise.resolve({
      agentId: 'linnsy_main',
      role: 'system' as const,
      shapingVersion: 'test',
      assembledPrompt: 'backend system prompt',
      sections: []
    })),
    createMemoryItem: vi.fn(() => Promise.reject(new Error('not used'))),
    updateMemoryItem: vi.fn(() => Promise.reject(new Error('not used'))),
    deleteMemoryItem: vi.fn(() => Promise.resolve(true)),
    listCron: vi.fn(() => Promise.resolve(input.reminders ?? [])),
    createCron,
    deleteCron,
    setCronEnabled: vi.fn(() => Promise.resolve(true)),
    listCronRuns: vi.fn(() => Promise.resolve([])),
    getCronRunOutput: vi.fn(() => Promise.reject(new Error('not used')))
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

function createPreferences(): UiPreferences {
  return {
    'theme.mode': 'light',
    'theme.primary_color': 'distant_sky',
    'font.size': 'medium',
    'sidebar.width_px': 280,
    'sidebar.archived_collapsed': true,
    last_opened_conversation_id: null,
    language: 'zh-CN',
    'scheduled.skip_inactive_delete_confirm': false
  };
}

function createReminder(input: Partial<CronListEntry>): CronListEntry {
  return {
    jobId: input.jobId ?? 'cron',
    enabled: input.enabled ?? true,
    query: input.query ?? 'Reminder',
    nextRunAt: input.nextRunAt ?? 1,
    schedule: input.schedule ?? { kind: 'one_shot', atMs: 1 }
  };
}

function findButton(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`button ${label} not found`);
  }
  return button;
}

function findTextButton(text: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll('button'));
  const button = buttons.find((candidate) => candidate.textContent === text);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`button ${text} not found`);
  }
  return button;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

async function hoverAction(button: HTMLButtonElement): Promise<void> {
  const trigger = button.closest('.hover-tooltip-trigger');
  if (!(trigger instanceof HTMLElement)) {
    throw new Error('hover tooltip trigger should wrap icon action button');
  }
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await Promise.resolve();
  });
}

async function input(element: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (descriptor === undefined || descriptor.set === undefined) {
      throw new Error('textarea value setter should exist');
    }
    descriptor.set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}
