import { describe, expect, test } from 'vitest';

import type {
  MessageDeltaPayload,
  MessageInboundPayload,
  RuntimeEvent
} from '../../../definitions/runtime-events.js';
import {
  createRuntimeEventHub,
  type RuntimeEventHubPort,
  type RuntimeEventListener,
  type RuntimeEventPollItem
} from '../../event-hub/event-hub.js';
import { attachRuntimeEventStream } from '../stream-routes.js';

type CapturedFrame =
  | { type: 'ready'; bootInstanceId: string }
  | { type: 'event'; event: RuntimeEventPollItem }
  | { type: 'error'; code: string };

describe('runtime stream routes', () => {
  test('backfills events after the reconnect cursor before sending ready', () => {
    let nextId = 1;
    const hub = createRuntimeEventHub({
      idFactory: () => `evt_${String(nextId++)}`
    });
    hub.publish({ kind: 'message.inbound', conversationId: 'conv_1', payload: messagePayload('msg_1', 'hi') });
    hub.publish({ kind: 'message.delta', conversationId: 'conv_1', runId: 'run_1', payload: deltaPayload(0, '你') });
    hub.publish({ kind: 'message.delta', conversationId: 'conv_1', runId: 'run_1', payload: deltaPayload(1, '好') });

    const frames: CapturedFrame[] = [];
    const detach = attachRuntimeEventStream({
      bootInstanceId: 'boot_test',
      events: hub,
      since: '1',
      sendFrame(frame) {
        frames.push(frame);
      }
    });

    expect(frames.map(frameLabel)).toEqual(['event:2', 'event:3', 'ready:boot_test']);

    hub.publish({ kind: 'message.delta', conversationId: 'conv_1', runId: 'run_1', payload: deltaPayload(2, '呀') });
    expect(frames.map(frameLabel)).toEqual(['event:2', 'event:3', 'ready:boot_test', 'event:4']);

    detach();
    hub.publish({ kind: 'message.delta', conversationId: 'conv_1', runId: 'run_1', payload: deltaPayload(3, '!') });
    expect(frames.map(frameLabel)).toEqual(['event:2', 'event:3', 'ready:boot_test', 'event:4']);
  });

  test('does not replay the ring buffer when no reconnect cursor is provided', () => {
    const hub = createRuntimeEventHub();
    hub.publish({ kind: 'message.inbound', conversationId: 'conv_1', payload: messagePayload('msg_1', 'hi') });

    const frames: CapturedFrame[] = [];
    attachRuntimeEventStream({
      bootInstanceId: 'boot_empty',
      events: hub,
      sendFrame(frame) {
        frames.push(frame);
      }
    });

    expect(frames.map(frameLabel)).toEqual(['ready:boot_empty']);
  });

  test('reconnect backfill reads persisted history beyond the ring buffer window', () => {
    let nextId = 1;
    const history: RuntimeEvent[] = [];
    const hub = createRuntimeEventHub({
      maxEvents: 1,
      idFactory: () => `evt_${String(nextId++)}`,
      persistence: {
        append(event) {
          history.push(event);
        }
      },
      history: {
        list(options = {}) {
          const sinceSeq = options.sinceSeq ?? 0;
          const limit = options.limit ?? 500;
          const events = history.filter((event) => event.seq > sinceSeq).slice(0, limit);
          const last = events.at(-1);
          return {
            events,
            ...(last === undefined ? {} : { nextCursor: String(last.seq) })
          };
        }
      }
    });
    hub.publish({ kind: 'message.inbound', conversationId: 'conv_1', payload: messagePayload('msg_1', 'hi') });
    hub.publish({ kind: 'message.delta', conversationId: 'conv_1', runId: 'run_1', payload: deltaPayload(0, '你') });
    hub.publish({ kind: 'message.delta', conversationId: 'conv_1', runId: 'run_1', payload: deltaPayload(1, '好') });

    const frames: CapturedFrame[] = [];
    attachRuntimeEventStream({
      bootInstanceId: 'boot_history',
      events: hub,
      since: '1',
      sendFrame(frame) {
        frames.push(frame);
      }
    });

    expect(frames.map(frameLabel)).toEqual(['event:2', 'event:3', 'ready:boot_history']);
  });

  test('does not duplicate a replayed event if it is also observed by the live subscriber', () => {
    const replayedEvent = runtimeEvent(2);
    const hub: RuntimeEventHubPort = {
      publish() {
        return replayedEvent;
      },
      poll(options) {
        return options?.since === '1'
          ? { events: [replayedEvent], nextCursor: '2' }
          : { events: [] };
      },
      subscribe(listener) {
        listener(replayedEvent);
        return () => {};
      }
    };
    const frames: CapturedFrame[] = [];

    attachRuntimeEventStream({
      bootInstanceId: 'boot_dedupe',
      events: hub,
      since: '1',
      sendFrame(frame) {
        frames.push(frame);
      }
    });

    expect(frames.map(frameLabel)).toEqual(['event:2', 'ready:boot_dedupe']);
  });

  test('buffers live events that arrive while reconnect history is replaying', () => {
    const replayedEvent = runtimeEvent(2);
    const liveEvent = runtimeEvent(3);
    let listener: RuntimeEventListener | undefined;
    const hub: RuntimeEventHubPort = {
      publish() {
        return liveEvent;
      },
      poll(options) {
        if (options?.since === '2') {
          return { events: [] };
        }
        listener?.(liveEvent);
        return { events: [replayedEvent], nextCursor: '2' };
      },
      subscribe(nextListener) {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      }
    };
    const frames: CapturedFrame[] = [];

    attachRuntimeEventStream({
      bootInstanceId: 'boot_buffered',
      events: hub,
      since: '1',
      sendFrame(frame) {
        frames.push(frame);
      }
    });

    expect(frames.map(frameLabel)).toEqual(['event:2', 'event:3', 'ready:boot_buffered']);
  });
});

function frameLabel(frame: CapturedFrame): string {
  if (frame.type === 'event') {
    return `event:${String(frame.event.seq)}`;
  }
  if (frame.type === 'ready') {
    return `ready:${frame.bootInstanceId}`;
  }
  return `error:${frame.code}`;
}

function messagePayload(messageId: string, text: string): MessageInboundPayload {
  return {
    message: {
      messageId,
      conversationId: 'conv_1',
      role: 'user',
      source: 'inbound',
      text,
      createdAt: 1
    }
  };
}

function deltaPayload(chunkSeq: number, delta: string): MessageDeltaPayload {
  return {
    turnId: 'turn_1',
    answerId: 'answer_1',
    chunkSeq,
    delta
  };
}

function runtimeEvent(seq: number): RuntimeEvent {
  return {
    eventId: `evt_${String(seq)}`,
    seq,
    kind: 'message.delta',
    conversationId: 'conv_1',
    runId: 'run_1',
    createdAt: seq,
    payload: deltaPayload(seq, 'x')
  };
}
