import {
  describe,
  expect,
  test,
  vi
} from 'vitest';

import {
  createContextTokenStore,
  createFakeWechatBotApiClient,
  createOutboundQueue,
  createTempLinnsyHome,
  createWechatGatewayApp,
  createWechatGatewayStatusTracker,
  join,
  rm
} from './scenarios/hono-app-support.js';

describe('wechat gateway status and account app', () => {
  test('status returns the connected single-account identity and queue summary', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const tokenStore = createContextTokenStore({ stateDir });
      const queue = createOutboundQueue({ stateDir });
      await queue.enqueue({
        deferredId: 'deferred_1',
        chatId: 'wx_user_1',
        text: 'queued hello',
        deliveryMode: 'proactive',
        createdAt: 1_234
      });
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        wechatBotApi: createFakeWechatBotApiClient(),
        tokenStore,
        queue,
        account: {
          accountId: 'wx_account_1',
          userId: 'wx_user_1',
          botToken: 'bot_token_1',
          baseUrl: 'https://ilinkai.weixin.qq.com',
          connectedAt: 1_234
        },
        connectionSource: 'fresh_qr'
      });

      const response = await app.request('/v1/status', {
        method: 'GET',
        headers: { Authorization: 'Bearer secret' }
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        account: {
          accountId: 'wx_account_1',
          userId: 'wx_user_1',
          baseUrl: 'https://ilinkai.weixin.qq.com',
          connectedAt: 1_234,
          source: 'fresh_qr'
        },
        connection: {
          state: 'connected'
        },
        outbound: {
          deferredReadyCount: 1,
          deferredClaimedCount: 0
        }
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('status exposes QR login state before the account is connected', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const tokenStore = createContextTokenStore({ stateDir });
      const queue = createOutboundQueue({ stateDir });
      const status = createWechatGatewayStatusTracker({ queue });
      status.recordGatewayStarting(100);
      status.recordQrIssued(200, 'https://example.com/wechat-qr', 320);
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        tokenStore,
        queue,
        status
      });

      const response = await app.request('/v1/status', {
        method: 'GET',
        headers: { Authorization: 'Bearer secret' }
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        account: null,
        connection: {
          state: 'awaiting_qr_scan',
          startedAt: 100,
          qrLoginUrl: 'https://example.com/wechat-qr',
          qrLoginIssuedAt: 200,
          qrLoginExpiresAt: 320
        },
        outbound: {
          deferredReadyCount: 0,
          deferredClaimedCount: 0
        }
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('delete account delegates to the runtime without creating a QR login', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const tokenStore = createContextTokenStore({ stateDir });
      const queue = createOutboundQueue({ stateDir });
      const deleteAccount = vi.fn(() => Promise.resolve({
        ok: false,
        account: null,
        connection: {
          state: 'not_connected' as const,
          startedAt: 100
        },
        outbound: {
          deferredReadyCount: 0,
          deferredClaimedCount: 0
        }
      }));
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        tokenStore,
        queue,
        runtime: {
          getWechatBotApi: () => null,
          deleteAccount,
          requestFreshQrLogin: vi.fn()
        }
      });

      const response = await app.request('/v1/account', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer secret' }
      });

      expect(response.status).toBe(200);
      expect(deleteAccount).toHaveBeenCalledTimes(1);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        account: null,
        connection: {
          state: 'not_connected',
          startedAt: 100
        },
        outbound: {
          deferredReadyCount: 0,
          deferredClaimedCount: 0
        }
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('QR login show delegates to the runtime and returns the fresh QR snapshot', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const tokenStore = createContextTokenStore({ stateDir });
      const queue = createOutboundQueue({ stateDir });
      const requestFreshQrLogin = vi.fn(() => Promise.resolve({
        ok: true,
        account: null,
        connection: {
          state: 'awaiting_qr_scan' as const,
          startedAt: 100,
          qrLoginUrl: 'https://example.com/wechat-qr',
          qrLoginIssuedAt: 200,
          qrLoginExpiresAt: 320
        },
        outbound: {
          deferredReadyCount: 0,
          deferredClaimedCount: 0
        }
      }));
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        tokenStore,
        queue,
        runtime: {
          getWechatBotApi: () => null,
          deleteAccount: vi.fn(),
          requestFreshQrLogin
        }
      });

      const response = await app.request('/v1/qr-login/show', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret' }
      });

      expect(response.status).toBe(200);
      expect(requestFreshQrLogin).toHaveBeenCalledTimes(1);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        account: null,
        connection: {
          state: 'awaiting_qr_scan',
          startedAt: 100,
          qrLoginUrl: 'https://example.com/wechat-qr',
          qrLoginIssuedAt: 200,
          qrLoginExpiresAt: 320
        },
        outbound: {
          deferredReadyCount: 0,
          deferredClaimedCount: 0
        }
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('status keeps connected and records poll success after a successful inbound poll', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const tokenStore = createContextTokenStore({ stateDir });
      const queue = createOutboundQueue({ stateDir });
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        wechatBotApi: createFakeWechatBotApiClient({
          updates: [
            {
              providerMessageId: 'msg_private_1',
              fromUserId: 'wx_user_1',
              toUserId: 'wx_bot',
              messageType: 'user',
              text: 'hello linnsy',
              receivedAt: 2_222,
              contextToken: 'ctx_latest'
            }
          ]
        }),
        tokenStore,
        queue,
        account: {
          accountId: 'wx_account_1',
          userId: 'wx_user_1',
          botToken: 'bot_token_1',
          baseUrl: 'https://ilinkai.weixin.qq.com',
          connectedAt: 1_234
        },
        connectionSource: 'saved_account',
        now: () => 9_999
      });

      await app.request('/v1/inbound/poll', {
        method: 'GET',
        headers: { Authorization: 'Bearer secret' }
      });

      const response = await app.request('/v1/status', {
        method: 'GET',
        headers: { Authorization: 'Bearer secret' }
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        account: {
          accountId: 'wx_account_1',
          userId: 'wx_user_1',
          baseUrl: 'https://ilinkai.weixin.qq.com',
          connectedAt: 1_234,
          source: 'saved_account'
        },
        connection: {
          state: 'connected',
          lastPollSucceededAt: 9_999
        },
        outbound: {
          deferredReadyCount: 0,
          deferredClaimedCount: 0
        }
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

});
