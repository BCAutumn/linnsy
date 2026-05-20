import { beforeEach, describe, expect, test } from 'vitest';

import { createInitialState } from '../state.js';
import { reduce, reduceAll } from '../reducer.js';
import { selectAllItems } from '../helpers/selectors.js';
import { complete, delta, inbound, resetFixtureCounters, runStatusChange } from './fixtures.js';
import { streamingAssistantItemId } from '../helpers/ids.js';

const conversationId = 'conv_test';
const runId = 'run_stream';
const turnId = 'turn_stream';
const answerId = 'ans_stream';

function deltaSeq(parts: readonly string[]): ReturnType<typeof delta>[] {
  return parts.map((part, index) => delta({
    runId,
    turnId,
    answerId,
    chunkSeq: index,
    delta: part,
    createdAt: 100 + index
  }));
}

describe('projection reducer · streaming delta concatenation', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('concatenates delta chunks character-equivalent to the full string', () => {
    const fullText = 'Hello, **linnsy**!\nNice to meet you.\n\n- list a\n- list b';
    const parts = sliceIntoChunks(fullText, 5);
    const state = reduceAll(createInitialState(conversationId), deltaSeq(parts));
    const items = selectAllItems(state);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'assistant_bubble', text: fullText, streaming: true });
  });

  test('preserves leading and trailing newlines inside delta chunks (no trim)', () => {
    const parts = ['\n**A**\n', '\n- item\n', '\n\n**B**\n'];
    const state = reduceAll(createInitialState(conversationId), deltaSeq(parts));
    const item = selectAllItems(state)[0];
    expect(item?.kind).toBe('assistant_bubble');
    if (item?.kind === 'assistant_bubble') {
      expect(item.text).toBe(parts.join(''));
    }
  });

  test('preserves multi-byte character boundaries (CJK + emoji split across chunks)', () => {
    // 故意把"你好🌟"按 byte 边界拆成奇怪的位置，确保 chunk 内容是字符串而不是 byte 缓冲。
    // reducer 不应该尝试解码 / 重组 byte，永远以 string 字面量拼接。
    const parts = ['你', '好', '🌟', '世', '界'];
    const state = reduceAll(createInitialState(conversationId), deltaSeq(parts));
    const item = selectAllItems(state)[0];
    if (item?.kind !== 'assistant_bubble') throw new Error('expected assistant_bubble');
    expect(item.text).toBe('你好🌟世界');
  });

  test('appends to the streaming item created by the first delta, never creates a sibling', () => {
    const state = reduceAll(createInitialState(conversationId), deltaSeq(['a', 'b', 'c']));
    expect(selectAllItems(state)).toHaveLength(1);
    const expectedId = streamingAssistantItemId(runId, answerId);
    expect(state.itemsById.get(expectedId)?.kind).toBe('assistant_bubble');
  });

  test('ignores empty delta chunks without changing state reference', () => {
    const initial = createInitialState(conversationId);
    const populated = reduce(initial, delta({
      runId, turnId, answerId, chunkSeq: 0, delta: 'hi', createdAt: 1
    }));
    const empty = delta({
      runId, turnId, answerId, chunkSeq: 1, delta: '', createdAt: 2
    });
    const next = reduce(populated, empty);
    expect(next.itemsById).toBe(populated.itemsById);
    expect(next.itemOrder).toBe(populated.itemOrder);
  });

  test('does not promote a non-streaming legacy assistant message into the streaming target', () => {
    const initial = createInitialState(conversationId);
    // 先收一条 settled 的 assistant inbound（比如历史回放出来的）
    const settledFirst = reduce(initial, inbound({
      message: {
        messageId: 'msg_history',
        role: 'assistant',
        source: 'outbound',
        text: 'old',
        createdAt: 1
      }
    }));
    // 再来 delta，runId 与 settled 的不同（settled 没 runId 关联）
    const next = reduce(settledFirst, delta({
      runId, turnId, answerId, chunkSeq: 0, delta: 'new', createdAt: 2
    }));
    const items = selectAllItems(next);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'msg_history', streaming: false });
    expect(items[1]).toMatchObject({ streaming: true, text: 'new' });
  });

  test('streaming item carries streaming=true until message.complete arrives', () => {
    const streamingState = reduceAll(createInitialState(conversationId), deltaSeq(['hi ', 'there']));
    const beforeItem = selectAllItems(streamingState)[0];
    if (beforeItem?.kind !== 'assistant_bubble') throw new Error('streaming bubble missing');
    expect(beforeItem.streaming).toBe(true);

    const finalized = reduce(streamingState, complete({
      runId,
      message: {
        messageId: 'msg_final',
        role: 'assistant',
        source: 'outbound',
        text: 'hi there',
        runId,
        createdAt: 999
      }
    }));
    const finalItem = selectAllItems(finalized)[0];
    if (finalItem?.kind !== 'assistant_bubble') throw new Error('finalized bubble missing');
    expect(finalItem.streaming).toBe(false);
    expect(finalItem.id).toBe('msg_final');
    expect(finalItem.text).toBe('hi there');
  });

  test('run completion stops the streaming cursor before message.complete replaces the bubble', () => {
    const streamingState = reduceAll(createInitialState(conversationId), deltaSeq(['hi ', 'there']));
    const stopped = reduce(streamingState, runStatusChange({
      runId,
      status: 'completed',
      createdAt: 998
    }));
    const stoppedItem = selectAllItems(stopped)[0];
    if (stoppedItem?.kind !== 'assistant_bubble') throw new Error('stopped bubble missing');
    expect(stoppedItem.streaming).toBe(false);
    expect(stopped.streamingItemIdByRun.get(runId)).toBe(streamingAssistantItemId(runId, answerId));
    expect(stopped.settledRunIds.has(runId)).toBe(true);

    const finalized = reduce(stopped, complete({
      runId,
      message: {
        messageId: 'msg_final',
        role: 'assistant',
        source: 'outbound',
        text: 'hi there',
        runId,
        createdAt: 999
      }
    }));
    const finalItems = selectAllItems(finalized);
    expect(finalItems).toHaveLength(1);
    const finalItem = finalItems[0];
    if (finalItem?.kind !== 'assistant_bubble') throw new Error('finalized bubble missing');
    expect(finalItem.id).toBe('msg_final');
    expect(finalItem.streaming).toBe(false);
    expect(finalized.streamingItemIdByRun.has(runId)).toBe(false);
  });
});

function sliceIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
