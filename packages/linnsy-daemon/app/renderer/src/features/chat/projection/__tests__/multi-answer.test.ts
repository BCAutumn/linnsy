import { beforeEach, describe, expect, test } from 'vitest';

import { hydrateFromMessagesAndEvents } from '../hydration.js';
import { reduceAll } from '../reducer.js';
import { createInitialState } from '../state.js';
import { selectAllItems } from '../helpers/selectors.js';
import type { EventEnvelope } from '../types.js';
import {
  complete,
  delta,
  inbound,
  resetFixtureCounters,
  toolCallResult,
  toolCallStart
} from './fixtures.js';
import { eventsToMessages } from './replay-helpers.js';

const conversationId = 'conv_test';

describe('projection reducer · S5.3 multi-answer turn', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('keeps two answerId groups separated with tool cards between them', () => {
    const events = multiAnswerEvents();
    const state = reduceAll(createInitialState(conversationId), events);
    const items = selectAllItems(state);

    expect(items.map((item) => item.kind)).toEqual([
      'user_bubble',
      'assistant_bubble',
      'tool_call_card',
      'assistant_bubble'
    ]);

    const firstAnswer = items[1];
    const secondAnswer = items[3];
    if (firstAnswer?.kind !== 'assistant_bubble' || secondAnswer?.kind !== 'assistant_bubble') {
      throw new Error('expected assistant answers around the tool card');
    }
    expect(firstAnswer.answerId).toBe('answer_1');
    expect(firstAnswer.text).toBe('我先查一下');
    expect(firstAnswer.streaming).toBe(false);
    expect(secondAnswer.messageId).toBe('msg_final');
    expect(secondAnswer.text).toBe('查完了，结论是 B');
    expect(secondAnswer.streaming).toBe(false);
  });

  test('hydrates the same multi-answer shape from messages plus persisted delta/tool events', () => {
    const events = multiAnswerEvents();
    const realtimeItems = selectAllItems(reduceAll(createInitialState(conversationId), events));
    const hydratedItems = selectAllItems(
      hydrateFromMessagesAndEvents(conversationId, eventsToMessages(events), events)
    );

    expect(hydratedItems).toEqual(realtimeItems);
  });
});

function multiAnswerEvents(): EventEnvelope[] {
  const runId = 'run_multi';
  return [
    inbound({
      message: {
        messageId: 'msg_user',
        role: 'user',
        source: 'inbound',
        text: '先查再回答',
        createdAt: 1
      }
    }),
    delta({ runId, turnId: 'turn_1', answerId: 'answer_1', chunkSeq: 0, delta: '我先', createdAt: 2 }),
    delta({ runId, turnId: 'turn_1', answerId: 'answer_1', chunkSeq: 1, delta: '查一下', createdAt: 3 }),
    toolCallStart({
      runId,
      toolCallId: 'tool_lookup',
      toolName: 'lookup',
      args: { query: 'B' },
      turnId: 'turn_1',
      startedAt: 4,
      createdAt: 4
    }),
    toolCallResult({
      runId,
      toolCallId: 'tool_lookup',
      toolName: 'lookup',
      status: 'success',
      data: { value: 'B' },
      observation: '"B"',
      endedAt: 5,
      createdAt: 5
    }),
    delta({ runId, turnId: 'turn_1', answerId: 'answer_2', chunkSeq: 0, delta: '查完了，', createdAt: 6 }),
    delta({ runId, turnId: 'turn_1', answerId: 'answer_2', chunkSeq: 1, delta: '结论是 B', createdAt: 7 }),
    complete({
      runId,
      message: {
        messageId: 'msg_final',
        role: 'assistant',
        source: 'outbound',
        text: '查完了，结论是 B',
        runId,
        createdAt: 8
      }
    })
  ];
}
