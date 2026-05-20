import { beforeEach, describe, expect, test } from 'vitest';

import { createInitialState } from '../state.js';
import { reduce, reduceAll } from '../reducer.js';
import { selectAllItems } from '../helpers/selectors.js';
import {
  complete,
  delta,
  resetFixtureCounters,
  thoughtComplete,
  thoughtDelta,
  toolCallResult,
  toolCallStart
} from './fixtures.js';

describe('projection · thought projectors', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('creates an assistant bubble with a streaming thought chunk before final answer starts', () => {
    const state = reduce(createInitialState('conv_test'), thoughtDelta({
      runId: 'run_1',
      turnId: 'turn_1',
      thoughtId: 'thought_1',
      chunkSeq: 0,
      chunk: '我先想一下',
      createdAt: 1000
    }));
    const item = selectAllItems(state)[0];
    expect(item).toMatchObject({
      kind: 'assistant_bubble',
      text: '',
      streaming: true
    });
    if (item?.kind !== 'assistant_bubble') throw new Error('expected assistant bubble');
    expect(item.thoughtChunks[0]?.text).toBe('我先想一下');
    expect(item.thoughtChunks[0]?.completed).toBe(false);
    expect(item.thoughtChunks[0]?.startedAt).toBe(1000);
    expect(item.thoughtChunks[0]?.updatedAt).toBe(1000);
  });

  test('orders out-of-order thought deltas by chunkSeq', () => {
    const state = reduceAll(createInitialState('conv_test'), [
      thoughtDelta({ runId: 'run_1', turnId: 'turn_1', thoughtId: 'thought_1', chunkSeq: 1, chunk: '一下', createdAt: 1200 }),
      thoughtDelta({ runId: 'run_1', turnId: 'turn_1', thoughtId: 'thought_1', chunkSeq: 0, chunk: '我先想', createdAt: 1000 })
    ]);
    const item = selectAllItems(state)[0];
    if (item?.kind !== 'assistant_bubble') throw new Error('expected assistant bubble');
    expect(item.thoughtChunks[0]?.text).toBe('我先想一下');
    expect(item.thoughtChunks[0]?.startedAt).toBe(1000);
    expect(item.thoughtChunks[0]?.updatedAt).toBe(1200);
  });

  test('marks thought complete and preserves text after message.complete settles the bubble', () => {
    const state = reduceAll(createInitialState('conv_test'), [
      thoughtDelta({ runId: 'run_1', turnId: 'turn_1', thoughtId: 'thought_1', chunkSeq: 0, chunk: '查资料', createdAt: 1000 }),
      thoughtComplete({
        runId: 'run_1',
        turnId: 'turn_1',
        thoughtId: 'thought_1',
        text: '查资料',
        createdAt: 2400
      }),
      delta({ runId: 'run_1', turnId: 'turn_1', answerId: 'answer_1', chunkSeq: 0, delta: '结果是 A' }),
      complete({
        runId: 'run_1',
        message: {
          messageId: 'msg_assistant',
          role: 'assistant',
          source: 'outbound',
          text: '结果是 A',
          runId: 'run_1',
          createdAt: 4
        }
      })
    ]);
    const item = selectAllItems(state)[0];
    if (item?.kind !== 'assistant_bubble') throw new Error('expected assistant bubble');
    expect(item.id).toBe('msg_assistant');
    expect(item.text).toBe('结果是 A');
    expect(item.thoughtChunks[0]).toMatchObject({
      text: '查资料',
      completed: true,
      startedAt: 1000,
      completedAt: 2400
    });
  });

  test('adopts the thought placeholder when the first answer delta arrives', () => {
    const state = reduceAll(createInitialState('conv_test'), [
      thoughtDelta({ runId: 'run_1', turnId: 'turn_1', thoughtId: 'thought_1', chunkSeq: 0, chunk: '先分析' }),
      delta({ runId: 'run_1', turnId: 'turn_1', answerId: 'answer_1', chunkSeq: 0, delta: '可以' })
    ]);
    const items = selectAllItems(state);
    expect(items).toHaveLength(1);
    const item = items[0];
    if (item?.kind !== 'assistant_bubble') throw new Error('expected assistant bubble');
    expect(item.id).toBe('stream:run_1:answer_1');
    expect(item.text).toBe('可以');
    expect(item.thoughtChunks[0]?.text).toBe('先分析');
    expect(item.thoughtChunks[0]?.completed).toBe(true);
  });

  test('keeps post-tool thought with the next answer segment instead of the previous text bubble', () => {
    const state = reduceAll(createInitialState('conv_test'), [
      thoughtDelta({ runId: 'run_1', turnId: 'turn_1', thoughtId: 'thought_1', chunkSeq: 0, chunk: '先看看要不要查' }),
      delta({ runId: 'run_1', turnId: 'turn_1', answerId: 'answer_1', chunkSeq: 0, delta: '我先查一下。' }),
      toolCallStart({
        runId: 'run_1',
        turnId: 'turn_1',
        toolCallId: 'call_1',
        toolName: 'recall_memory'
      }),
      toolCallResult({
        runId: 'run_1',
        toolCallId: 'call_1',
        toolName: 'recall_memory',
        status: 'success',
        data: { found: true },
        observation: '查到了'
      }),
      thoughtDelta({ runId: 'run_1', turnId: 'turn_1', thoughtId: 'thought_2', chunkSeq: 0, chunk: '工具回来了，重新组织答案' }),
      thoughtComplete({
        runId: 'run_1',
        turnId: 'turn_1',
        thoughtId: 'thought_2',
        text: '工具回来了，重新组织答案'
      }),
      delta({ runId: 'run_1', turnId: 'turn_1', answerId: 'answer_1#1', chunkSeq: 0, delta: '结果是 A。' }),
      complete({
        runId: 'run_1',
        message: {
          messageId: 'msg_assistant',
          role: 'assistant',
          source: 'outbound',
          text: '结果是 A。',
          runId: 'run_1',
          createdAt: 8
        }
      })
    ]);
    const assistantItems = selectAllItems(state).filter((item) => item.kind === 'assistant_bubble');
    expect(assistantItems).toHaveLength(2);
    const first = assistantItems[0];
    const final = assistantItems[1];
    if (first?.kind !== 'assistant_bubble' || final?.kind !== 'assistant_bubble') {
      throw new Error('expected assistant bubbles');
    }

    expect(first.text).toBe('我先查一下。');
    expect(first.thoughtChunks.map((chunk) => chunk.text)).toEqual(['先看看要不要查']);
    expect(final.id).toBe('msg_assistant');
    expect(final.text).toBe('结果是 A。');
    expect(final.thoughtChunks.map((chunk) => chunk.text)).toEqual(['工具回来了，重新组织答案']);
  });

  test('keeps post-tool thought after a thought-only segment behind the tool card', () => {
    const state = reduceAll(createInitialState('conv_test'), [
      thoughtDelta({ runId: 'run_1', turnId: 'turn_1', thoughtId: 'thought_1', chunkSeq: 0, chunk: '工具前先想一下', createdAt: 1000 }),
      thoughtComplete({
        runId: 'run_1',
        turnId: 'turn_1',
        thoughtId: 'thought_1',
        text: '工具前先想一下',
        createdAt: 1200
      }),
      toolCallStart({
        runId: 'run_1',
        turnId: 'turn_1',
        toolCallId: 'call_1',
        toolName: 'recall_memory',
        createdAt: 1300
      }),
      toolCallResult({
        runId: 'run_1',
        toolCallId: 'call_1',
        toolName: 'recall_memory',
        status: 'success',
        data: { found: true },
        observation: '查到了',
        createdAt: 1600
      }),
      thoughtDelta({ runId: 'run_1', turnId: 'turn_1', thoughtId: 'thought_2', chunkSeq: 0, chunk: '工具后重新组织', createdAt: 1700 }),
      delta({ runId: 'run_1', turnId: 'turn_1', answerId: 'answer_1', chunkSeq: 0, delta: '最终答案。', createdAt: 1800 }),
      complete({
        runId: 'run_1',
        message: {
          messageId: 'msg_assistant',
          role: 'assistant',
          source: 'outbound',
          text: '最终答案。',
          runId: 'run_1',
          createdAt: 1900
        }
      })
    ]);
    const items = selectAllItems(state);
    expect(items.map((item) => item.kind)).toEqual([
      'assistant_bubble',
      'tool_call_card',
      'assistant_bubble'
    ]);
    const first = items[0];
    const tool = items[1];
    const final = items[2];
    if (first?.kind !== 'assistant_bubble' || tool?.kind !== 'tool_call_card' || final?.kind !== 'assistant_bubble') {
      throw new Error('expected thought-only assistant, tool card, final assistant');
    }

    expect(first.text).toBe('');
    expect(first.thoughtChunks.map((chunk) => chunk.text)).toEqual(['工具前先想一下']);
    expect(first.streaming).toBe(false);
    expect(final.id).toBe('msg_assistant');
    expect(final.text).toBe('最终答案。');
    expect(final.thoughtChunks.map((chunk) => chunk.text)).toEqual(['工具后重新组织']);
  });

  test('settles incomplete thought chunks when message.complete arrives without thought_complete', () => {
    const state = reduceAll(createInitialState('conv_test'), [
      thoughtDelta({ runId: 'run_1', turnId: 'turn_1', thoughtId: 'thought_1', chunkSeq: 0, chunk: '只有 delta 的思考' }),
      complete({
        runId: 'run_1',
        message: {
          messageId: 'msg_assistant',
          role: 'assistant',
          source: 'outbound',
          text: '',
          runId: 'run_1',
          createdAt: 2
        }
      })
    ]);
    const item = selectAllItems(state)[0];
    if (item?.kind !== 'assistant_bubble') throw new Error('expected assistant bubble');

    expect(item.streaming).toBe(false);
    expect(item.thoughtChunks[0]).toMatchObject({
      text: '只有 delta 的思考',
      completed: true
    });
  });

  test('ignores events from other conversations', () => {
    const state = reduce(createInitialState('conv_test'), thoughtDelta({
      conversationId: 'conv_other',
      runId: 'run_1',
      turnId: 'turn_1',
      thoughtId: 'thought_1',
      chunkSeq: 0,
      chunk: '不该显示'
    }));
    expect(selectAllItems(state)).toEqual([]);
  });
});
