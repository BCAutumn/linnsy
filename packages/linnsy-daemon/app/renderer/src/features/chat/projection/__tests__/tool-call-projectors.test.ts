// tool_call.start / tool_call.result projector 测试。
//
// 覆盖 §3.5 守住的不变量：
//   1) 同 toolCallId 只产生一张卡
//   2) start 后 result 来 patch 终态字段；start 后 args / startedAt / runId 不被 result 改写
//   3) result 先于 start（blocked 路径）兜底创建终态卡
//   4) 重复事件（同 eventId）走 reducer 主入口的 seenEventIds 闸门 → no-op
//   5) 跨会话事件被忽略

import { beforeEach, describe, expect, test } from 'vitest';

import { createInitialState } from '../state.js';
import { reduce } from '../reducer.js';
import { selectAllItems } from '../helpers/selectors.js';
import {
  delta,
  resetFixtureCounters,
  toolCallProgress,
  toolCallStart,
  toolCallResult
} from './fixtures.js';
import type { ToolCallCardItem } from '../types.js';

const conversationId = 'conv_test';

describe('projection · tool_call.start / tool_call.result', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('start creates a running ToolCallCardItem with frozen args', () => {
    const initial = createInitialState(conversationId);
    const next = reduce(initial, toolCallStart({
      toolCallId: 'tc_1',
      toolName: 'echo',
      args: { text: 'hi' },
      startedAt: 100,
      runId: 'r1'
    }));
    const items = selectAllItems(next);
    expect(items).toHaveLength(1);
    const card = items[0] as ToolCallCardItem;
    expect(card.kind).toBe('tool_call_card');
    expect(card.toolCallId).toBe('tc_1');
    expect(card.toolName).toBe('echo');
    expect(card.status).toBe('running');
    expect(card.args).toEqual({ text: 'hi' });
    expect(card.startedAt).toBe(100);
    expect(card.endedAt).toBeUndefined();
  });

  test('result after start patches terminal fields without overwriting args / startedAt', () => {
    const initial = createInitialState(conversationId);
    let state = reduce(initial, toolCallStart({
      toolCallId: 'tc_1',
      toolName: 'echo',
      args: { text: 'hi' },
      startedAt: 100
    }));
    state = reduce(state, toolCallResult({
      toolCallId: 'tc_1',
      toolName: 'echo',
      status: 'success',
      data: { text: 'hi' },
      observation: '返回 hi',
      durationMs: 5,
      endedAt: 105
    }));
    const card = selectAllItems(state)[0] as ToolCallCardItem;
    expect(card.status).toBe('success');
    expect(card.data).toEqual({ text: 'hi' });
    expect(card.observation).toBe('返回 hi');
    expect(card.durationMs).toBe(5);
    expect(card.endedAt).toBe(105);
    expect(card.args).toEqual({ text: 'hi' });
    expect(card.startedAt).toBe(100);
  });

  test('progress after start appends process chunks and result keeps them', () => {
    let state = reduce(createInitialState(conversationId), toolCallStart({
      toolCallId: 'tc_1',
      toolName: 'delegate_to_internal',
      args: { task: 'research' },
      startedAt: 100
    }));
    state = reduce(state, toolCallProgress({
      toolCallId: 'tc_1',
      toolName: 'delegate_to_internal',
      detail: '子 agent 已开始检索',
      occurredAt: 101
    }));
    state = reduce(state, toolCallResult({
      toolCallId: 'tc_1',
      toolName: 'delegate_to_internal',
      status: 'success',
      data: { taskId: 'task_1' },
      observation: 'done',
      durationMs: 12,
      endedAt: 112
    }));
    const card = selectAllItems(state)[0] as ToolCallCardItem;
    expect(card.progressChunks).toHaveLength(1);
    expect(card.progressChunks?.[0]?.detail).toBe('子 agent 已开始检索');
    expect(card.status).toBe('success');
  });

  test('progress-only path creates a running card placeholder', () => {
    const next = reduce(createInitialState(conversationId), toolCallProgress({
      toolCallId: 'tc_progress_first',
      toolName: 'long_tool',
      phase: 'update',
      status: 'loading',
      detail: '处理中',
      occurredAt: 10
    }));
    const card = selectAllItems(next)[0] as ToolCallCardItem;
    expect(card.status).toBe('running');
    expect(card.startedAt).toBe(10);
    expect(card.progressChunks?.[0]?.detail).toBe('处理中');
  });

  test('start after progress placeholder backfills tool args without losing progress', () => {
    let state = reduce(createInitialState(conversationId), toolCallProgress({
      toolCallId: 'tc_codex',
      toolName: 'delegate_to_external',
      phase: 'update',
      status: 'loading',
      detail: '已派发外部任务',
      occurredAt: 90,
      runId: 'run_1'
    }));
    state = reduce(state, toolCallStart({
      toolCallId: 'tc_codex',
      toolName: 'delegate_to_external',
      args: {
        definitionKey: 'delegate_to_codex',
        title: '查看 linncue 项目概述'
      },
      startedAt: 100,
      runId: 'run_1',
      turnId: 'turn_1'
    }));
    state = reduce(state, toolCallResult({
      toolCallId: 'tc_codex',
      toolName: 'delegate_to_external',
      status: 'success',
      data: { taskId: 'task_1' },
      observation: 'done',
      durationMs: 12,
      endedAt: 112,
      runId: 'run_1'
    }));

    const card = selectAllItems(state)[0] as ToolCallCardItem;
    expect(card.args).toEqual({
      definitionKey: 'delegate_to_codex',
      title: '查看 linncue 项目概述'
    });
    expect(card.progressChunks).toHaveLength(1);
    expect(card.progressChunks?.[0]?.detail).toBe('已派发外部任务');
    expect(card.status).toBe('success');
    expect(card.data).toEqual({ taskId: 'task_1' });
    expect(card.turnId).toBe('turn_1');
  });

  test('duplicate start events are ignored (first wins)', () => {
    const initial = createInitialState(conversationId);
    const event = toolCallStart({
      toolCallId: 'tc_1',
      toolName: 'echo',
      args: { text: 'first' },
      startedAt: 100,
      eventId: 'evt_dup'
    });
    let state = reduce(initial, event);
    // 同 eventId 第二次 → seenEventIds 闸门拦下 → state 引用不变
    const after = reduce(state, event);
    expect(Object.is(after, state)).toBe(true);
    expect(selectAllItems(state)).toHaveLength(1);

    // 不同 eventId 但同 toolCallId 的"二次 start"也应被丢弃（projector 内防御）
    state = reduce(state, toolCallStart({
      toolCallId: 'tc_1',
      toolName: 'echo',
      args: { text: 'second' },
      startedAt: 200,
      eventId: 'evt_other'
    }));
    const card = selectAllItems(state)[0] as ToolCallCardItem;
    expect(card.args).toEqual({ text: 'first' });
  });

  test('blocked result without start creates a terminal card directly', () => {
    const initial = createInitialState(conversationId);
    const next = reduce(initial, toolCallResult({
      toolCallId: 'tc_blocked',
      toolName: 'shell.exec',
      status: 'blocked',
      error: 'policy denied',
      errorKind: 'execution',
      durationMs: 0,
      endedAt: 50
    }));
    const card = selectAllItems(next)[0] as ToolCallCardItem;
    expect(card.status).toBe('blocked');
    expect(card.error).toBe('policy denied');
    expect(card.errorKind).toBe('execution');
    expect(card.endedAt).toBe(50);
  });

  test('cross-conversation events are skipped', () => {
    const initial = createInitialState(conversationId);
    const next = reduce(initial, toolCallStart({
      conversationId: 'conv_other',
      toolCallId: 'tc_1',
      toolName: 'echo'
    }));
    expect(selectAllItems(next)).toHaveLength(0);
  });

  test('tool_call.start stops streaming on the active assistant bubble', () => {
    const initial = createInitialState(conversationId);
    // 1. Assistant is streaming text
    let state = reduce(initial, delta({
      conversationId,
      runId: 'run_1',
      turnId: 't1',
      answerId: 'a1',
      chunkSeq: 0,
      delta: 'I will use a tool',
      createdAt: 10
    }));

    let items = selectAllItems(state);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('assistant_bubble');
    const streamingBubble = items[0];
    if (streamingBubble?.kind !== 'assistant_bubble') throw new Error('expected assistant bubble');
    expect(streamingBubble.streaming).toBe(true);

    // 2. Tool call starts
    state = reduce(state, toolCallStart({
      toolCallId: 'tc_1',
      toolName: 'echo',
      args: { text: 'hi' },
      startedAt: 100,
      runId: 'run_1'
    }));

    items = selectAllItems(state);
    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe('assistant_bubble');
    const stoppedBubble = items[0];
    if (stoppedBubble?.kind !== 'assistant_bubble') throw new Error('expected assistant bubble');
    expect(stoppedBubble.streaming).toBe(false); // Should be stopped!
    expect(items[1]?.kind).toBe('tool_call_card');
  });
});
