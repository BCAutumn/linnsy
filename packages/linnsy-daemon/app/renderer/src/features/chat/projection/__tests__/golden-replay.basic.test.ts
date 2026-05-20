import {
  beforeEach,
  describe,
  expect,
  test
} from 'vitest';

import {
  assertReplayEquivalent,
  complete,
  conversationId,
  createInitialState,
  delta,
  inbound,
  reduceAll,
  resetFixtureCounters,
  selectAllItems
} from './scenarios/golden-replay-support.js';
import type { EventEnvelope } from './scenarios/golden-replay-support.js';

describe('projection · golden replay basic paths', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('plain text streaming · single user inbound + N deltas + complete · two paths produce equivalent items', () => {
    const events: EventEnvelope[] = [
      inbound({
        message: {
          messageId: 'msg_user',
          role: 'user',
          source: 'inbound',
          text: '帮我写个 README',
          createdAt: 1
        }
      }),
      delta({ runId: 'r1', turnId: 't1', answerId: 'a1', chunkSeq: 0, delta: '没问题，', createdAt: 2 }),
      delta({ runId: 'r1', turnId: 't1', answerId: 'a1', chunkSeq: 1, delta: '我给你写一份', createdAt: 3 }),
      complete({
        runId: 'r1',
        message: {
          messageId: 'msg_assistant',
          role: 'assistant',
          source: 'outbound',
          text: '没问题，我给你写一份',
          runId: 'r1',
          createdAt: 4
        }
      })
    ];
    assertReplayEquivalent(events);
  });

  test('multi-answer self-correction · same turnId with two answerId groups · both paths preserve two AssistantBubble items in order', () => {
    // LLM 自我修正：先回了一段"搞定了"，调工具，反思后又回了一段"其实没搞定"。
    // daemon 的 stream-answer.ts 通过 bump answerId 切两段，最终 message.complete 只发一条权威。
    // 历史回放只能看到那一条权威 outbound，所以这里我们让两个 answerId 都各自有一条 complete。
    const events: EventEnvelope[] = [
      inbound({
        message: {
          messageId: 'msg_user',
          role: 'user',
          source: 'inbound',
          text: '帮我做完 X',
          createdAt: 1
        }
      }),
      delta({ runId: 'r1', turnId: 't1', answerId: 'a1', chunkSeq: 0, delta: '搞定了', createdAt: 2 }),
      complete({
        runId: 'r1',
        message: {
          messageId: 'msg_first_attempt',
          role: 'assistant',
          source: 'outbound',
          text: '搞定了',
          runId: 'r1',
          createdAt: 3
        }
      }),
      // 注：上面的 complete 把 r1 标 settled；下一段答复必须用新的 runId。
      delta({ runId: 'r2', turnId: 't1', answerId: 'a2', chunkSeq: 0, delta: '其实没搞定', createdAt: 4 }),
      complete({
        runId: 'r2',
        message: {
          messageId: 'msg_second_attempt',
          role: 'assistant',
          source: 'outbound',
          text: '其实没搞定',
          runId: 'r2',
          createdAt: 5
        }
      })
    ];
    assertReplayEquivalent(events);
  });

  test('out-of-order + reconnect · interleaved seq + duplicated event after reconnect · idempotent + ordering survive equivalence', () => {
    const userEvent = inbound({
      eventId: 'evt_user',
      message: {
        messageId: 'msg_user',
        role: 'user',
        source: 'inbound',
        text: 'hi',
        createdAt: 1
      }
    });
    const events: EventEnvelope[] = [
      userEvent,
      delta({ runId: 'r1', turnId: 't1', answerId: 'a1', chunkSeq: 1, delta: '好', createdAt: 3 }),
      delta({ runId: 'r1', turnId: 't1', answerId: 'a1', chunkSeq: 0, delta: '你', createdAt: 2 }),
      delta({ runId: 'r1', turnId: 't1', answerId: 'a1', chunkSeq: 2, delta: '！', createdAt: 4 }),
      complete({
        runId: 'r1',
        message: {
          messageId: 'msg_complete',
          role: 'assistant',
          source: 'outbound',
          text: '你好！',
          runId: 'r1',
          createdAt: 5
        }
      }),
      // 模拟 WS 断连后重连，重新 poll(since=...) 把 user 入站事件再发一次：
      userEvent
    ];
    assertReplayEquivalent(events);
    // 同时验证 user 那条没被复制成两份
    const finalState = reduceAll(createInitialState(conversationId), events);
    expect(selectAllItems(finalState).filter((it) => it.kind === 'user_bubble')).toHaveLength(1);
  });

  test('cross-conversation noise · events from other conversations interleaved · both paths keep selected conversation projection identical', () => {
    const events: EventEnvelope[] = [
      inbound({
        message: {
          conversationId,
          messageId: 'msg_self',
          role: 'user',
          source: 'inbound',
          text: 'self',
          createdAt: 1
        }
      }),
      inbound({
        conversationId: 'conv_other',
        message: {
          conversationId: 'conv_other',
          messageId: 'msg_other',
          role: 'user',
          source: 'inbound',
          text: 'other',
          createdAt: 2
        }
      }),
      delta({
        runId: 'r1',
        turnId: 't1',
        answerId: 'a1',
        chunkSeq: 0,
        delta: 'hi',
        conversationId,
        createdAt: 3
      }),
      complete({
        runId: 'r1',
        message: {
          conversationId,
          messageId: 'msg_assistant',
          role: 'assistant',
          source: 'outbound',
          text: 'hi',
          runId: 'r1',
          createdAt: 4
        }
      })
    ];
    assertReplayEquivalent(events);
  });

});
