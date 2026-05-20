import { describe, expect, test, vi } from 'vitest';

import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';

import {
  createHttpWechatGatewayClient,
  createWechatChannelAdapter,
  WECHAT_PLATFORM,
  type WechatGatewayClientPort,
  type WechatGatewayInboundEvent,
  type WechatGatewaySendResult
} from '../wechat-channel-adapter.js';

describe('createWechatChannelAdapter', () => {
  test('polls gateway inbound events and converts them into LinnsyMessage', async () => {
    const gateway = createFakeWechatGatewayClient({
      inboundBatches: [[
        {
          providerMessageId: 'm_1',
          chatId: 'wx_user_1',
          userId: 'wx_user_1',
          text: 'hello',
          receivedAt: 1_234,
          metadata: { source: 'wechat-bot-api-wechat' }
        }
      ]]
    });
    const adapter = createWechatChannelAdapter({
      gateway,
      messageIdFactory: () => 'wx_in_1',
      pollIntervalMs: 1
    });
    const messages: unknown[] = [];

    await adapter.start((message) => {
      messages.push(message);
      return Promise.resolve();
    });
    await gateway.flushPollCycle();

    expect(messages).toEqual([
      {
        messageId: 'wx_in_1',
        platform: WECHAT_PLATFORM,
        chatType: 'private',
        chatId: 'wx_user_1',
        userId: 'wx_user_1',
        providerMessageId: 'm_1',
        text: 'hello',
        receivedAt: 1_234,
        metadata: { source: 'wechat-bot-api-wechat' }
      }
    ]);

    await adapter.stop();
  });

  test('does not start a second poll while the previous long poll is still in flight', async () => {
    const gateway = createFakeWechatGatewayClient();
    const adapter = createWechatChannelAdapter({
      gateway,
      pollIntervalMs: 1
    });

    await adapter.start(async () => {});
    expect(gateway.pollInboundCalls).toBe(1);

    await sleep(10);
    expect(gateway.pollInboundCalls).toBe(1);

    await gateway.flushPollCycle();
    await sleep(10);
    expect(gateway.pollInboundCalls).toBe(2);

    await gateway.flushPollCycle();
    await adapter.stop();
  });

  test('returns deferred delivery when gateway cannot proactively send yet', async () => {
    const gateway = createFakeWechatGatewayClient({
      outboundResult: {
        status: 'deferred',
        deferredReason: 'missing_context_token'
      }
    });
    const adapter = createWechatChannelAdapter({ gateway, pollIntervalMs: 1_000 });

    await adapter.start(async () => {});
    await expect(adapter.send(
      { platform: 'wechat', chatType: 'private', chatId: 'wx_user_1' },
      { text: 'Task finished' }
    )).resolves.toEqual({
      delivery: 'deferred',
      detail: 'missing_context_token'
    });

    expect(gateway.sent).toEqual([
      {
        target: {
          chatId: 'wx_user_1',
          chatType: 'private'
        },
        payload: {
          text: 'Task finished'
        },
        deliveryMode: 'proactive'
      }
    ]);

    await gateway.flushPollCycle();
    await adapter.stop();
  });

  test('backs off and suppresses repeated inbound poll failures while gateway is offline', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const pollInbound = vi.fn()
      .mockRejectedValue(new Error('fetch failed'));
    const gateway: WechatGatewayClientPort = {
      pollInbound,
      send: vi.fn()
        .mockResolvedValue({ status: 'sent' }),
      healthcheck: vi.fn()
        .mockResolvedValue({ ok: false, detail: 'gateway offline' })
    };
    const adapter = createWechatChannelAdapter({
      gateway,
      logger,
      pollIntervalMs: 1
    });

    await adapter.start(async () => {});
    await sleep(25);
    await adapter.stop();

    expect(pollInbound).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'wechat-channel gateway offline; inbound polling is backing off',
      expect.objectContaining({
        platform: WECHAT_PLATFORM,
        error: { message: 'fetch failed' }
      })
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('rejects send before start', async () => {
    const adapter = createWechatChannelAdapter({
      gateway: createFakeWechatGatewayClient(),
      pollIntervalMs: 1_000
    });

    await expect(adapter.send(
      { platform: 'wechat', chatType: 'private', chatId: 'wx_user_1' },
      { text: 'pong' }
    )).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED });
  });
});

