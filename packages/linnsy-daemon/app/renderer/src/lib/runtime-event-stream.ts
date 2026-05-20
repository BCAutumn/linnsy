import {
  runtimeEventEnvelopeSchema,
  type RuntimeEventEnvelope as RuntimeClientEvent,
  type RuntimeEventKind
} from '@renderer/contracts';

import { createRuntimeEventStreamCursor } from './runtime-event-stream-cursor.js';

export type { RuntimeClientEvent, RuntimeEventKind };

export interface RuntimeEventStreamReady {
  bootInstanceId: string;
}

export interface RuntimeEventStreamHandlers {
  onBackfill?(events: readonly RuntimeClientEvent[]): void;
  onBootInstanceChanged?(ready: RuntimeEventStreamReady): void;
  onReady?(ready: RuntimeEventStreamReady): void;
  onEvent(event: RuntimeClientEvent): void;
  onError?(error: unknown): void;
}

export interface RuntimeEventStream {
  close(): void;
}

export function openRuntimeEventStream(input: {
  baseUrl: string;
  bearerToken: string;
  handlers: RuntimeEventStreamHandlers;
}): RuntimeEventStream {
  let socket: WebSocket | null = null;
  let closed = false;
  let retryTimer: number | null = null;
  let currentBootInstanceId: string | null = null;
  const cursor = createRuntimeEventStreamCursor();

  function connect(): void {
    if (closed) return;
    socket = new WebSocket(cursor.toStreamUrl(input.baseUrl));
    let ready = false;
    let backfillEvents: RuntimeClientEvent[] = [];
    socket.addEventListener('open', () => {
      socket?.send(JSON.stringify({ type: 'auth', token: input.bearerToken }));
    });
    socket.addEventListener('message', (event) => {
      const frame = parseStreamFrame(event.data);
      if (frame === null) {
        return;
      }
      if (frame.type === 'ready') {
        ready = true;
        const bootChanged = currentBootInstanceId !== null && currentBootInstanceId !== frame.bootInstanceId;
        currentBootInstanceId = frame.bootInstanceId;
        if (bootChanged) {
          // daemon 重启后旧 seq 属于上一轮内存事件表，继续使用会误判缺失范围。
          cursor.reset();
          backfillEvents = [];
          if (input.handlers.onBootInstanceChanged === undefined) {
            input.handlers.onReady?.({ bootInstanceId: frame.bootInstanceId });
          } else {
            input.handlers.onBootInstanceChanged({ bootInstanceId: frame.bootInstanceId });
          }
          return;
        }
        if (backfillEvents.length > 0) {
          const events = backfillEvents;
          backfillEvents = [];
          if (input.handlers.onBackfill === undefined) {
            for (const backfillEvent of events) {
              input.handlers.onEvent(backfillEvent);
            }
          } else {
            input.handlers.onBackfill(events);
          }
        }
        input.handlers.onReady?.({ bootInstanceId: frame.bootInstanceId });
        return;
      }
      cursor.markSeen(frame.event);
      if (!ready) {
        backfillEvents.push(frame.event);
        return;
      }
      input.handlers.onEvent(frame.event);
    });
    socket.addEventListener('error', (event) => {
      input.handlers.onError?.(event);
    });
    socket.addEventListener('close', () => {
      socket = null;
      if (!closed) {
        retryTimer = window.setTimeout(connect, 1000);
      }
    });
  }

  connect();

  return {
    close() {
      closed = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      socket?.close();
      socket = null;
    }
  };
}

type StreamFrame =
  | { type: 'ready'; bootInstanceId: string }
  | { type: 'event'; event: RuntimeClientEvent };

function parseStreamFrame(data: unknown): StreamFrame | null {
  if (typeof data !== 'string') {
    return null;
  }
  const parsed = parseJsonObject(data);
  if (parsed === null) {
    return null;
  }
  if (parsed.type === 'ready' && typeof parsed.bootInstanceId === 'string') {
    return { type: 'ready', bootInstanceId: parsed.bootInstanceId };
  }
  if (parsed.type === 'event') {
    const eventResult = runtimeEventEnvelopeSchema.safeParse(parsed.event);
    if (eventResult.success) {
      return { type: 'event', event: eventResult.data };
    }
  }
  return null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
