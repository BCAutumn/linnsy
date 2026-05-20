// @vitest-environment happy-dom

// S3 渲染层：系统事件、子 agent 汇报和主人插话分发测试。

import React from 'react';
import { act } from 'react';
import { describe, expect, test } from 'vitest';

import { Message } from '../Message.js';
import type { SubagentSummaryItem, SystemEventItem, UserInterjectionItem } from '../../projection/types.js';

import { renderMessage } from './message-test-support.js';

describe('Message · event bubbles', () => {
  test('subagent_summary · 渲染 taskId + summary markdown', () => {
    const item: SubagentSummaryItem = {
      kind: 'subagent_summary',
      id: 'subagent:run_child',
      conversationId: 'c1',
      createdAt: 1,
      taskId: 'task_research',
      childRunId: 'run_child',
      childConversationId: 'conv_child',
      summary: '研究完成：找到 **3** 个候选',
      progressChunks: [{
        id: 'evt_sub_progress_1',
        parentToolCallId: 'tc_delegate',
        kind: 'tool_process',
        occurredAt: 1,
        status: 'loading',
        toolName: 'web_research',
        phase: 'update',
        detail: '正在检索资料'
      }]
    };
    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    expect(dom.textContent).toContain('子 agent 汇报');
    expect(dom.textContent).toContain('task_research');
    expect(dom.textContent).toContain('正在检索资料');
    expect(dom.textContent).toContain('研究完成');
    // markdown 渲染：strong 标记应该被解析成 <strong>
    expect(dom.querySelector('.subagent-summary__body strong')).not.toBeNull();
  });

  test('system_event · cron sourceKind 渲染折叠条', () => {
    const item: SystemEventItem = {
      kind: 'system_event',
      id: 'sys:evt_cron',
      conversationId: 'c1',
      createdAt: 1,
      sourceKind: 'cron',
      detail: '早安任务触发',
      refId: 'cron_morning',
      occurredAt: 1
    };
    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    expect(dom.textContent).toContain('定时');
    expect(dom.textContent).toContain('早安任务触发');
    // 折叠态：refId / 时间不应出现
    expect(dom.textContent).not.toContain('cron_morning');
    // 展开后才出现
    const line = dom.querySelector('.system-event__line');
    act(() => { (line as HTMLButtonElement).click(); });
    expect(dom.textContent).toContain('cron_morning');
  });

  test('system_event · task_execution_notice 渲染轻量分隔提示', () => {
    const item: SystemEventItem = {
      kind: 'system_event',
      id: 'sys:task',
      conversationId: 'c1',
      createdAt: 1,
      sourceKind: 'task_execution_notice',
      detail: '------ Codex 任务已执行 ------',
      refId: 'task_1',
      occurredAt: 1
    };
    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    expect(dom.textContent).toContain('------ Codex 任务已执行 ------');
    expect(dom.textContent).not.toContain('定时');
  });

  test('user_interjection · 渲染插话标签 + detail', () => {
    const item: UserInterjectionItem = {
      kind: 'user_interjection',
      id: 'interjection:evt1',
      conversationId: 'c1',
      createdAt: 1,
      detail: '先停一下，换个方向',
      occurredAt: 1
    };
    const dom = renderMessage(<Message item={item} locale="zh-CN" />);
    expect(dom.textContent).toContain('主人插话');
    expect(dom.textContent).toContain('先停一下');
  });
});
