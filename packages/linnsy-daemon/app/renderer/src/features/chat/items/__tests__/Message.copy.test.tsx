// @vitest-environment happy-dom

// 对话气泡复制按钮：只覆盖用户气泡和 assistant 最终回答，避免流式中途复制半截回复。

import React from 'react';
import { act } from 'react';
import { describe, expect, test, vi } from 'vitest';

import { Message } from '../Message.js';
import type { AssistantBubbleItem, UserBubbleItem } from '../../projection/types.js';

import { renderMessage, rerenderMessage } from './message-test-support.js';

describe('Message · copy button', () => {
  test('user_bubble · 点击复制原始 markdown 文本', async () => {
    const writeText = installClipboardMock();
    const item: UserBubbleItem = {
      kind: 'user_bubble',
      id: 'msg_user',
      conversationId: 'c1',
      createdAt: 1,
      messageId: 'msg_user',
      text: '请整理 **三点**'
    };

    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    const button = dom.querySelector('.message-copy-button');
    expect(button).not.toBeNull();
    expect((button as HTMLButtonElement).getAttribute('aria-label')).toBe('复制');

    await act(async () => {
      (button as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('请整理 **三点**');
    expect((button as HTMLButtonElement).getAttribute('aria-label')).toBe('已复制');
  });

  test('assistant_bubble · 流式期不显示，最终回答才显示复制按钮', async () => {
    const writeText = installClipboardMock();
    const streamingItem: AssistantBubbleItem = {
      kind: 'assistant_bubble',
      id: 'stream:r1:a1',
      conversationId: 'c1',
      createdAt: 1,
      text: '正在写',
      streaming: true,
      messageId: 'stream:r1:a1',
      runId: 'r1',
      answerId: 'a1',
      chunks: new Map([[0, '正在写']]),
      thoughtChunks: []
    };

    const dom = renderMessage(<Message item={streamingItem} locale="zh-CN" />);
    expect(dom.querySelector('.message-copy-button')).toBeNull();

    const settledItem: AssistantBubbleItem = {
      ...streamingItem,
      id: 'msg_assistant',
      text: '最终回答',
      streaming: false,
      messageId: 'msg_assistant',
      chunks: new Map()
    };
    rerenderMessage(<Message assistantCopyText="最终回答" item={settledItem} locale="zh-CN" />);
    const button = dom.querySelector('.message-copy-button');
    expect(button).not.toBeNull();

    await act(async () => {
      (button as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('最终回答');
  });
});

function installClipboardMock(): ReturnType<typeof vi.fn<(text: string) => Promise<void>>> {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText } satisfies Pick<Clipboard, 'writeText'>
  });
  return writeText;
}
