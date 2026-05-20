import { afterEach, describe, expect, test, vi } from 'vitest';

import { createRuntimeEventBatcher } from '../runtime-event-batcher.js';
import {
  resetFlushIntervalMs,
  setFlushIntervalMs
} from '../../features/chat/projection/settings.js';
import type { RuntimeClientEvent } from '../daemon-api.js';

describe('createRuntimeEventBatcher · S4.1 delta flush', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetFlushIntervalMs();
  });

  test('buffers consecutive message.delta events and flushes them once per interval', () => {
    vi.useFakeTimers();
    setFlushIntervalMs(33);
    const batches: RuntimeClientEvent[][] = [];
    const batcher = createRuntimeEventBatcher({
      apply(events) {
        batches.push([...events]);
      }
    });

    batcher.push(deltaEvent('evt_delta_1', 0, '你'));
    batcher.push(deltaEvent('evt_delta_2', 1, '好'));
    expect(batches).toEqual([]);

    vi.advanceTimersByTime(32);
    expect(batches).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((event) => event.eventId)).toEqual(['evt_delta_1', 'evt_delta_2']);
  });

  test('non-delta event flushes pending deltas before itself and preserves arrival order', () => {
    vi.useFakeTimers();
    setFlushIntervalMs(33);
    const batches: RuntimeClientEvent[][] = [];
    const batcher = createRuntimeEventBatcher({
      apply(events) {
        batches.push([...events]);
      }
    });

    batcher.push(deltaEvent('evt_delta_1', 0, 'partial'));
    batcher.push(completeEvent('evt_complete'));

    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((event) => event.eventId)).toEqual(['evt_delta_1', 'evt_complete']);

    vi.advanceTimersByTime(33);
    expect(batches).toHaveLength(1);
  });

  test('flush interval 0 applies delta immediately for deterministic tests', () => {
    setFlushIntervalMs(0);
    const batches: RuntimeClientEvent[][] = [];
    const batcher = createRuntimeEventBatcher({
      apply(events) {
        batches.push([...events]);
      }
    });

    batcher.push(deltaEvent('evt_delta_1', 0, 'now'));

    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((event) => event.eventId)).toEqual(['evt_delta_1']);
  });

  test('close cancels pending delta without applying stale events', () => {
    vi.useFakeTimers();
    setFlushIntervalMs(33);
    const batches: RuntimeClientEvent[][] = [];
    const batcher = createRuntimeEventBatcher({
      apply(events) {
        batches.push([...events]);
      }
    });

    batcher.push(deltaEvent('evt_delta_1', 0, 'stale'));
    batcher.close();
    vi.advanceTimersByTime(33);

    expect(batches).toEqual([]);
  });
});

function deltaEvent(eventId: string, chunkSeq: number, delta: string): RuntimeClientEvent {
  return {
    eventId,
    seq: chunkSeq + 1,
    kind: 'message.delta',
    createdAt: chunkSeq + 1,
    conversationId: 'conv_1',
    runId: 'run_1',
    payload: {
      turnId: 'turn_1',
      answerId: 'answer_1',
      chunkSeq,
      delta
    }
  };
}

function completeEvent(eventId: string): RuntimeClientEvent {
  return {
    eventId,
    seq: 100,
    kind: 'message.complete',
    createdAt: 100,
    conversationId: 'conv_1',
    messageId: 'msg_1',
    runId: 'run_1',
    payload: {
      message: {
        messageId: 'msg_1',
        conversationId: 'conv_1',
        role: 'assistant',
        source: 'outbound',
        text: 'final',
        runId: 'run_1',
        createdAt: 100
      }
    }
  };
}
