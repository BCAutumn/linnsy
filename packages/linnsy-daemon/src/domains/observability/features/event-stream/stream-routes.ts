import { randomUUID } from 'node:crypto';

import { upgradeWebSocket } from '@hono/node-server';
import { Hono } from 'hono';

import type {
  RuntimeEventHubPort,
  RuntimeEventPollItem
} from '../event-hub/event-hub.js';

export interface CreateStreamRoutesOptions {
  bearerToken: string;
  bootInstanceId?: string;
  events: RuntimeEventHubPort;
  isAllowedOrigin(origin: string): boolean;
}

type StreamServerFrame =
  | { type: 'ready'; bootInstanceId: string }
  | { type: 'event'; event: RuntimeEventPollItem }
  | { type: 'error'; code: string };

interface AttachRuntimeEventStreamOptions {
  bootInstanceId: string;
  events: RuntimeEventHubPort;
  since?: string;
  sendFrame(frame: StreamServerFrame): void;
}

export function createStreamRoutes(options: CreateStreamRoutesOptions): Hono {
  const app = new Hono();
  const bootInstanceId = options.bootInstanceId ?? randomUUID();

  app.get('/api/v1/stream', upgradeWebSocket((context) => {
    const origin = context.req.header('origin') ?? 'null';
    const allowedOrigin = options.isAllowedOrigin(origin);
    let authenticated = false;
    let unsubscribe: (() => void) | null = null;

    return {
      onOpen(_event, ws) {
        if (!allowedOrigin) {
          ws.close(1008, 'origin not allowed');
        }
      },

      onMessage(event, ws) {
        if (!allowedOrigin) {
          ws.close(1008, 'origin not allowed');
          return;
        }
        if (authenticated) {
          return;
        }
        const frame = parseClientFrame(event.data);
        if (frame?.type !== 'auth' || frame.token !== options.bearerToken) {
          sendFrame(ws, { type: 'error', code: 'HTTP_BEARER_REQUIRED' });
          ws.close(1008, 'unauthorized');
          return;
        }
        authenticated = true;
        const since = context.req.query('since');
        unsubscribe = attachRuntimeEventStream({
          bootInstanceId,
          events: options.events,
          ...(since === undefined ? {} : { since }),
          sendFrame: (frameToSend) => {
            sendFrame(ws, frameToSend);
          }
        });
      },

      onClose() {
        unsubscribe?.();
        unsubscribe = null;
      },

      onError() {
        unsubscribe?.();
        unsubscribe = null;
      }
    };
  }));

  return app;
}

export function attachRuntimeEventStream(options: AttachRuntimeEventStreamOptions): () => void {
  let replayedSeq = parseCursor(options.since);
  const pendingLiveEvents: RuntimeEventPollItem[] = [];
  let replaying = true;

  const unsubscribe = options.events.subscribe((runtimeEvent) => {
    if (runtimeEvent.seq <= replayedSeq) {
      return;
    }
    if (replaying) {
      pendingLiveEvents.push(runtimeEvent);
      return;
    }
    options.sendFrame({ type: 'event', event: runtimeEvent });
  });

  if (options.since !== undefined) {
    let cursor = options.since;
    for (;;) {
      const page = options.events.poll({ since: cursor });
      if (page.events.length === 0) {
        break;
      }
      for (const event of page.events) {
        options.sendFrame({ type: 'event', event });
        replayedSeq = Math.max(replayedSeq, event.seq);
      }
      if (page.nextCursor === undefined) {
        break;
      }
      cursor = page.nextCursor;
    }
  }

  replaying = false;
  for (const event of pendingLiveEvents) {
    if (event.seq > replayedSeq) {
      options.sendFrame({ type: 'event', event });
      replayedSeq = Math.max(replayedSeq, event.seq);
    }
  }

  options.sendFrame({ type: 'ready', bootInstanceId: options.bootInstanceId });
  return unsubscribe;
}

function sendFrame(ws: { send(data: string): void }, frame: StreamServerFrame): void {
  ws.send(JSON.stringify(frame));
}

function parseClientFrame(data: unknown): { type: 'auth'; token: string } | null {
  if (typeof data !== 'string') {
    return null;
  }
  const parsed = parseJsonObject(data);
  if (parsed === null) {
    return null;
  }
  if (parsed.type === 'auth' && typeof parsed.token === 'string') {
    return { type: 'auth', token: parsed.token };
  }
  return null;
}

function parseCursor(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
