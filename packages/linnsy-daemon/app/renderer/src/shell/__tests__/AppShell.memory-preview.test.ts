// @vitest-environment happy-dom

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  daemonClient,
  renderApp,
  systemPromptPreview
} from './app-shell-test-support.js';

describe('AppShell memory preview', () => {
  it('renders editable daemon memory items', async () => {
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

    expect(container.innerHTML).toContain('提示词与记忆');
    expect(container.innerHTML).toContain('系统提示词');
    expect(container.innerHTML).toContain('人设');
    expect(container.innerHTML).toContain('工作方式');
    expect(container.innerHTML).toContain('用户偏好');
    expect(container.innerHTML).toContain('长期记忆');
    expect(container.innerHTML).toContain('主人希望被称呼为天司。');
    expect(container.textContent).not.toContain('后端实际 System Prompt');
    expect(container.textContent).toContain('确保 Linnsy Agent 能够正常运行');
    expect(container.textContent).toContain('创建');
    expect(container.textContent).toContain('更新');
    expect(container.innerHTML).not.toContain('中期记忆');
    expect(container.innerHTML).not.toContain('当前可编辑');
    expect(container.innerHTML).not.toContain('标题');
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('.memory-scope-tabs')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('.memory-preview-card')).not.toBeNull();
  });

  it('renders the backend effective system prompt in the existing memory preview card', async () => {
    const container = await renderApp('/settings', daemonClient({
      listMemoryItems: vi.fn(() => Promise.resolve([
        {
          memoryId: 'mem_system',
          scope: 'system_prompt',
          body: 'frontend stale system prompt',
          createdAt: 1,
          updatedAt: 2
        }
      ])),
      getSystemPromptPreview: vi.fn(() => Promise.resolve(systemPromptPreview({
        scope: 'system_prompt',
        body: 'backend effective system prompt with Codex locator rules'
      })))
    }));
    const memoryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('记忆'));
    if (memoryButton === undefined) {
      throw new Error('memory tab should render');
    }

    await act(async () => {
      memoryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const previewCard = container.querySelector('.memory-preview-card');
    expect(previewCard?.textContent).toContain('backend effective system prompt with Codex locator rules');
    expect(previewCard?.textContent).not.toContain('frontend stale system prompt');
    expect(container.textContent).not.toContain('后端实际 System Prompt');
  });

  it('renders backend effective memory shaping sections in the existing preview card', async () => {
    const container = await renderApp('/settings', daemonClient({
      listMemoryItems: vi.fn(() => Promise.resolve([
        {
          memoryId: 'mem_persona',
          scope: 'persona',
          body: 'frontend stale persona',
          createdAt: 1,
          updatedAt: 2
        },
        {
          memoryId: 'mem_work_style',
          scope: 'work_style',
          body: 'frontend stale work style',
          createdAt: 1,
          updatedAt: 2
        },
        {
          memoryId: 'mem_user_preference',
          scope: 'user_preference',
          body: 'frontend stale user preference',
          createdAt: 1,
          updatedAt: 2
        },
        {
          memoryId: 'mem_long_term_memory',
          scope: 'long_term_memory',
          body: 'frontend stale long term memory',
          createdAt: 1,
          updatedAt: 2
        }
      ])),
      getSystemPromptPreview: vi.fn(() => Promise.resolve(systemPromptPreview(
        {
          scope: 'system_prompt',
          body: 'backend effective system prompt'
        },
        {
          scope: 'persona',
          body: 'backend effective persona'
        },
        {
          scope: 'work_style',
          body: 'backend effective work style'
        },
        {
          scope: 'user_preference',
          body: 'backend effective user preference'
        },
        {
          scope: 'long_term_memory',
          body: 'backend effective long term memory'
        }
      )))
    }));
    const memoryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('记忆'));
    if (memoryButton === undefined) {
      throw new Error('memory tab should render');
    }

    await act(async () => {
      memoryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const expectations = [
      {
        label: '人设',
        expected: 'backend effective persona',
        stale: 'frontend stale persona'
      },
      {
        label: '工作方式',
        expected: 'backend effective work style',
        stale: 'frontend stale work style'
      },
      {
        label: '用户偏好',
        expected: 'backend effective user preference',
        stale: 'frontend stale user preference'
      },
      {
        label: '长期记忆',
        expected: 'backend effective long term memory',
        stale: 'frontend stale long term memory'
      }
    ];

    for (const expectation of expectations) {
      const scopeButton = Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent.trim() === expectation.label);
      if (scopeButton === undefined) {
        throw new Error(`${expectation.label} scope should render`);
      }
      await act(async () => {
        scopeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });

      const previewCard = container.querySelector('.memory-preview-card');
      expect(previewCard?.textContent).toContain(expectation.expected);
      expect(previewCard?.textContent).not.toContain(expectation.stale);
    }
  });

  it('refreshes memory preview when the settings window regains focus', async () => {
    let revision: 'stale' | 'fresh' = 'stale';
    const listMemoryItems = vi.fn(() => Promise.resolve([
      {
        memoryId: 'mem_long_term_memory',
        scope: 'long_term_memory',
        body: revision === 'stale' ? '旧的长期记忆' : '主人是 Linnsy 的开发者。',
        createdAt: 1,
        updatedAt: revision === 'stale' ? 2 : 3
      }
    ]));
    const getSystemPromptPreview = vi.fn(() => Promise.resolve(systemPromptPreview(
      {
        scope: 'long_term_memory',
        body: revision === 'stale' ? '旧的长期记忆' : '主人是 Linnsy 的开发者。'
      }
    )));
    const container = await renderApp('/settings', daemonClient({
      listMemoryItems,
      getSystemPromptPreview
    }));
    const memoryButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.includes('记忆'));
    if (memoryButton === undefined) {
      throw new Error('memory tab should render');
    }

    await act(async () => {
      memoryButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const longTermButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === '长期记忆');
    if (longTermButton === undefined) {
      throw new Error('long-term memory scope should render');
    }
    await act(async () => {
      longTermButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('.memory-preview-card')?.textContent).toContain('旧的长期记忆');

    const callsBeforeFocus = listMemoryItems.mock.calls.length;
    revision = 'fresh';
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.memory-preview-card')?.textContent).toContain('主人是 Linnsy 的开发者。');
    expect(listMemoryItems.mock.calls.length).toBeGreaterThan(callsBeforeFocus);
    expect(getSystemPromptPreview.mock.calls.length).toBeGreaterThan(callsBeforeFocus);
  });
});
