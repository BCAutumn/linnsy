import { describe, expect, test } from 'vitest';

import type { ConversationMessage } from '../../../../lib/daemon-api.js';
import type { RuntimeEventEnvelope } from '@renderer/contracts';
import { hydrateFromMessages, hydrateFromMessagesAndEvents } from '../hydration.js';
import { createInitialState } from '../state.js';
import { reduce } from '../reducer.js';
import { selectAllItems } from '../helpers/selectors.js';

const conversationId = 'conv_history';

describe('projection hydration · ConversationMessage[] → ProjectionState', () => {
  test('hydrates user inbound messages into UserBubble items in createdAt order', () => {
    const messages: ConversationMessage[] = [
      { messageId: 'msg_b', role: 'user', source: 'inbound', text: 'second', createdAt: 200 },
      { messageId: 'msg_a', role: 'user', source: 'inbound', text: 'first', createdAt: 100 }
    ];
    const state = hydrateFromMessages(conversationId, messages);
    const items = selectAllItems(state);
    expect(items.map((it) => it.id)).toEqual(['msg_a', 'msg_b']);
    expect(items.map((it) => it.kind === 'user_bubble' ? it.text : '')).toEqual(['first', 'second']);
  });

  test('hydrates assistant outbound messages into AssistantBubble items, no streaming flag set', () => {
    const messages: ConversationMessage[] = [
      { messageId: 'out_1', role: 'assistant', source: 'outbound', text: 'reply', createdAt: 1 }
    ];
    const state = hydrateFromMessages(conversationId, messages);
    const items = selectAllItems(state);
    expect(items).toHaveLength(1);
    if (items[0]?.kind !== 'assistant_bubble') throw new Error('expected assistant_bubble');
    expect(items[0].streaming).toBe(false);
    expect(items[0].id).toBe('out_1');
  });

  test('preserves message metadata (clientMessageId, etc.) through hydration', () => {
    const messages: ConversationMessage[] = [
      {
        messageId: 'msg_meta',
        role: 'user',
        source: 'inbound',
        text: 'with meta',
        metadata: { clientMessageId: 'local_meta', custom: 'x' },
        createdAt: 1
      }
    ];
    const state = hydrateFromMessages(conversationId, messages);
    const item = state.itemsById.get('msg_meta');
    if (item?.kind !== 'user_bubble') throw new Error('expected user_bubble');
    expect(item.metadata).toMatchObject({ clientMessageId: 'local_meta', custom: 'x' });
    expect(item.clientMessageId).toBe('local_meta');
  });

  test('messages from a different conversationId are skipped when hydrating a single conversation projection', () => {
    const messages: ConversationMessage[] = [
      { messageId: 'msg_keep', conversationId, role: 'user', source: 'inbound', text: 'keep', createdAt: 1 },
      { messageId: 'msg_drop', conversationId: 'conv_other', role: 'user', source: 'inbound', text: 'drop', createdAt: 2 }
    ];
    const state = hydrateFromMessages(conversationId, messages);
    const items = selectAllItems(state);
    expect(items.map((it) => it.id)).toEqual(['msg_keep']);
  });

  test('historical optimistic markers (text starting with local_*) are not preserved as authoritative', () => {
    // 历史 readMessages 不该返回 local_* messageId 的 optimistic 行（daemon 只持久化权威态）。
    // 但 hydration 即使收到也应该和正常消息一样幂等处理 —— 不会因为 messageId 长得像 optimistic 就特殊对待。
    const messages: ConversationMessage[] = [
      { messageId: 'local_99', role: 'user', source: 'inbound', text: 'looks-optimistic', createdAt: 1 }
    ];
    const state = hydrateFromMessages(conversationId, messages);
    const item = state.itemsById.get('local_99');
    if (item?.kind !== 'user_bubble') throw new Error('expected user_bubble');
    expect(item.text).toBe('looks-optimistic');
  });

  test('hydration of an empty message array yields createInitialState() (deep equal)', () => {
    const state = hydrateFromMessages(conversationId, []);
    const baseline = createInitialState(conversationId);
    expect(state).toEqual(baseline);
  });

  test('replays terminal run.status_change so a persisted streaming delta does not resurrect the cursor', () => {
    const events: RuntimeEventEnvelope[] = [
      {
        eventId: 'evt_delta',
        seq: 1,
        kind: 'message.delta',
        createdAt: 1,
        conversationId,
        runId: 'run_1',
        payload: {
          turnId: 'turn_1',
          answerId: 'answer_1',
          chunkSeq: 0,
          delta: '已经结束'
        }
      },
      {
        eventId: 'evt_run_completed',
        seq: 2,
        kind: 'run.status_change',
        createdAt: 2,
        conversationId,
        runId: 'run_1',
        payload: {
          status: 'completed',
          updatedAt: 2
        }
      }
    ];

    const state = hydrateFromMessagesAndEvents(conversationId, [], events);
    const item = selectAllItems(state)[0];
    if (item?.kind !== 'assistant_bubble') throw new Error('expected assistant_bubble');
    expect(item.text).toBe('已经结束');
    expect(item.streaming).toBe(false);
  });

  test('hydration is idempotent: re-applying the events used to build the state is a no-op', () => {
    // 这是 golden-replay 的预演：hydrate 出来的 state 已经 mark 了 hydrate:${messageId} 的 eventId，
    // 所以即使把"历史 → 等价事件"再喂一次给 reduce 也不会重复创建 item。
    const messages: ConversationMessage[] = [
      { messageId: 'msg_h', role: 'user', source: 'inbound', text: 'hi', createdAt: 1 }
    ];
    const state = hydrateFromMessages(conversationId, messages);
    const message = messages[0];
    if (message === undefined) throw new Error('fixture must produce one message');
    const replay = reduce(state, {
      eventId: 'hydrate:msg_h',
      seq: 1,
      kind: 'message.inbound',
      createdAt: 1,
      conversationId,
      messageId: 'msg_h',
      payload: { message: { ...message, conversationId } }
    });
    expect(Object.is(replay, state)).toBe(true);
  });
});
