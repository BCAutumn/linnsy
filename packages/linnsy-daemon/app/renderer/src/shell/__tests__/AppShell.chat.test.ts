// @vitest-environment happy-dom

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DaemonApiClient, RuntimeEventStreamHandlers } from '../../lib/daemon-api.js';

import {
  daemonClient,
  messageFromDb,
  preferences,
  renderApp,
  settleEditorImport
} from './app-shell-test-support.js';

describe('AppShell', () => {
  it('renders the chat route with conversation, history, and settings landmarks', async () => {
    const container = await renderApp('/chat');
    const html = container.innerHTML;

    expect(html).toContain('aria-label="对话主区"');
    expect(html).toContain('aria-label="历史侧边栏"');
    expect(html).toContain('aria-label="设置"');
    expect(html).toContain('<span>设置</span>');
    expect(container.querySelector('.sidebar-bottom .sidebar-nav-link')).not.toBeNull();
    expect(container.querySelector('.sidebar-bottom .icon-btn')).toBeNull();
    expect(html).toContain('hello from db');
    const searchInput = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(searchInput?.disabled).toBe(true);
    expect(container.querySelector('.chat-view')?.classList.contains('scroll-area')).toBe(true);
    expect(container.querySelector('.conversation-list')?.classList.contains('scroll-area')).toBe(true);
  });

  it('rehydrates the selected conversation when the daemon boot instance changes', async () => {
    const streamHandlersRef: { current?: RuntimeEventStreamHandlers } = {};
    const readMessages = vi.fn<DaemonApiClient['readMessages']>()
      .mockResolvedValueOnce([
        messageFromDb('msg_before_restart', '重启前的旧投影')
      ])
      .mockResolvedValueOnce([
        messageFromDb('msg_after_restart', '重启后的历史快照')
      ]);
    const client = daemonClient({
      readMessages,
      openEventStream: vi.fn<DaemonApiClient['openEventStream']>((handlers) => {
        streamHandlersRef.current = handlers;
        return { close: vi.fn() };
      })
    });
    const container = await renderApp('/chat', client);
    expect(container.innerHTML).toContain('重启前的旧投影');
    const streamHandlers = streamHandlersRef.current;
    if (streamHandlers === undefined || streamHandlers.onBootInstanceChanged === undefined) {
      throw new Error('runtime stream should expose daemon restart handler');
    }

    await act(async () => {
      streamHandlers.onBootInstanceChanged?.({ bootInstanceId: 'boot_after_restart' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readMessages).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('重启后的历史快照');
    expect(container.innerHTML).not.toContain('重启前的旧投影');
  });

  it('uses the conversation title in the conversation list', async () => {
    const client = daemonClient({
      listConversations: vi.fn(() => Promise.resolve([
        {
          conversationId: 'conv_1',
          title: '帮我整理明天上午的会议材料，并先列一个执行清单',
          platform: 'desktop',
          chatType: 'private',
          chatId: 'window:main',
          updatedAt: 1,
          lastActivityAt: 1
        }
      ]))
    });
    const container = await renderApp('/chat', client);

    expect(container.querySelector('.conv-title')?.textContent).toBe('帮我整理明天上午的会议材料，并先列一个执行清单');
  });

  it('renders assistant markdown through the chat markdown renderer', async () => {
    const client = daemonClient({
      readMessages: vi.fn(() => Promise.resolve([
        {
          messageId: 'msg_md',
          role: 'assistant',
          source: 'outbound',
          text: '## 小结\n\n- 第一条\n- **第二条**\n\n```ts\nconst ok = true;\n```',
          createdAt: 2
        }
      ]))
    });
    const container = await renderApp('/chat', client);

    expect(container.querySelector('.linnsy-markdown h2')?.textContent).toContain('小结');
    expect(container.querySelectorAll('.linnsy-markdown li')).toHaveLength(2);
    expect(container.querySelector('.linnsy-markdown strong')?.textContent).toContain('第二条');
    expect(container.querySelector('.linnsy-markdown pre')?.textContent).toContain('const ok = true;');
  });

  it('renders plain line breaks as markdown breaks in assistant paragraphs', async () => {
    const client = daemonClient({
      readMessages: vi.fn(() => Promise.resolve([
        {
          messageId: 'msg_lines',
          role: 'assistant',
          source: 'outbound',
          text: '第一行\n第二行',
          createdAt: 2
        }
      ]))
    });
    const container = await renderApp('/chat', client);

    const paragraph = container.querySelector('.linnsy-markdown p');
    expect(paragraph?.textContent).toContain('第一行');
    expect(paragraph?.textContent).toContain('第二行');
    expect(paragraph?.querySelector('br')).not.toBeNull();
  });

  it('keeps blank lines as separate assistant markdown paragraphs', async () => {
    const client = daemonClient({
      readMessages: vi.fn(() => Promise.resolve([
        {
          messageId: 'msg_paragraphs',
          role: 'assistant',
          source: 'outbound',
          text: '第一段\n\n第二段',
          createdAt: 2
        }
      ]))
    });
    const container = await renderApp('/chat', client);

    const paragraphs = Array.from(container.querySelectorAll('.linnsy-markdown p'));
    expect(paragraphs.map((paragraph) => paragraph.textContent)).toEqual(['第一段', '第二段']);
  });

  it('renders markdown separators as spacing instead of visible rules in assistant chat', async () => {
    const client = daemonClient({
      readMessages: vi.fn(() => Promise.resolve([
        {
          messageId: 'msg_separator',
          role: 'assistant',
          source: 'outbound',
          text: '第一段\n\n---\n\n第二段',
          createdAt: 2
        }
      ]))
    });
    const container = await renderApp('/chat', client);

    expect(container.querySelector('.linnsy-markdown hr')).toBeNull();
    expect(container.querySelector('.linnsy-markdown-separator')).not.toBeNull();
  });

  it('offers document and markdown modes in the memory editor', async () => {
    const container = await renderApp('/settings', daemonClient({
      listMemoryItems: vi.fn(() => Promise.resolve([
        {
          memoryId: 'mem_1',
          scope: 'system_prompt',
          body: '主人希望被称呼为天司。',
          createdAt: 1,
          updatedAt: 2
        }
      ]))
    }));
    const memoryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('记忆'));
    if (memoryButton === undefined) {
      throw new Error('memory tab should render');
    }

    await act(async () => {
      memoryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    const previewCard = container.querySelector<HTMLButtonElement>('.memory-preview-card');
    if (previewCard === null) {
      throw new Error('memory preview should render');
    }
    await act(async () => {
      previewCard.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await settleEditorImport();

    const documentModeButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === '文档');
    const markdownModeButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === 'Markdown');
    const editorHost = container.querySelector('.memory-tiptap-editor-host');

    expect(documentModeButton?.getAttribute('aria-selected')).toBe('true');
    expect(markdownModeButton?.getAttribute('aria-selected')).toBe('false');
    expect(editorHost).not.toBeNull();

    if (markdownModeButton === undefined) {
      throw new Error('markdown mode should render');
    }
    await act(async () => {
      markdownModeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('.memory-tiptap-source-editor')).not.toBeNull();
    expect(container.querySelector('.memory-tiptap-editor-host')).toBeNull();
  });

  it('renders the onboarding route inside the same desktop shell', async () => {
    const html = (await renderApp('/onboarding/welcome')).innerHTML;

    expect(html).toContain('欢迎使用 Linnsy');
    expect(html).toContain('aria-label="新手引导"');
  });

  it('renders sidebar chrome with English copy when language is en-US', async () => {
    const client = daemonClient({
      getUiPreferences: vi.fn(() => Promise.resolve({
        ...preferences,
        language: 'en-US' as const
      }))
    });
    const html = (await renderApp('/chat', client)).innerHTML;

    expect(html).toContain('New chat');
    expect(html).toContain('Search conversations');
    expect(html).toContain('Recent');
    expect(html).toContain('Connection service not started');
  });

  it('returns from scheduled items to chat when selecting a conversation', async () => {
    const client = daemonClient();
    const container = await renderApp('/schedule', client);

    expect(container.querySelector('.scheduled-view')).not.toBeNull();
    expect(container.querySelector('.sidebar-inline-nav .sidebar-nav-link.active')?.textContent).toContain('定时安排');
    expect(container.querySelector('.conv-item.active')).toBeNull();
    const conversationButton = container.querySelector<HTMLButtonElement>('.conv-item .conv-item-main');
    if (conversationButton === null) {
      throw new Error('conversation item should render');
    }

    await act(async () => {
      conversationButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('.chat-view')).not.toBeNull();
    expect(container.querySelector('.scheduled-view')).toBeNull();
    expect(container.querySelector('.conv-item.active')).not.toBeNull();
  });

  it('sends desktop messages through the daemon API', async () => {
    const sendDesktopMessage = vi.fn<DaemonApiClient['sendDesktopMessage']>(() => Promise.resolve());
    const client = daemonClient({ sendDesktopMessage });
    const container = await renderApp('/chat', client);
    const textarea = container.querySelector('textarea');
    const form = container.querySelector('form');
    if (textarea === null || form === null) {
      throw new Error('composer should render');
    }

    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (descriptor === undefined || descriptor.set === undefined) {
        throw new Error('textarea value setter should exist');
      }
      const setTextareaValue = descriptor.set.bind(textarea);
      setTextareaValue('ping');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const sent = sendDesktopMessage.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ text: 'ping', conversationId: 'conv_1' });
    expect(sent?.metadata?.clientMessageId).toMatch(/^local_/);
  });

  it('uses Enter to send and Shift Enter to keep editing', async () => {
    const sendDesktopMessage = vi.fn<DaemonApiClient['sendDesktopMessage']>(() => Promise.resolve());
    const client = daemonClient({ sendDesktopMessage });
    const container = await renderApp('/chat', client);
    const textarea = container.querySelector('textarea');
    if (textarea === null) {
      throw new Error('composer should render');
    }

    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (descriptor === undefined || descriptor.set === undefined) {
        throw new Error('textarea value setter should exist');
      }
      const setTextareaValue = descriptor.set.bind(textarea);
      setTextareaValue('line one');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      }));
      await Promise.resolve();
    });
    expect(sendDesktopMessage).not.toHaveBeenCalled();

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      }));
      await Promise.resolve();
    });
    const sent = sendDesktopMessage.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ text: 'line one', conversationId: 'conv_1' });
    expect(sent?.metadata?.clientMessageId).toMatch(/^local_/);
  });
});
