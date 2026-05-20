import { describe, expect, test } from 'vitest';

import { createRuntimeEventHub, type RuntimeEventPollItem } from '../event-hub.js';

// 测试夹具：构造一条 message.inbound 形态的最小合法 payload。
function fakeMessage(messageId: string): { message: {
  messageId: string;
  conversationId: string;
  role: string;
  source: string;
  text: string;
  createdAt: number;
} } {
  return {
    message: {
      messageId,
      conversationId: 'conv_1',
      role: 'user',
      source: 'inbound',
      text: 'fixture',
      createdAt: 100
    }
  };
}

describe('createRuntimeEventHub', () => {
  test('publishes subscribed events with monotonic seq', () => {
    const received: string[] = [];
    const hub = createRuntimeEventHub({
      now: () => 100,
      idFactory: () => `evt_${String(received.length + 1)}`
    });
    hub.subscribe((event) => {
      received.push(`${String(event.seq)}:${event.kind}`);
    });

    const first = hub.publish({
      kind: 'message.inbound',
      conversationId: 'conv_1',
      payload: fakeMessage('msg_1')
    });
    const second = hub.publish({
      kind: 'message.complete',
      conversationId: 'conv_1',
      payload: fakeMessage('msg_2')
    });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(received).toEqual(['1:message.inbound', '2:message.complete']);
  });

  test('publishes tool_call.start with discriminated payload preserved', () => {
    const hub = createRuntimeEventHub({ idFactory: () => 'evt_tool_start', now: () => 200 });
    const event = hub.publish({
      kind: 'tool_call.start',
      conversationId: 'conv_1',
      runId: 'run_1',
      payload: {
        toolCallId: 'tc_1',
        toolName: 'list_tasks',
        args: { conversationId: 'conv_1' },
        turnId: 'turn_1',
        startedAt: 200
      }
    });
    expect(event).toMatchObject({
      kind: 'tool_call.start',
      conversationId: 'conv_1',
      runId: 'run_1',
      payload: { toolCallId: 'tc_1', toolName: 'list_tasks', startedAt: 200 }
    });
    if (event.kind !== 'tool_call.start') throw new Error('expected tool_call.start');
    expect(event.payload.args).toEqual({ conversationId: 'conv_1' });
  });

  test('publishes tool_call.result success/error/blocked with correct payload shape', () => {
    const hub = createRuntimeEventHub({ idFactory: () => 'evt_tool_result', now: () => 300 });
    const success = hub.publish({
      kind: 'tool_call.result',
      conversationId: 'conv_1',
      runId: 'run_1',
      payload: {
        toolCallId: 'tc_1',
        toolName: 'list_tasks',
        status: 'success',
        data: { items: [] },
        observation: '[]',
        durationMs: 12,
        endedAt: 300
      }
    });
    if (success.kind !== 'tool_call.result') throw new Error('expected tool_call.result');
    expect(success.payload.status).toBe('success');

    const errored = hub.publish({
      kind: 'tool_call.result',
      payload: {
        toolCallId: 'tc_2',
        toolName: 'cron_set',
        status: 'error',
        error: 'invalid cron expression',
        errorKind: 'execution',
        durationMs: 5,
        endedAt: 305
      }
    });
    if (errored.kind !== 'tool_call.result') throw new Error('expected tool_call.result');
    expect(errored.payload.errorKind).toBe('execution');

    const blocked = hub.publish({
      kind: 'tool_call.result',
      payload: {
        toolCallId: 'tc_3',
        toolName: 'delegate_to_external',
        status: 'blocked',
        durationMs: 0,
        endedAt: 310
      }
    });
    if (blocked.kind !== 'tool_call.result') throw new Error('expected tool_call.result');
    expect(blocked.payload.status).toBe('blocked');
  });

  test('publishes tool_call.progress with process detail preserved', () => {
    const hub = createRuntimeEventHub({ idFactory: () => 'evt_tool_progress', now: () => 350 });
    const event = hub.publish({
      kind: 'tool_call.progress',
      conversationId: 'conv_1',
      runId: 'run_1',
      payload: {
        toolCallId: 'tc_1',
        toolName: 'delegate_to_internal',
        phase: 'update',
        status: 'loading',
        occurredAt: 350,
        detail: '子任务正在整理资料'
      }
    });
    if (event.kind !== 'tool_call.progress') throw new Error('expected tool_call.progress');
    expect(event.payload.detail).toBe('子任务正在整理资料');
  });

  test('publishes subagent.progress with child run identity preserved', () => {
    const hub = createRuntimeEventHub({ idFactory: () => 'evt_sub_progress', now: () => 360 });
    const event = hub.publish({
      kind: 'subagent.progress',
      conversationId: 'conv_main',
      runId: 'run_parent',
      payload: {
        childRunId: 'run_child',
        parentToolCallId: 'tc_delegate',
        kind: 'tool_process',
        status: 'loading',
        toolName: 'web_research',
        phase: 'update',
        occurredAt: 360,
        detail: '正在检索'
      }
    });
    if (event.kind !== 'subagent.progress') throw new Error('expected subagent.progress');
    expect(event.payload.childRunId).toBe('run_child');
    expect(event.payload.parentToolCallId).toBe('tc_delegate');
  });

  test('publishes subagent.summary with childRunId / summary preserved', () => {
    const hub = createRuntimeEventHub({ idFactory: () => 'evt_sub', now: () => 400 });
    const event = hub.publish({
      kind: 'subagent.summary',
      conversationId: 'conv_main',
      runId: 'run_child',
      payload: {
        taskId: 'task_1',
        childRunId: 'run_child',
        childConversationId: 'conv_child',
        summary: '已完成研究：拿到 3 个候选方案'
      }
    });
    if (event.kind !== 'subagent.summary') throw new Error('expected subagent.summary');
    expect(event.payload.summary).toContain('已完成研究');
  });

  test('publishes thought delta / complete with thoughtId preserved', () => {
    let nextId = 1;
    const hub = createRuntimeEventHub({
      idFactory: () => `evt_thought_${String(nextId++)}`,
      now: () => 450
    });
    const delta = hub.publish({
      kind: 'message.thought_delta',
      conversationId: 'conv_1',
      runId: 'run_1',
      payload: {
        turnId: 'turn_1',
        thoughtId: 'thought_1',
        chunk: '先想一下',
        chunkSeq: 0
      }
    });
    const complete = hub.publish({
      kind: 'message.thought_complete',
      conversationId: 'conv_1',
      runId: 'run_1',
      payload: {
        turnId: 'turn_1',
        thoughtId: 'thought_1',
        text: '先想一下'
      }
    });

    if (delta.kind !== 'message.thought_delta') throw new Error('expected message.thought_delta');
    if (complete.kind !== 'message.thought_complete') throw new Error('expected message.thought_complete');
    expect(delta.payload.chunkSeq).toBe(0);
    expect(complete.payload.text).toBe('先想一下');
  });

  test('publishes system.event with each active sourceKind', () => {
    const hub = createRuntimeEventHub({ idFactory: () => 'evt_sys', now: () => 500 });
    const cron = hub.publish({
      kind: 'system.event',
      conversationId: 'conv_1',
      payload: { sourceKind: 'cron', detail: '每天 9 点提醒打卡', refId: 'job_1', occurredAt: 500 }
    });
    if (cron.kind !== 'system.event') throw new Error('expected system.event');
    expect(cron.payload.sourceKind).toBe('cron');

    const interjection = hub.publish({
      kind: 'system.event',
      conversationId: 'conv_1',
      payload: { sourceKind: 'user_interjection', detail: '主人在 LLM 回复时插话', occurredAt: 501 }
    });
    if (interjection.kind !== 'system.event') throw new Error('expected system.event');
    expect(interjection.payload.sourceKind).toBe('user_interjection');

    const executionNotice = hub.publish({
      kind: 'system.event',
      conversationId: 'conv_1',
      payload: {
        sourceKind: 'task_execution_notice',
        detail: '------ Codex 任务已执行 ------',
        refId: 'task_1',
        occurredAt: 502
      }
    });
    if (executionNotice.kind !== 'system.event') throw new Error('expected system.event');
    expect(executionNotice.payload.sourceKind).toBe('task_execution_notice');

    const channel = hub.publish({
      kind: 'system.event',
      payload: { sourceKind: 'channel_status', detail: '微信掉线', refId: 'wechat:default', occurredAt: 503 }
    });
    if (channel.kind !== 'system.event') throw new Error('expected system.event');
    expect(channel.payload.sourceKind).toBe('channel_status');
  });

  test('polls after cursor and keeps only the ring buffer window', () => {
    let nextId = 1;
    const hub = createRuntimeEventHub({
      maxEvents: 2,
      idFactory: () => `evt_${String(nextId++)}`
    });

    hub.publish({ kind: 'message.inbound', payload: fakeMessage('msg_1') });
    hub.publish({
      kind: 'message.delta',
      payload: { turnId: 't', answerId: 'a', chunkSeq: 0, delta: 'x' }
    });
    hub.publish({ kind: 'message.complete', payload: fakeMessage('msg_3') });

    expect(hub.poll().events.map((event) => event.seq)).toEqual([2, 3]);
    expect(hub.poll({ since: '2' })).toMatchObject({
      events: [{ seq: 3 }],
      nextCursor: '3'
    });
  });

  test('polls from persisted history when a history port is injected', () => {
    let nextId = 1;
    const history: RuntimeEventPollItem[] = [];
    const hub = createRuntimeEventHub({
      maxEvents: 1,
      idFactory: () => `evt_${String(nextId++)}`,
      persistence: {
        append(event) {
          history.push(event);
        }
      },
      history: {
        list(options = {}) {
          const sinceSeq = options.sinceSeq ?? 0;
          const limit = options.limit ?? 500;
          const events = history.filter((event) => event.seq > sinceSeq).slice(0, limit);
          const last = events.at(-1);
          return {
            events,
            ...(last === undefined ? {} : { nextCursor: String(last.seq) })
          };
        }
      }
    });

    hub.publish({ kind: 'message.inbound', payload: fakeMessage('msg_1') });
    hub.publish({
      kind: 'message.delta',
      payload: { turnId: 't', answerId: 'a', chunkSeq: 0, delta: 'x' }
    });
    hub.publish({ kind: 'message.complete', payload: fakeMessage('msg_3') });

    expect(hub.poll({ since: '1' }).events.map((event) => event.seq)).toEqual([2, 3]);
  });
});
