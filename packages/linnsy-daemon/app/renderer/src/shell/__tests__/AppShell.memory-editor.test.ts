// @vitest-environment happy-dom

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DaemonApiClient } from '../../lib/daemon-api.js';

import {
  daemonClient,
  renderApp,
  settleEditorImport
} from './app-shell-test-support.js';

describe('AppShell memory editor', () => {
  it('saves memory edits through the daemon API', async () => {
    const updateMemoryItem = vi.fn<DaemonApiClient['updateMemoryItem']>((memoryId, input) => Promise.resolve({
      memoryId,
      scope: input.scope,
      body: input.body,
      createdAt: 1,
      updatedAt: 3
    }));
    const container = await renderApp('/settings', daemonClient({
      listMemoryItems: vi.fn(() => Promise.resolve([
        {
          memoryId: 'mem_1',
          scope: 'system_prompt',
          body: '主人希望被称呼为天司。',
          createdAt: 1,
          updatedAt: 2
        }
      ])),
      updateMemoryItem
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
    const dialog = container.querySelector('.memory-dialog');
    if (dialog === null) {
      throw new Error('memory dialog should render');
    }
    expect(dialog.textContent).toContain('确保 Linnsy Agent 能够正常运行');
    expect(dialog.textContent).not.toContain('创建');
    expect(dialog.textContent).not.toContain('更新');
    const markdownModeButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === 'Markdown');
    if (markdownModeButton === undefined) {
      throw new Error('markdown mode should render');
    }
    await act(async () => {
      markdownModeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('.memory-tiptap-source-editor');
    const saveButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === '保存');
    if (textarea === null || saveButton === undefined) {
      throw new Error('memory editor should render');
    }

    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (descriptor === undefined || descriptor.set === undefined) {
        throw new Error('textarea value setter should exist');
      }
      descriptor.set.call(textarea, '主人希望回答更直接。');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(updateMemoryItem).toHaveBeenCalledWith('mem_1', {
      scope: 'system_prompt',
      body: '主人希望回答更直接。'
    });
    expect(container.innerHTML).not.toContain('已保存。');
  });

  it('persists memory enabled toggles and keeps auto extraction disabled until the backend exists', async () => {
    const updateMemoryItem = vi.fn<DaemonApiClient['updateMemoryItem']>((memoryId, input) => Promise.resolve({
      memoryId,
      scope: input.scope,
      body: input.body,
      createdAt: 1,
      updatedAt: 3,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata })
    }));
    const container = await renderApp('/settings', daemonClient({
      listMemoryItems: vi.fn(() => Promise.resolve([
        {
          memoryId: 'mem_pref',
          scope: 'user_preference',
          body: '主人喜欢直接一点。',
          createdAt: 1,
          updatedAt: 2,
          metadata: { builtin: true }
        }
      ])),
      updateMemoryItem
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
    const userPreferenceButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === '用户偏好');
    if (userPreferenceButton === undefined) {
      throw new Error('user preference scope should render');
    }
    await act(async () => {
      userPreferenceButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('启用');
    expect(container.textContent).toContain('自动提取');
    const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
    expect(switches).toHaveLength(2);
    expect(switches[0]?.getAttribute('aria-checked')).toBe('true');
    expect(switches[1]?.getAttribute('aria-checked')).toBe('false');
    expect(switches[1]?.disabled).toBe(true);

    await act(async () => {
      switches[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(updateMemoryItem).toHaveBeenCalledWith('mem_pref', {
      scope: 'user_preference',
      body: '主人喜欢直接一点。',
      metadata: {
        builtin: true,
        enabled: false
      }
    });
  });

  it('disables memory save when the current item exceeds the body unit limit', async () => {
    const updateMemoryItem = vi.fn<DaemonApiClient['updateMemoryItem']>((memoryId, input) => Promise.resolve({
      memoryId,
      scope: input.scope,
      body: input.body,
      createdAt: 1,
      updatedAt: 3
    }));
    const container = await renderApp('/settings', daemonClient({
      listMemoryItems: vi.fn(() => Promise.resolve([
        {
          memoryId: 'mem_1',
          scope: 'system_prompt',
          body: '主人希望被称呼为天司。',
          createdAt: 1,
          updatedAt: 2
        }
      ])),
      updateMemoryItem
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
    const markdownModeButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === 'Markdown');
    if (markdownModeButton === undefined) {
      throw new Error('markdown mode should render');
    }
    await act(async () => {
      markdownModeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('.memory-tiptap-source-editor');
    const saveButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === '保存');
    if (textarea === null || saveButton === undefined) {
      throw new Error('memory editor should render');
    }

    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (descriptor === undefined || descriptor.set === undefined) {
        throw new Error('textarea value setter should exist');
      }
      descriptor.set.call(textarea, Array.from({ length: 1001 }, () => 'word').join(' '));
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('.memory-body-stats')?.textContent).toContain('English 1001/1000 words');
    expect(saveButton.disabled).toBe(true);
    expect(updateMemoryItem).not.toHaveBeenCalled();
  });

  it('treats clicking outside the memory editor dialog as cancel', async () => {
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

    const backdrop = container.querySelector<HTMLDivElement>('.memory-dialog-backdrop');
    if (backdrop === null) {
      throw new Error('memory dialog backdrop should render');
    }
    await act(async () => {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('.memory-dialog.app-dialog--closing')).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 170);
      });
    });

    expect(container.querySelector('.memory-dialog')).toBeNull();
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
});
