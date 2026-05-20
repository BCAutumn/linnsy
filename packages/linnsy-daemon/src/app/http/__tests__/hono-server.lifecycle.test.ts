import {
  describe,
  expect,
  test,
  vi
} from 'vitest';

import { createHonoHttpServer, createRuntimeEventHub, taskTracker } from './scenarios/hono-server-support.js';
import type { ServeFunction } from './scenarios/hono-server-support.js';

describe('Hono HTTP server lifecycle', () => {
  test('starts idempotently and stops the listener once', async () => {
    const close = vi.fn((callback: () => void) => {
      callback();
    });
    const serve = vi.fn(() => ({ close }));
    const server = createHonoHttpServer({
      bind: '127.0.0.1:7878',
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      serve
    });

    await server.start();
    await server.start();
    await server.stop();
    await server.stop();

    expect(serve).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('passes a websocket server to the node adapter when runtime events are enabled', async () => {
    const serve = vi.fn<ServeFunction>(() => ({ close: vi.fn() }));
    const server = createHonoHttpServer({
      bind: '127.0.0.1:7878',
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      events: createRuntimeEventHub(),
      serve
    });

    await server.start();

    const serveOptions = serve.mock.calls[0]?.[0];
    expect(serveOptions?.websocket?.server).toBeDefined();
  });

});
