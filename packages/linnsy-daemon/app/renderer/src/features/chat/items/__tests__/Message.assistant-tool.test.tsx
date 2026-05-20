// @vitest-environment happy-dom

// S3 渲染层：assistant/tool 气泡分发的最小集成测试。

import React from 'react';
import { act } from 'react';
import { describe, expect, test } from 'vitest';

import { Message } from '../Message.js';
import type { AssistantBubbleItem, ToolCallCardItem } from '../../projection/types.js';

import { renderMessage, rerenderMessage } from './message-test-support.js';

describe('Message · assistant and tool bubbles', () => {
  test('assistant_bubble · 思考链默认展开，最终回答出现后自动折叠', () => {
    const thinking: AssistantBubbleItem = {
      kind: 'assistant_bubble',
      id: 'stream:r1:thought:t1',
      conversationId: 'c1',
      createdAt: 1,
      text: '',
      streaming: true,
      messageId: 'stream:r1:thought:t1',
      runId: 'r1',
      answerId: '',
      chunks: new Map(),
      thoughtChunks: [{
        id: 'thought_1',
        text: '我先拆一下问题',
        completed: false,
        startedAt: 1000,
        updatedAt: 2200,
        chunks: new Map([[0, '我先拆一下问题']])
      }]
    };
    const dom = renderMessage(<Message item={thinking} locale="zh-CN" />);
    expect(dom.textContent).toContain('正在思考 · 1.2 秒');
    expect(dom.textContent).toContain('我先拆一下问题');

    const answered: AssistantBubbleItem = {
      ...thinking,
      id: 'msg_assistant',
      text: '结论是 A',
      streaming: false,
      messageId: 'msg_assistant',
      thoughtChunks: [{
        id: 'thought_1',
        text: '我先拆一下问题',
        completed: true,
        startedAt: 1000,
        updatedAt: 2400,
        completedAt: 2400,
        chunks: new Map([[0, '我先拆一下问题']])
      }]
    };
    rerenderMessage(<Message item={answered} locale="zh-CN" />);
    expect(dom.textContent).toContain('结论是 A');
    expect(dom.textContent).toContain('思考了 1.4 秒');
    expect(dom.textContent).not.toContain('我先拆一下问题');
  });

  test('assistant_bubble · 折叠后的思考链可以重新展开', () => {
    const item: AssistantBubbleItem = {
      kind: 'assistant_bubble',
      id: 'msg_assistant',
      conversationId: 'c1',
      createdAt: 1,
      text: '结论是 A',
      streaming: false,
      messageId: 'msg_assistant',
      runId: 'r1',
      answerId: '',
      chunks: new Map(),
      thoughtChunks: [{
        id: 'thought_1',
        text: '完整思考内容',
        completed: true,
        startedAt: 1000,
        updatedAt: 2500,
        completedAt: 2500,
        chunks: new Map([[0, '完整思考内容']])
      }]
    };
    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    expect(dom.textContent).not.toContain('完整思考内容');
    const toggle = dom.querySelector('.assistant-thought__toggle');
    expect(toggle).not.toBeNull();
    act(() => { (toggle as HTMLButtonElement).click(); });
    expect(dom.textContent).toContain('完整思考内容');
  });

  test('assistant_bubble · 用户展开思考链后，后续流式正文不再强制折叠', () => {
    const item: AssistantBubbleItem = {
      kind: 'assistant_bubble',
      id: 'stream:r1:a1',
      conversationId: 'c1',
      createdAt: 1,
      text: '第一段回答',
      streaming: true,
      messageId: 'stream:r1:a1',
      runId: 'r1',
      answerId: 'a1',
      chunks: new Map([[0, '第一段回答']]),
      thoughtChunks: [{
        id: 'thought_1',
        text: '完整思考内容',
        completed: true,
        startedAt: 1000,
        updatedAt: 2500,
        completedAt: 2500,
        chunks: new Map([[0, '完整思考内容']])
      }]
    };
    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    const toggle = dom.querySelector('.assistant-thought__toggle');
    expect(toggle).not.toBeNull();
    act(() => { (toggle as HTMLButtonElement).click(); });
    expect(dom.textContent).toContain('完整思考内容');

    rerenderMessage(<Message item={{ ...item, text: '第一段回答，继续补充' }} locale="zh-CN" />);

    expect(dom.textContent).toContain('完整思考内容');
  });

  test('assistant_bubble · 纯思考段使用紧凑样式且不渲染空正文 Markdown', () => {
    const item: AssistantBubbleItem = {
      kind: 'assistant_bubble',
      id: 'stream:r1:thought:t1',
      conversationId: 'c1',
      createdAt: 1,
      text: '',
      streaming: false,
      messageId: 'stream:r1:thought:t1',
      runId: 'r1',
      answerId: '',
      chunks: new Map(),
      thoughtChunks: [{
        id: 'thought_1',
        text: '准备调用工具前先确认资料来源',
        completed: true,
        startedAt: 1000,
        updatedAt: 1700,
        completedAt: 1700,
        chunks: new Map([[0, '准备调用工具前先确认资料来源']])
      }]
    };

    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    expect(dom.querySelector('[data-item-id="stream:r1:thought:t1"]')?.classList.contains('message--thought-only')).toBe(true);
    expect(dom.querySelector('.message-content > .linnsy-markdown')).toBeNull();
    expect(dom.textContent).toContain('准备调用工具前先确认资料来源');
  });

  test('assistant_bubble · 仅流式态在回答末尾显示光标', () => {
    const streamingItem: AssistantBubbleItem = {
      kind: 'assistant_bubble',
      id: 'stream:r1:a1',
      conversationId: 'c1',
      createdAt: 1,
      text: '正在写回复',
      streaming: true,
      messageId: 'stream:r1:a1',
      runId: 'r1',
      answerId: 'a1',
      chunks: new Map([[0, '正在写回复']]),
      thoughtChunks: []
    };
    const dom = renderMessage(<Message item={streamingItem} locale="zh-CN" />);
    expect(dom.querySelector('.linnsy-markdown p .linnsy-markdown__streaming-cursor')).not.toBeNull();

    const settledItem: AssistantBubbleItem = {
      ...streamingItem,
      id: 'msg_assistant',
      streaming: false,
      messageId: 'msg_assistant'
    };
    rerenderMessage(<Message item={settledItem} locale="zh-CN" />);
    expect(dom.querySelector('.linnsy-markdown__streaming-cursor')).toBeNull();
  });

  test('assistant_bubble · animateEntry 打开时挂入场动画 class', () => {
    const item: AssistantBubbleItem = {
      kind: 'assistant_bubble',
      id: 'msg_entry',
      conversationId: 'c1',
      createdAt: 1,
      text: '新的回复',
      streaming: false,
      messageId: 'msg_entry',
      runId: 'r1',
      answerId: 'a1',
      chunks: new Map(),
      thoughtChunks: []
    };
    const dom = renderMessage(<Message animateEntry item={item} locale="zh-CN" />);
    expect(dom.querySelector('[data-item-id="msg_entry"]')?.classList.contains('message--entering')).toBe(true);
  });

  test('tool_call_card · 默认折叠，header 显示 status + toolName，body 隐藏', () => {
    const item: ToolCallCardItem = {
      kind: 'tool_call_card',
      id: 'tool:tc1',
      conversationId: 'c1',
      createdAt: 1,
      toolCallId: 'tc1',
      toolName: 'weather.lookup',
      status: 'running',
      args: { city: 'Beijing' },
      startedAt: 1,
      runId: 'r1'
    };
    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    expect(dom.textContent).toContain('weather.lookup');
    expect(dom.textContent).toContain('运行中');
    // 折叠态：args 字段名不应出现
    expect(dom.textContent).not.toContain('入参');
  });

  test('tool_call_card · list_tasks 和 cron_list 走用户友好的单行轻提示', () => {
    const listTasksItem: ToolCallCardItem = {
      kind: 'tool_call_card',
      id: 'tool:list_tasks',
      conversationId: 'c1',
      createdAt: 1,
      toolCallId: 'tc_list_tasks',
      toolName: 'list_tasks',
      status: 'success',
      args: {},
      data: { tasks: [{ taskId: 'task_hidden' }] },
      observation: '已列出 1 个任务',
      startedAt: 1,
      endedAt: 2,
      runId: 'r1'
    };
    const dom = renderMessage(<Message item={listTasksItem} locale="zh-CN" />);
    expect(dom.textContent).toContain('查看任务列表');
    expect(dom.textContent).not.toContain('task_hidden');
    expect(dom.querySelector('.tool-inline-notice')).not.toBeNull();
    expect(dom.querySelector('.tool-card__header')).toBeNull();

    const cronListItem: ToolCallCardItem = {
      ...listTasksItem,
      id: 'tool:cron_list',
      toolCallId: 'tc_cron_list',
      toolName: 'cron_list',
      data: { jobs: [{ jobId: 'cron_hidden' }] },
      observation: '已列出 1 个定时任务'
    };
    rerenderMessage(<Message item={cronListItem} locale="zh-CN" />);
    expect(dom.textContent).toContain('查看定时安排');
    expect(dom.textContent).not.toContain('cron_hidden');
  });

  test('tool_call_card · Codex 委派卡默认露出接管动作', async () => {
    const item: ToolCallCardItem = {
      kind: 'tool_call_card',
      id: 'tool:codex_delegate',
      conversationId: 'c1',
      createdAt: 1,
      toolCallId: 'tc_codex_delegate',
      toolName: 'delegate_to_external',
      status: 'success',
      args: {
        definitionKey: 'delegate_to_codex',
        title: '只读检查项目'
      },
      data: {
        taskId: 'task_codex_1',
        status: 'dispatched'
      },
      observation: '已派发外部任务 task_codex_1',
      startedAt: 1,
      endedAt: 2,
      runId: 'r1'
    };

    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dom.textContent).toContain('Codex 任务');
    expect(dom.textContent).toContain('在 Codex 打开');
    expect(dom.textContent).toContain('复制恢复命令');
  });

  test('tool_call_card · success 状态展开后显示入参 + data + observation', () => {
    const item: ToolCallCardItem = {
      kind: 'tool_call_card',
      id: 'tool:tc2',
      conversationId: 'c1',
      createdAt: 1,
      toolCallId: 'tc2',
      toolName: 'echo',
      status: 'success',
      args: { text: 'hi' },
      progressChunks: [{
        id: 'evt_progress_1',
        phase: 'update',
        status: 'loading',
        occurredAt: 2,
        detail: '正在执行 echo'
      }],
      data: { text: 'hi' },
      observation: '返回 hi',
      durationMs: 12,
      startedAt: 1,
      endedAt: 13,
      runId: 'r1'
    };
    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    expect(dom.textContent).toContain('成功');
    expect(dom.textContent).toContain('12ms');
    const header = dom.querySelector('.tool-card__header');
    expect(header).not.toBeNull();
    act(() => { (header as HTMLButtonElement).click(); });
    const bodyId = (header as HTMLButtonElement).getAttribute('aria-controls');
    expect((header as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true');
    expect(bodyId).not.toBeNull();
    expect(document.getElementById(bodyId ?? '')).toBe(dom.querySelector('.tool-card__body'));
    expect(dom.textContent).toContain('入参');
    expect(dom.textContent).toContain('进度');
    expect(dom.textContent).toContain('正在执行 echo');
    expect(dom.textContent).toContain('数据');
    expect(dom.textContent).toContain('观察');
    expect(dom.textContent).toContain('hi');
  });

  test('tool_call_card · 折叠态不格式化 body，二次展开会重新挂载 body', () => {
    let stringifyCount = 0;
    const item: ToolCallCardItem = {
      kind: 'tool_call_card',
      id: 'tool:tc2-lazy',
      conversationId: 'c1',
      createdAt: 1,
      toolCallId: 'tc2-lazy',
      toolName: 'heavy.args',
      status: 'success',
      args: {
        toJSON: () => {
          stringifyCount += 1;
          return { payload: 'heavy' };
        }
      },
      data: { ok: true },
      observation: 'done',
      durationMs: 12,
      startedAt: 1,
      endedAt: 13,
      runId: 'r1'
    };
    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    const header = dom.querySelector('.tool-card__header');
    expect(header).not.toBeNull();
    expect(dom.querySelector('.tool-card__body')).toBeNull();
    expect(stringifyCount).toBe(0);

    act(() => { (header as HTMLButtonElement).click(); });
    expect(dom.querySelector('.tool-card__body')).not.toBeNull();
    expect(dom.textContent).toContain('payload');
    expect(stringifyCount).toBe(1);

    act(() => { (header as HTMLButtonElement).click(); });
    expect(dom.querySelector('.tool-card__body')).toBeNull();
    expect((header as HTMLButtonElement).getAttribute('aria-expanded')).toBe('false');
    expect(stringifyCount).toBe(1);

    act(() => { (header as HTMLButtonElement).click(); });
    expect(dom.querySelector('.tool-card__body')).not.toBeNull();
    expect(stringifyCount).toBe(2);
  });

  test('tool_call_card · 只在从折叠到展开时通知布局变化', () => {
    let beforeExpandCount = 0;
    const item: ToolCallCardItem = {
      kind: 'tool_call_card',
      id: 'tool:tc2-layout',
      conversationId: 'c1',
      createdAt: 1,
      toolCallId: 'tc2-layout',
      toolName: 'layout.sensitive',
      status: 'success',
      args: {},
      data: { ok: true },
      observation: 'done',
      startedAt: 1,
      endedAt: 2,
      runId: 'r1'
    };
    const dom = renderMessage(
      <Message
        item={item}
        locale="zh-CN"
        onBeforeToolExpand={() => {
          beforeExpandCount += 1;
        }}
      />
    );
    const header = dom.querySelector('.tool-card__header');
    expect(header).not.toBeNull();

    act(() => { (header as HTMLButtonElement).click(); });
    expect(beforeExpandCount).toBe(1);
    expect((header as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true');

    act(() => { (header as HTMLButtonElement).click(); });
    expect(beforeExpandCount).toBe(1);
    expect((header as HTMLButtonElement).getAttribute('aria-expanded')).toBe('false');
  });

  test('tool_call_card · blocked / error 走错误样式 chip', () => {
    const item: ToolCallCardItem = {
      kind: 'tool_call_card',
      id: 'tool:tc3',
      conversationId: 'c1',
      createdAt: 1,
      toolCallId: 'tc3',
      toolName: 'shell.exec',
      status: 'blocked',
      args: {},
      error: 'policy denied',
      errorKind: 'execution',
      durationMs: 0,
      startedAt: 1,
      endedAt: 1,
      runId: 'r1'
    };
    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    expect(dom.querySelector('.tool-card__status--blocked')).not.toBeNull();
  });
});
