import { describe, expect, test } from 'vitest';

import type { RuntimeClientEvent } from '../daemon-api.js';
import {
  buildRuntimeEventStreamUrl,
  createRuntimeEventStreamCursor
} from '../runtime-event-stream-cursor.js';
import { reduceAll } from '../../features/chat/projection/reducer.js';
import { createInitialState } from '../../features/chat/projection/state.js';
import { selectAllItems } from '../../features/chat/projection/helpers/selectors.js';

describe('runtime event stream cursor', () => {
  test('builds reconnect URLs from the largest seen event seq', () => {
    const cursor = createRuntimeEventStreamCursor();
    expect(cursor.toStreamUrl('http://127.0.0.1:4173')).toBe('ws://127.0.0.1:4173/api/v1/stream');

    cursor.markSeen(eventEnvelope({ seq: 5, eventId: 'evt_5', kind: 'system.event' }));
    cursor.markSeen(eventEnvelope({ seq: 3, eventId: 'evt_3', kind: 'system.event' }));

    expect(cursor.toStreamUrl('http://127.0.0.1:4173')).toBe('ws://127.0.0.1:4173/api/v1/stream?since=5');
    expect(buildRuntimeEventStreamUrl('https://linnsy.local', 5)).toBe('wss://linnsy.local/api/v1/stream?since=5');

    cursor.reset();
    expect(cursor.toStreamUrl('http://127.0.0.1:4173')).toBe('ws://127.0.0.1:4173/api/v1/stream');
  });

  test('reconnect backfill plus live events reduces to the same projection as an uninterrupted stream', () => {
    const allEvents = createConversationEvents();
    const cursor = createRuntimeEventStreamCursor();
    const beforeDisconnect = allEvents.slice(0, 2);
    for (const event of beforeDisconnect) {
      cursor.markSeen(event);
    }
    expect(cursor.toStreamUrl('http://127.0.0.1:4173')).toContain('since=2');

    const backfilled = allEvents.filter((event) => event.seq > 2 && event.seq <= 7);
    for (const event of backfilled) {
      cursor.markSeen(event);
    }
    expect(cursor.toStreamUrl('http://127.0.0.1:4173')).toContain('since=7');

    const liveAfterReconnect = allEvents.filter((event) => event.seq > 7);
    const uninterrupted = reduceAll(createInitialState('conv_1'), allEvents);
    const reconnected = reduceAll(
      createInitialState('conv_1'),
      [...beforeDisconnect, ...backfilled, ...liveAfterReconnect]
    );

    expect(selectAllItems(reconnected)).toEqual(selectAllItems(uninterrupted));
    const assistant = selectAllItems(reconnected).find((item) => item.kind === 'assistant_bubble');
    expect(assistant).toMatchObject({ streaming: false });
  });
});

function createConversationEvents(): RuntimeClientEvent[] {
  return [
    eventEnvelope({
      seq: 1,
      eventId: 'evt_user',
      kind: 'message.inbound',
      payload: {
        message: {
          messageId: 'msg_user',
          conversationId: 'conv_1',
          role: 'user',
          source: 'inbound',
          text: '开始',
          createdAt: 1
        }
      },
      messageId: 'msg_user'
    }),
    eventEnvelope({ seq: 2, eventId: 'evt_delta_1', kind: 'message.delta', runId: 'run_1', payload: deltaPayload(0, '你') }),
    eventEnvelope({ seq: 3, eventId: 'evt_delta_2', kind: 'message.delta', runId: 'run_1', payload: deltaPayload(1, '好') }),
    eventEnvelope({
      seq: 4,
      eventId: 'evt_tool_start',
      kind: 'tool_call.start',
      runId: 'run_1',
      payload: {
        toolCallId: 'tool_1',
        toolName: 'list_tasks',
        args: {},
        startedAt: 4
      }
    }),
    eventEnvelope({ seq: 5, eventId: 'evt_delta_3', kind: 'message.delta', runId: 'run_1', payload: deltaPayload(2, '呀') }),
    eventEnvelope({
      seq: 6,
      eventId: 'evt_tool_result',
      kind: 'tool_call.result',
      runId: 'run_1',
      payload: {
        toolCallId: 'tool_1',
        toolName: 'list_tasks',
        status: 'success',
        data: { items: [] },
        observation: '[]',
        durationMs: 2,
        endedAt: 6
      }
    }),
    eventEnvelope({
      seq: 7,
      eventId: 'evt_system',
      kind: 'system.event',
      payload: {
        sourceKind: 'task_status_change',
        detail: '任务节点完成',
        refId: 'task_1',
        occurredAt: 7
      }
    }),
    eventEnvelope({
      seq: 8,
      eventId: 'evt_run_completed',
      kind: 'run.status_change',
      runId: 'run_1',
      payload: {
        status: 'completed',
        updatedAt: 8
      }
    }),
    eventEnvelope({
      seq: 9,
      eventId: 'evt_complete',
      kind: 'message.complete',
      runId: 'run_1',
      messageId: 'msg_assistant',
      payload: {
        message: {
          messageId: 'msg_assistant',
          conversationId: 'conv_1',
          role: 'assistant',
          source: 'outbound',
          text: '你好呀',
          runId: 'run_1',
          createdAt: 9
        }
      }
    }),
    eventEnvelope({
      seq: 10,
      eventId: 'evt_subagent',
      kind: 'subagent.summary',
      runId: 'run_1',
      payload: {
        taskId: 'task_1',
        childRunId: 'child_run_1',
        childConversationId: 'child_conv_1',
        summary: '子任务完成'
      }
    }),
    eventEnvelope({
      seq: 11,
      eventId: 'evt_channel',
      kind: 'system.event',
      payload: {
        sourceKind: 'channel_status',
        detail: '微信已恢复连接',
        refId: 'wechat',
        occurredAt: 10
      }
    })
  ];
}

function deltaPayload(chunkSeq: number, delta: string): Record<string, unknown> {
  return {
    turnId: 'turn_1',
    answerId: 'answer_1',
    chunkSeq,
    delta
  };
}

function eventEnvelope(input: {
  seq: number;
  eventId: string;
  kind: RuntimeClientEvent['kind'];
  payload?: Record<string, unknown>;
  messageId?: string;
  runId?: string;
}): RuntimeClientEvent {
  return {
    eventId: input.eventId,
    seq: input.seq,
    kind: input.kind,
    createdAt: input.seq,
    conversationId: 'conv_1',
    payload: input.payload ?? {
      sourceKind: 'cron',
      detail: '默认系统事件',
      occurredAt: input.seq
    },
    ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
    ...(input.runId === undefined ? {} : { runId: input.runId })
  };
}
