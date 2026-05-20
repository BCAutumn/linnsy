import {
  beforeEach,
  describe,
  expect,
  test
} from 'vitest';

import {
  assertDualSourceReplayEquivalent,
  complete,
  conversationId,
  delta,
  eventsToMessages,
  hydrateFromMessages,
  hydrateFromMessagesAndEvents,
  inbound,
  legacyTaskStatusSystemEvent,
  reduce,
  resetFixtureCounters,
  selectAllItems,
  subagentProgress,
  subagentSummary,
  systemEvent,
  thoughtComplete,
  thoughtDelta,
  toPersistedTimelineEvents,
  toolCallProgress,
  toolCallResult,
  toolCallStart
} from './scenarios/golden-replay-support.js';
import type { EventEnvelope } from './scenarios/golden-replay-support.js';

describe('projection · golden replay dual source paths', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('S2 dual-source replay equivalence · message + tool_call + subagent + system events', () => {
    const events: EventEnvelope[] = [
      inbound({
        message: { messageId: 'msg_user', role: 'user', source: 'inbound', text: '帮我查天气', createdAt: 1 }
      }),
      // assistant 在工具调用前先回了一段
      delta({ runId: 'r1', turnId: 't1', answerId: 'a1', chunkSeq: 0, delta: '我去查一下', createdAt: 2 }),
      complete({
        runId: 'r1',
        message: {
          messageId: 'msg_pre_tool', role: 'assistant', source: 'outbound',
          text: '我去查一下', runId: 'r1', createdAt: 3
        }
      }),
      toolCallStart({
        toolCallId: 'tc_weather', toolName: 'weather.lookup',
        args: { city: 'Beijing' }, startedAt: 4, runId: 'r1'
      }),
      toolCallResult({
        toolCallId: 'tc_weather', toolName: 'weather.lookup',
        status: 'success', data: { weather: 'sunny' }, observation: '"sunny"', durationMs: 10, endedAt: 14
      }),
      // 子 agent 完成汇报
      subagentSummary({
        taskId: 'task_research', childRunId: 'run_child_1',
        childConversationId: 'conv_child_1', summary: '研究完成', createdAt: 15
      }),
      // cron 系统事件
      systemEvent({
        sourceKind: 'cron', detail: '定时检查邮件', refId: 'cron_email', createdAt: 16
      }),
      // assistant 收尾
      complete({
        runId: 'r2',
        message: {
          messageId: 'msg_final', role: 'assistant', source: 'outbound',
          text: '北京晴天', runId: 'r2', createdAt: 17
        }
      })
    ];

    assertDualSourceReplayEquivalent(events);
  });

  test('S5.0 dual-source replay equivalence · thought + final answer stay in one assistant bubble', () => {
    const events: EventEnvelope[] = [
      inbound({
        message: { messageId: 'msg_user', role: 'user', source: 'inbound', text: '你怎么想？', createdAt: 1 }
      }),
      thoughtDelta({
        runId: 'r1', turnId: 't1', thoughtId: 'thought_1',
        chunkSeq: 0, chunk: '先拆问题。', createdAt: 2
      }),
      thoughtDelta({
        runId: 'r1', turnId: 't1', thoughtId: 'thought_1',
        chunkSeq: 1, chunk: '再给结论。', createdAt: 3
      }),
      thoughtComplete({
        runId: 'r1', turnId: 't1', thoughtId: 'thought_1',
        text: '先拆问题。再给结论。', createdAt: 4
      }),
      delta({ runId: 'r1', turnId: 't1', answerId: 'a1', chunkSeq: 0, delta: '结论是 A', createdAt: 5 }),
      complete({
        runId: 'r1',
        message: {
          messageId: 'msg_assistant', role: 'assistant', source: 'outbound',
          text: '结论是 A', runId: 'r1', createdAt: 6
        }
      })
    ];

    assertDualSourceReplayEquivalent(events);
    const messages = eventsToMessages(events).filter((m) => m.conversationId === undefined || m.conversationId === conversationId);
    const hydratedItems = selectAllItems(hydrateFromMessagesAndEvents(
      conversationId,
      messages,
      toPersistedTimelineEvents(events)
    ));
    const assistant = hydratedItems.find((item) => item.kind === 'assistant_bubble');
    if (assistant?.kind !== 'assistant_bubble') throw new Error('expected assistant bubble');
    expect(assistant.thoughtChunks[0]).toMatchObject({
      text: '先拆问题。再给结论。',
      completed: true
    });
  });

  test('S5.5 dual-source replay equivalence · thought + progress + multi-answer mixed timeline', () => {
    const events: EventEnvelope[] = [
      inbound({
        message: {
          messageId: 'msg_user',
          role: 'user',
          source: 'inbound',
          text: '帮我调研并汇报',
          createdAt: 1
        }
      }),
      thoughtDelta({
        runId: 'r1',
        turnId: 't1',
        thoughtId: 'thought_1',
        chunkSeq: 0,
        chunk: '先确认目标。',
        createdAt: 2
      }),
      thoughtComplete({
        runId: 'r1',
        turnId: 't1',
        thoughtId: 'thought_1',
        text: '先确认目标。',
        createdAt: 3
      }),
      // 第一段答复没有 message.complete，只能靠 events 表里的 message.delta 恢复。
      delta({
        runId: 'r1',
        turnId: 't1',
        answerId: 'answer_pre_tool',
        chunkSeq: 0,
        delta: '我先去查资料。',
        createdAt: 4
      }),
      toolCallStart({
        runId: 'r1',
        toolCallId: 'tc_delegate',
        toolName: 'delegate_to_internal',
        args: { definitionKey: 'linnsy-general-subagent' },
        startedAt: 5
      }),
      toolCallProgress({
        runId: 'r1',
        toolCallId: 'tc_delegate',
        toolName: 'delegate_to_internal',
        phase: 'update',
        status: 'loading',
        detail: '子 agent 已启动',
        occurredAt: 6
      }),
      subagentProgress({
        runId: 'r1',
        childRunId: 'run_child_1',
        parentToolCallId: 'tc_delegate',
        kind: 'tool_process',
        status: 'loading',
        toolName: 'web_research',
        toolCallId: 'tc_child_search',
        phase: 'update',
        detail: '正在检索公开资料',
        occurredAt: 7
      }),
      subagentSummary({
        taskId: 'task_research',
        childRunId: 'run_child_1',
        childConversationId: 'conv_child_1',
        summary: '子 agent 完成：整理了 3 条依据。',
        createdAt: 8
      }),
      toolCallResult({
        runId: 'r1',
        toolCallId: 'tc_delegate',
        toolName: 'delegate_to_internal',
        status: 'success',
        data: { taskId: 'task_research' },
        observation: 'done',
        durationMs: 4,
        endedAt: 9
      }),
      // 历史里如果存在任务状态事件，投影层也应静默忽略；完成结果由主秘书自然汇报。
      legacyTaskStatusSystemEvent({
        runId: 'r1',
        detail: '调研子任务完成',
        refId: 'task_research',
        createdAt: 10
      }),
      // 同 run 第二段答复切 answerId，第一段应在此时收尾但不 settle 整个 run。
      delta({
        runId: 'r1',
        turnId: 't1',
        answerId: 'answer_final',
        chunkSeq: 0,
        delta: '调研完成，',
        createdAt: 11
      }),
      delta({
        runId: 'r1',
        turnId: 't1',
        answerId: 'answer_final',
        chunkSeq: 1,
        delta: '结论如下。',
        createdAt: 12
      }),
      complete({
        runId: 'r1',
        message: {
          messageId: 'msg_final',
          role: 'assistant',
          source: 'outbound',
          text: '调研完成，结论如下。',
          runId: 'r1',
          createdAt: 13
        }
      })
    ];

    assertDualSourceReplayEquivalent(events);
    const hydratedItems = selectAllItems(hydrateFromMessagesAndEvents(
      conversationId,
      eventsToMessages(events),
      toPersistedTimelineEvents(events)
    ));

    expect(hydratedItems.map((item) => item.kind)).toEqual([
      'user_bubble',
      'assistant_bubble',
      'tool_call_card',
      'subagent_summary',
      'assistant_bubble'
    ]);
    const toolCard = hydratedItems.find((item) => item.kind === 'tool_call_card');
    if (toolCard?.kind !== 'tool_call_card') throw new Error('expected tool card');
    expect(toolCard.progressChunks?.[0]?.detail).toBe('子 agent 已启动');
    const subagent = hydratedItems.find((item) => item.kind === 'subagent_summary');
    if (subagent?.kind !== 'subagent_summary') throw new Error('expected subagent summary');
    expect(subagent.progressChunks?.[0]?.detail).toBe('正在检索公开资料');
  });

  test('seenEventIds is hydration-irrelevant · hydrate produces a state where re-applying the original event sequence is a no-op (Object.is)', () => {
    const events: EventEnvelope[] = [
      inbound({
        message: {
          messageId: 'msg_user',
          role: 'user',
          source: 'inbound',
          text: 'hi',
          createdAt: 1
        }
      }),
      complete({
        runId: 'r1',
        message: {
          messageId: 'msg_assistant',
          role: 'assistant',
          source: 'outbound',
          text: 'hello',
          runId: 'r1',
          createdAt: 2
        }
      })
    ];
    const messages = eventsToMessages(events);
    const userMsg = messages[0];
    const assistantMsg = messages[1];
    if (userMsg === undefined || assistantMsg === undefined) {
      throw new Error('test fixture must produce two messages');
    }
    const hydrated = hydrateFromMessages(conversationId, messages);
    // 再喂一遍 hydration 用过的等价事件，应当 no-op（同 eventId 已 seen）
    let next = hydrated;
    next = reduce(next, {
      eventId: 'hydrate:msg_user',
      seq: 1,
      kind: 'message.inbound',
      createdAt: 1,
      conversationId,
      messageId: 'msg_user',
      payload: { message: { ...userMsg, conversationId } }
    });
    next = reduce(next, {
      eventId: 'hydrate:msg_assistant',
      seq: 2,
      kind: 'message.complete',
      createdAt: 2,
      conversationId,
      messageId: 'msg_assistant',
      runId: 'r1',
      payload: { message: { ...assistantMsg, conversationId } }
    });
    expect(Object.is(next, hydrated)).toBe(true);
  });
});