describe('createHttpWechatGatewayClient', () => {
  test('polls inbound events with bearer auth', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({
        ok: true,
        events: [
          {
            providerMessageId: 'm_1',
            chatId: 'wx_user_1',
            userId: 'wx_user_1',
            text: 'hello',
            receivedAt: 1_234
          }
        ]
      })));
    const client = createHttpWechatGatewayClient({
      baseUrl: 'http://127.0.0.1:7788',
      bearerToken: 'secret',
      fetch
    });

    await expect(client.pollInbound()).resolves.toEqual({
      events: [
        {
          providerMessageId: 'm_1',
          chatId: 'wx_user_1',
          userId: 'wx_user_1',
          text: 'hello',
          receivedAt: 1_234
        }
      ]
    });

    const firstCall = fetch.mock.calls[0];
    if (firstCall === undefined) {
      throw new Error('expected fetch call');
    }
    const calledUrl = firstCall[0];
    const calledInit = firstCall[1];
    expect(calledUrl).toBe('http://127.0.0.1:7788/v1/inbound/poll');
    expect(calledInit?.method).toBe('GET');
    expect(readHeader(calledInit?.headers, 'Authorization')).toBe('Bearer secret');
  });

  test('posts outbound send requests and returns deferred status details', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({
        ok: true,
        status: 'deferred',
        deferredReason: 'missing_context_token'
      })));
    const client = createHttpWechatGatewayClient({
      baseUrl: 'http://127.0.0.1:7788',
      bearerToken: 'secret',
      fetch
    });

    await expect(client.send({
      target: {
        chatId: 'wx_user_1',
        chatType: 'private'
      },
      payload: {
        text: 'Task finished'
      },
      deliveryMode: 'proactive'
    })).resolves.toEqual({
      status: 'deferred',
      deferredReason: 'missing_context_token'
    });

    const firstCall = fetch.mock.calls[0];
    if (firstCall === undefined) {
      throw new Error('expected fetch call');
    }
    const calledUrl = firstCall[0];
    const calledInit = firstCall[1];
    expect(calledUrl).toBe('http://127.0.0.1:7788/v1/outbound/send');
    expect(calledInit?.method).toBe('POST');
    expect(readHeader(calledInit?.headers, 'Authorization')).toBe('Bearer secret');
    expect(readHeader(calledInit?.headers, 'Content-Type')).toBe('application/json');
    expect(calledInit?.body).toBe(JSON.stringify({
      target: {
        chatId: 'wx_user_1',
        chatType: 'private'
      },
      payload: {
        text: 'Task finished'
      },
      deliveryMode: 'proactive'
    }));
  });
});

function createFakeWechatGatewayClient(options?: {
  inboundBatches?: WechatGatewayInboundEvent[][];
  outboundResult?: WechatGatewaySendResult;
  healthcheckResult?: { ok: boolean; detail?: string };
}): WechatGatewayClientPort & {
  pollInboundCalls: number;
  sent: Array<{
    target: { chatId: string; chatType: 'private' };
    payload: { text?: string; attachments?: unknown[]; hints?: { typingIndicator?: boolean; markdown?: boolean } };
    deliveryMode: 'reply' | 'proactive';
  }>;
  flushPollCycle(): Promise<void>;
} {
  const inboundBatches = [...(options?.inboundBatches ?? [])];
  const sent: Array<{
    target: { chatId: string; chatType: 'private' };
    payload: { text?: string; attachments?: unknown[]; hints?: { typingIndicator?: boolean; markdown?: boolean } };
    deliveryMode: 'reply' | 'proactive';
  }> = [];
  const pendingPolls: Array<{
    resolve: (result: { events: WechatGatewayInboundEvent[] }) => void;
    reject: (error: Error) => void;
  }> = [];
  const outboundResult = options?.outboundResult ?? { status: 'sent' as const };

  return {
    pollInboundCalls: 0,
    sent,
    pollInbound(): Promise<{ events: WechatGatewayInboundEvent[] }> {
      this.pollInboundCalls += 1;
      return new Promise((resolve, reject) => {
        pendingPolls.push({ resolve, reject });
      });
    },
    send(input): Promise<WechatGatewaySendResult> {
      sent.push(input);
      return Promise.resolve(outboundResult);
    },
    healthcheck(): Promise<{ ok: boolean; detail?: string }> {
      return Promise.resolve(options?.healthcheckResult ?? { ok: true });
    },
    async flushPollCycle(): Promise<void> {
      const next = pendingPolls.shift();
      if (next === undefined) {
        throw new Error('no pending poll');
      }
      next.resolve({ events: inboundBatches.shift() ?? [] });
      await Promise.resolve();
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readHeader(headers: HeadersInit | undefined, key: string): string | undefined {
  if (headers === undefined) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(key) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const match = headers.find(([name]) => name.toLowerCase() === key.toLowerCase());
    return match?.[1];
  }
  return headers[key];
}
