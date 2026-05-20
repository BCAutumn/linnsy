// subagent.summary / system.event projector 测试。
//
// 覆盖：
//   - subagent.summary：同 childRunId 幂等；payload 必填字段缺失返回 no-op
//   - system.event：sourceKind=user_interjection → UserInterjectionItem
//                   sourceKind=cron → SystemEventItem
//                   sourceKind=channel_status → 对话流静默忽略
//                   历史 task_status_change → 共享协议不再承认，投影静默丢弃
//   - 跨会话隔离

import { beforeEach, describe, expect, test } from 'vitest';

import { createInitialState } from '../state.js';
import { reduce } from '../reducer.js';
import { selectAllItems } from '../helpers/selectors.js';
import {
  legacyTaskStatusSystemEvent,
  resetFixtureCounters,
  subagentProgress,
  subagentSummary,
  systemEvent
} from './fixtures.js';
import type { SubagentSummaryItem, SystemEventItem, UserInterjectionItem } from '../types.js';

const conversationId = 'conv_test';

describe('projection · subagent.summary', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('creates a SubagentSummaryItem on first arrival', () => {
    const next = reduce(createInitialState(conversationId), subagentSummary({
      taskId: 'task_a',
      childRunId: 'run_child',
      childConversationId: 'conv_child',
      summary: '研究完成：找到 3 个候选',
      createdAt: 10
    }));
    const items = selectAllItems(next);
    expect(items).toHaveLength(1);
    const item = items[0] as SubagentSummaryItem;
    expect(item.kind).toBe('subagent_summary');
    expect(item.taskId).toBe('task_a');
    expect(item.childRunId).toBe('run_child');
    expect(item.childConversationId).toBe('conv_child');
    expect(item.summary).toBe('研究完成：找到 3 个候选');
  });

  test('duplicate childRunId no-ops (only first wins)', () => {
    let state = reduce(createInitialState(conversationId), subagentSummary({
      taskId: 'task_a',
      childRunId: 'run_child',
      childConversationId: 'conv_child',
      summary: 'first',
      eventId: 'evt_a'
    }));
    state = reduce(state, subagentSummary({
      taskId: 'task_b',
      childRunId: 'run_child',
      childConversationId: 'conv_child',
      summary: 'second',
      eventId: 'evt_b'
    }));
    const items = selectAllItems(state);
    expect(items).toHaveLength(1);
    expect((items[0] as SubagentSummaryItem).summary).toBe('first');
  });

  test('progress before summary creates placeholder and summary patches final text', () => {
    let state = reduce(createInitialState(conversationId), subagentProgress({
      childRunId: 'run_child',
      parentToolCallId: 'tc_delegate',
      toolName: 'web_research',
      phase: 'update',
      status: 'loading',
      detail: '正在检索资料',
      occurredAt: 10
    }));
    let item = selectAllItems(state)[0] as SubagentSummaryItem;
    expect(item.summary).toBe('');
    expect(item.progressChunks).toHaveLength(1);
    expect(item.progressChunks?.[0]?.detail).toBe('正在检索资料');

    state = reduce(state, subagentSummary({
      taskId: 'task_a',
      childRunId: 'run_child',
      childConversationId: 'conv_child',
      summary: '研究完成',
      createdAt: 20
    }));
    item = selectAllItems(state)[0] as SubagentSummaryItem;
    expect(item.taskId).toBe('task_a');
    expect(item.summary).toBe('研究完成');
    expect(item.progressChunks).toHaveLength(1);
  });
});

describe('projection · system.event', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('user_interjection sourceKind maps to UserInterjectionItem', () => {
    const next = reduce(createInitialState(conversationId), systemEvent({
      sourceKind: 'user_interjection',
      detail: '主人插话：先停一下',
      occurredAt: 100,
      runId: 'r1'
    }));
    const item = selectAllItems(next)[0] as UserInterjectionItem;
    expect(item.kind).toBe('user_interjection');
    expect(item.detail).toBe('主人插话：先停一下');
    expect(item.runId).toBe('r1');
  });

  test('cron sourceKind maps to SystemEventItem', () => {
    const next = reduce(createInitialState(conversationId), systemEvent({
      sourceKind: 'cron',
      detail: '定时任务触发：early-bird',
      refId: 'cron_early_bird',
      occurredAt: 100
    }));
    const item = selectAllItems(next)[0] as SystemEventItem;
    expect(item.kind).toBe('system_event');
    expect(item.sourceKind).toBe('cron');
    expect(item.refId).toBe('cron_early_bird');
  });

  test('task_execution_notice maps to SystemEventItem', () => {
    const next = reduce(createInitialState(conversationId), systemEvent({
      sourceKind: 'task_execution_notice',
      detail: '------ Codex 任务已执行 ------',
      refId: 'task_1',
      occurredAt: 100
    }));
    const item = selectAllItems(next)[0] as SystemEventItem;
    expect(item.kind).toBe('system_event');
    expect(item.sourceKind).toBe('task_execution_notice');
    expect(item.detail).toBe('------ Codex 任务已执行 ------');
  });

  test('legacy task_status_change and channel_status are ignored', () => {
    let state = createInitialState(conversationId);
    state = reduce(state, legacyTaskStatusSystemEvent({
      conversationId,
      detail: '任务 X 已完成',
      eventId: 'evt_task'
    }));
    state = reduce(state, systemEvent({
      sourceKind: 'channel_status',
      detail: 'wechat 通道断开',
      eventId: 'evt_chan'
    }));
    expect(selectAllItems(state)).toHaveLength(0);
  });

  test('cross-conversation events are skipped', () => {
    const next = reduce(createInitialState(conversationId), systemEvent({
      conversationId: 'conv_other',
      sourceKind: 'cron',
      detail: 'noise'
    }));
    expect(selectAllItems(next)).toHaveLength(0);
  });

  test('same eventId duplicates are no-op (state reference unchanged)', () => {
    const initial = createInitialState(conversationId);
    const event = systemEvent({
      sourceKind: 'cron',
      detail: 'tick',
      eventId: 'evt_dup'
    });
    const first = reduce(initial, event);
    const second = reduce(first, event);
    expect(Object.is(first, second)).toBe(true);
  });
});
