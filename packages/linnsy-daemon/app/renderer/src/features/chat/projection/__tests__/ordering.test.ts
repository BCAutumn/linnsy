import { beforeEach, describe, expect, test } from 'vitest';

import { createInitialState } from '../state.js';
import { reduceAll } from '../reducer.js';
import { selectAllItems } from '../helpers/selectors.js';
import { delta, inbound, resetFixtureCounters } from './fixtures.js';

const conversationId = 'conv_test';

describe('projection reducer · ordering & answer grouping', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('out-of-order delta chunks are sorted by chunkSeq before concatenation', () => {
    const events = [
      delta({ runId: 'r', turnId: 't', answerId: 'a', chunkSeq: 0, delta: '你', createdAt: 1 }),
      delta({ runId: 'r', turnId: 't', answerId: 'a', chunkSeq: 2, delta: '😊', createdAt: 3 }),
      delta({ runId: 'r', turnId: 't', answerId: 'a', chunkSeq: 1, delta: '好', createdAt: 2 })
    ];
    const state = reduceAll(createInitialState(conversationId), events);
    const item = selectAllItems(state)[0];
    if (item?.kind !== 'assistant_bubble') throw new Error('expected assistant_bubble');
    expect(item.text).toBe('你好😊');
  });

  test('deltas with different answerId on the same turnId form two independent AssistantBubble items', () => {
    const events = [
      delta({ runId: 'r', turnId: 't', answerId: 'first', chunkSeq: 0, delta: '搞定了', createdAt: 1 }),
      delta({ runId: 'r', turnId: 't', answerId: 'second', chunkSeq: 0, delta: '其实没搞定', createdAt: 2 })
    ];
    const state = reduceAll(createInitialState(conversationId), events);
    const items = selectAllItems(state);
    expect(items).toHaveLength(2);
    if (items[0]?.kind !== 'assistant_bubble' || items[1]?.kind !== 'assistant_bubble') {
      throw new Error('expected both items to be assistant_bubble');
    }
    expect(items[0].answerId).toBe('first');
    expect(items[0].text).toBe('搞定了');
    expect(items[1].answerId).toBe('second');
    expect(items[1].text).toBe('其实没搞定');
  });

  test('itemOrder respects first-seen order across multiple answer groups (group A appears before group B)', () => {
    // 两个 answer 交替到达：A=0, B=0, A=1, B=1
    // 期望 itemOrder = [A, B]，因为 A 先出现。
    const events = [
      delta({ runId: 'r', turnId: 't', answerId: 'A', chunkSeq: 0, delta: 'a0', createdAt: 1 }),
      delta({ runId: 'r', turnId: 't', answerId: 'B', chunkSeq: 0, delta: 'b0', createdAt: 2 }),
      delta({ runId: 'r', turnId: 't', answerId: 'A', chunkSeq: 1, delta: 'a1', createdAt: 3 }),
      delta({ runId: 'r', turnId: 't', answerId: 'B', chunkSeq: 1, delta: 'b1', createdAt: 4 })
    ];
    const state = reduceAll(createInitialState(conversationId), events);
    const items = selectAllItems(state);
    expect(items.map((it) => it.kind === 'assistant_bubble' ? it.text : '')).toEqual(['a0a1', 'b0b1']);
  });

  test('within a single answer group, chunkSeq drives concatenation order — late chunkSeq=2 after seq=3 still goes between seq=1 and seq=3', () => {
    const events = [
      delta({ runId: 'r', turnId: 't', answerId: 'a', chunkSeq: 1, delta: 'B', createdAt: 1 }),
      delta({ runId: 'r', turnId: 't', answerId: 'a', chunkSeq: 3, delta: 'D', createdAt: 2 }),
      delta({ runId: 'r', turnId: 't', answerId: 'a', chunkSeq: 0, delta: 'A', createdAt: 3 }),
      delta({ runId: 'r', turnId: 't', answerId: 'a', chunkSeq: 2, delta: 'C', createdAt: 4 })
    ];
    const state = reduceAll(createInitialState(conversationId), events);
    const item = selectAllItems(state)[0];
    if (item?.kind !== 'assistant_bubble') throw new Error('expected assistant_bubble');
    expect(item.text).toBe('ABCD');
  });

  test('a turn that mixes user inbound + assistant deltas + assistant complete keeps user message visually before assistant', () => {
    const events = [
      inbound({
        message: {
          messageId: 'msg_user',
          role: 'user',
          source: 'inbound',
          text: 'go',
          createdAt: 1
        }
      }),
      delta({ runId: 'r', turnId: 't', answerId: 'a', chunkSeq: 0, delta: 'thinking...', createdAt: 2 }),
      delta({ runId: 'r', turnId: 't', answerId: 'a', chunkSeq: 1, delta: ' done.', createdAt: 3 })
    ];
    const state = reduceAll(createInitialState(conversationId), events);
    const items = selectAllItems(state);
    expect(items[0]?.kind).toBe('user_bubble');
    expect(items[1]?.kind).toBe('assistant_bubble');
  });
});
