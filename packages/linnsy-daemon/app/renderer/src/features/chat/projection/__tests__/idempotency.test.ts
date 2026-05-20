import { beforeEach, describe, expect, test } from 'vitest';

import { createInitialState } from '../state.js';
import { reduce, reduceAll } from '../reducer.js';
import { selectAllItems } from '../helpers/selectors.js';
import { complete, delta, inbound, resetFixtureCounters } from './fixtures.js';

const conversationId = 'conv_test';

describe('projection reducer · idempotency', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('replaying the same eventId is a strict no-op (Object.is on state reference)', () => {
    const event = inbound({
      message: {
        messageId: 'msg_1',
        role: 'user',
        source: 'inbound',
        text: 'a',
        createdAt: 1
      },
      eventId: 'evt_dup'
    });
    const first = reduce(createInitialState(conversationId), event);
    const second = reduce(first, event);
    expect(Object.is(second, first)).toBe(true);
  });

  test('delta arriving after message.complete with same runId is dropped (settled run protection)', () => {
    const runId = 'run_1';
    const initial = createInitialState(conversationId);
    const afterDelta = reduce(initial, delta({
      runId, turnId: 'turn', answerId: 'ans', chunkSeq: 0, delta: 'hi ', createdAt: 1
    }));
    const settled = reduce(afterDelta, complete({
      runId,
      message: {
        messageId: 'msg_final',
        role: 'assistant',
        source: 'outbound',
        text: 'hi',
        runId,
        createdAt: 2
      }
    }));
    const lateDelta = reduce(settled, delta({
      runId, turnId: 'turn', answerId: 'ans', chunkSeq: 1, delta: 'late', createdAt: 3
    }));
    expect(lateDelta.itemsById).toBe(settled.itemsById);
    expect(lateDelta.itemOrder).toBe(settled.itemOrder);
    const item = selectAllItems(lateDelta)[0];
    if (item?.kind !== 'assistant_bubble') throw new Error('expected assistant');
    expect(item.text).toBe('hi');
  });

  test('inbound with the same messageId arriving twice does not create duplicate items', () => {
    const initial = createInitialState(conversationId);
    const first = reduce(initial, inbound({
      message: {
        messageId: 'msg_dup',
        role: 'user',
        source: 'inbound',
        text: 'once',
        createdAt: 1
      }
    }));
    const second = reduce(first, inbound({
      message: {
        messageId: 'msg_dup',
        role: 'user',
        source: 'inbound',
        text: 'twice',
        createdAt: 2
      }
    }));
    // 不同 eventId 但同 messageId → 第二次进入业务逻辑后，因 itemsById 已有命中，应 no-op。
    expect(second.itemsById).toBe(first.itemsById);
    expect(second.itemOrder).toBe(first.itemOrder);
  });

  test('optimistic local message is replaced by clientMessageId match while preserving its position in itemOrder', () => {
    const initial = createInitialState(conversationId);
    // 模拟 chat-actions.sendDesktopMessage 的乐观写入：optimistic 用 clientMessageId 占位
    const optimisticInbound = inbound({
      message: {
        messageId: 'local_1',
        role: 'user',
        source: 'inbound',
        text: 'pending',
        metadata: { clientMessageId: 'local_1' },
        createdAt: 1
      }
    });
    const otherUser = inbound({
      message: {
        messageId: 'msg_other',
        role: 'user',
        source: 'inbound',
        text: 'other',
        createdAt: 2
      }
    });
    const stateAfterOptimistic = reduceAll(initial, [optimisticInbound, otherUser]);
    const orderBefore = [...stateAfterOptimistic.itemOrder];
    expect(orderBefore).toEqual(['local_1', 'msg_other']);

    // 后端权威态到达，messageId 切到 msg_authoritative，metadata 仍带 clientMessageId
    const authoritative = inbound({
      message: {
        messageId: 'msg_authoritative',
        role: 'user',
        source: 'inbound',
        text: 'pending',
        metadata: { clientMessageId: 'local_1' },
        createdAt: 3
      }
    });
    const final = reduce(stateAfterOptimistic, authoritative);
    expect(final.itemOrder).toEqual(['msg_authoritative', 'msg_other']);
  });

  test('optimistic message metadata (clientMessageId, etc.) survives the optimistic→authoritative swap', () => {
    const initial = createInitialState(conversationId);
    const optimistic = inbound({
      message: {
        messageId: 'local_99',
        role: 'user',
        source: 'inbound',
        text: 'hi',
        metadata: { clientMessageId: 'local_99', custom: 'preserve_me' },
        createdAt: 1
      }
    });
    const authoritative = inbound({
      message: {
        messageId: 'msg_99',
        role: 'user',
        source: 'inbound',
        text: 'hi',
        metadata: { clientMessageId: 'local_99', custom: 'preserve_me' },
        createdAt: 2
      }
    });
    const state = reduceAll(initial, [optimistic, authoritative]);
    const item = state.itemsById.get('msg_99');
    if (item?.kind !== 'user_bubble') throw new Error('expected user_bubble');
    expect(item.metadata).toMatchObject({ clientMessageId: 'local_99', custom: 'preserve_me' });
    expect(item.clientMessageId).toBe('local_99');
  });

  test('seenEventIds grows monotonically; same event applied 1000 times still returns identical business projection', () => {
    const event = inbound({
      message: {
        messageId: 'msg_loop',
        role: 'user',
        source: 'inbound',
        text: 'loop',
        createdAt: 1
      },
      eventId: 'evt_loop'
    });
    let state = reduce(createInitialState(conversationId), event);
    const baseline = state;
    for (let i = 0; i < 1000; i += 1) {
      state = reduce(state, event);
    }
    expect(Object.is(state, baseline)).toBe(true);
    expect(state.seenEventIds.size).toBe(1);
  });
});
