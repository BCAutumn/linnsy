import {
  describe,
  expect,
  test,
  vi
} from 'vitest';

import {
  FakeCloseableServer,
  createFakeWechatBotApiClient,
  createWechatGatewayRunner,
  inMemoryQueue,
  inMemoryTokenStore
} from './scenarios/hono-app-support.js';

describe('wechat gateway runner', () => {
  test('starts idempotently and stops the listener once', async () => {
    const close = vi.fn((callback: () => void) => {
      callback();
    });
    const serve = vi.fn(() => ({ close }));
    const runner = createWechatGatewayRunner({
      bind: '127.0.0.1:8899',
      bearerToken: 'secret',
      wechatBotApi: createFakeWechatBotApiClient(),
      tokenStore: inMemoryTokenStore(),
      queue: inMemoryQueue(),
      serve
    });

    await runner.start();
    await runner.start();
    await runner.stop();
    await runner.stop();

    expect(serve).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('rejects startup cleanly when the listener cannot bind', async () => {
    const server = new FakeCloseableServer();
    const runner = createWechatGatewayRunner({
      bind: '127.0.0.1:8899',
      bearerToken: 'secret',
      wechatBotApi: createFakeWechatBotApiClient(),
      tokenStore: inMemoryTokenStore(),
      queue: inMemoryQueue(),
      serve: () => server
    });

    const start = runner.start();
    server.emitError(new Error('listen EADDRINUSE: address already in use 127.0.0.1:8899'));

    await expect(start).rejects.toThrow(
      'failed to start wechat gateway on 127.0.0.1:8899: listen EADDRINUSE'
    );
  });

});
