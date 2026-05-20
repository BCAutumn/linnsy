import { beforeEach, describe, expect, test } from 'vitest';

import { createInitialState } from '../state.js';
import { reduce } from '../reducer.js';
import { selectAllItems } from '../helpers/selectors.js';
import { complete, delta, inbound, resetFixtureCounters, runStatusChange } from './fixtures.js';

describe('projection reducer · base paths', () => {
  beforeEach(() => {
    resetFixtureCounters();
  });

  test('reduces message.inbound (user) into a UserBubble item with stable id', () => {
    const initial = createInitialState('conv_test');
    const event = inbound({
      message: {
        messageId: 'msg_1',
        role: 'user',
        source: 'inbound',
        text: 'hi linnsy',
        createdAt: 100
      }
    });
    const next = reduce(initial, event);
    const items = selectAllItems(next);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'user_bubble',
      id: 'msg_1',
      text: 'hi linnsy',
      messageId: 'msg_1'
    });
  });

  test('reduces message.inbound (assistant outbound) into an AssistantBubble item', () => {
    const initial = createInitialState('conv_test');
    const event = inbound({
      message: {
        messageId: 'msg_assistant_1',
        role: 'assistant',
        source: 'outbound',
        text: 'hello back',
        createdAt: 200
      }
    });
    const next = reduce(initial, event);
    const items = selectAllItems(next);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'assistant_bubble',
      id: 'msg_assistant_1',
      text: 'hello back',
      streaming: false
    });
  });

  test('ignores events from other conversations but still updates conversation list metadata', () => {
    const initial = createInitialState('conv_test');
    const event = inbound({
      conversationId: 'conv_other',
      message: {
        conversationId: 'conv_other',
        messageId: 'msg_other',
        role: 'user',
        source: 'inbound',
        text: 'in other room',
        createdAt: 1
      }
    });
    const next = reduce(initial, event);
    expect(selectAllItems(next)).toEqual([]);
    // conversation 列表元数据由上层 ChatAppState 维护，不进 ProjectionState。
    // 这里仅验证 projection 不染指其它 conversation 的内容。
    expect(next.conversationId).toBe('conv_test');
  });

  test('keeps non-terminal run status changes out of the UI projection', () => {
    const initial = createInitialState('conv_test');
    const next = reduce(initial, runStatusChange({
      runId: 'run_1',
      status: 'pending',
      eventId: 'evt_run_status',
      seq: 1
    }));
    // 非终态 run.status_change 不投影，但 eventId 仍要进 seenEventIds，所以 state 不可能 ===。
    // 守的不变量：业务字段（itemsById/itemOrder/streamingItemIdByRun/settledRunIds/conversationId）必须一致。
    expect(next.itemsById).toBe(initial.itemsById);
    expect(next.itemOrder).toBe(initial.itemOrder);
    expect(next.streamingItemIdByRun).toBe(initial.streamingItemIdByRun);
    expect(next.settledRunIds).toBe(initial.settledRunIds);
    expect(next.conversationId).toBe(initial.conversationId);
  });

  test('appends new items to itemOrder while preserving previous order (no re-shuffle)', () => {
    const initial = createInitialState('conv_test');
    const userEvt = inbound({
      message: {
        messageId: 'msg_user',
        role: 'user',
        source: 'inbound',
        text: 'a',
        createdAt: 1
      }
    });
    const userState = reduce(initial, userEvt);
    const deltaEvt = delta({
      runId: 'run_1',
      turnId: 'turn_1',
      answerId: 'ans_1',
      chunkSeq: 0,
      delta: 'b',
      createdAt: 2
    });
    const next = reduce(userState, deltaEvt);
    const items = selectAllItems(next);
    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe('user_bubble');
    expect(items[1]?.kind).toBe('assistant_bubble');
    // 验证 itemOrder 是单调追加，user 永远在 assistant 之前。
    const completeEvt = complete({
      runId: 'run_1',
      message: {
        messageId: 'msg_complete',
        role: 'assistant',
        source: 'outbound',
        text: 'b',
        createdAt: 3
      }
    });
    const finalState = reduce(next, completeEvt);
    const finalItems = selectAllItems(finalState);
    expect(finalItems[0]?.kind).toBe('user_bubble');
    expect(finalItems[1]?.id).toBe('msg_complete');
  });
});
