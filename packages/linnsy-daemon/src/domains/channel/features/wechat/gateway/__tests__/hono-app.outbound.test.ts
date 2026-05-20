import { describe, expect, test } from 'vitest';

import {
  createContextTokenStore,
  createFakeWechatBotApiClient,
  createOutboundQueue,
  createTempLinnsyHome,
  createWechatGatewayApp,
  isStatusWithErrorTimestamp,
  join,
  rm
} from './scenarios/hono-app-support.js';

describe('wechat gateway outbound and poll app', () => {
  test('outbound send returns deferred when no token exists for proactive delivery', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const tokenStore = createContextTokenStore({ stateDir });
      const queue = createOutboundQueue({ stateDir });
      const wechatBotApi = createFakeWechatBotApiClient();
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        wechatBotApi,
        tokenStore,
        queue,
        now: () => 1_234,
        deferredIdFactory: () => 'deferred_auto_1'
      });

      const response = await app.request('/v1/outbound/send', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          target: { chatId: 'wx_user_1', chatType: 'private' },
          payload: { text: 'hello later' },
          deliveryMode: 'proactive'
        })
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        status: 'deferred',
        deferredReason: 'missing_context_token'
      });
      expect(wechatBotApi.sendCalls).toEqual([]);
      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([
        {
          deferredId: 'deferred_auto_1',
          chatId: 'wx_user_1',
          text: 'hello later',
          deliveryMode: 'proactive',
          createdAt: 1_234
        }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('inbound poll returns normalized messages, stores latest token, and flushes deferred queue with markDelivered', async () => {
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
        createdAt: 1_000
      });
      await queue.enqueue({
        deferredId: 'deferred_2',
        chatId: 'wx_user_1',
        text: 'queued follow-up',
        deliveryMode: 'proactive',
        createdAt: 1_100
      });

      const wechatBotApi = createFakeWechatBotApiClient({
        updates: [
          {
            providerMessageId: 'msg_out_1',
            fromUserId: 'wx_bot',
            toUserId: 'wx_user_1',
            messageType: 'bot',
            text: 'echo from bot',
            receivedAt: 2_000,
            metadata: { rawKind: 'self' }
          },
          {
            providerMessageId: 'msg_group_1',
            fromUserId: 'wx_user_2',
            toUserId: 'wx_bot',
            messageType: 'user',
            receivedAt: 2_100,
            metadata: {
              itemTypes: [2]
            }
          },
          {
            providerMessageId: 'msg_private_1',
            fromUserId: 'wx_user_1',
            toUserId: 'wx_bot',
            messageType: 'user',
            text: 'hello linnsy',
            receivedAt: 2_222,
            contextToken: 'ctx_latest',
            metadata: {
              source: 'wechat-bot-api-test'
            }
          }
        ]
      });
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        wechatBotApi,
        tokenStore,
        queue,
        account: {
          accountId: 'wx_account_1',
          userId: 'wx_user_1',
          botToken: 'bot_token_1',
          baseUrl: 'https://ilinkai.weixin.qq.com',
          connectedAt: 1_234
        },
        connectionSource: 'saved_account'
      });

      const response = await app.request('/v1/inbound/poll', {
        method: 'GET',
        headers: { Authorization: 'Bearer secret' }
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        events: [
          {
            providerMessageId: 'msg_private_1',
            chatId: 'wx_user_1',
            userId: 'wx_user_1',
            text: 'hello linnsy',
            receivedAt: 2_222,
            metadata: {
              source: 'wechat-bot-api-test'
            }
          }
        ]
      });
      await expect(tokenStore.get('wx_user_1')).resolves.toEqual({
        chatId: 'wx_user_1',
        token: 'ctx_latest'
      });
      expect(wechatBotApi.sendCalls).toEqual([
        {
          toUserId: 'wx_user_1',
          text: 'queued hello\n\nqueued follow-up',
          contextToken: 'ctx_latest'
        }
      ]);
      expect(wechatBotApi.commitCursorCalls).toEqual(['cursor_after_batch_1']);
      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('failed flush releases claimed queue items back to ready and marks the gateway as degraded', async () => {
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
        createdAt: 1_000
      });

      const wechatBotApi = createFakeWechatBotApiClient({
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
        ],
        sendError: new Error('WeChat bot API unavailable')
      });
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        wechatBotApi,
        tokenStore,
        queue,
        account: {
          accountId: 'wx_account_1',
          userId: 'wx_user_1',
          botToken: 'bot_token_1',
          baseUrl: 'https://ilinkai.weixin.qq.com',
          connectedAt: 1_234
        },
        connectionSource: 'saved_account'
      });

      const response = await app.request('/v1/inbound/poll', {
        method: 'GET',
        headers: { Authorization: 'Bearer secret' }
      });

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        status: 'failed',
        error: 'WeChat bot API unavailable'
      });
      const statusResponse = await app.request('/v1/status', {
        method: 'GET',
        headers: { Authorization: 'Bearer secret' }
      });

      expect(statusResponse.status).toBe(200);
      const statusBody: unknown = await statusResponse.json();
      expect(statusBody).toMatchObject({
        ok: false,
        account: {
          accountId: 'wx_account_1',
          userId: 'wx_user_1',
          baseUrl: 'https://ilinkai.weixin.qq.com',
          connectedAt: 1_234,
          source: 'saved_account'
        },
        connection: {
          state: 'degraded',
          lastPollError: 'WeChat bot API unavailable'
        },
        outbound: {
          deferredReadyCount: 1,
          deferredClaimedCount: 0
        }
      });
      expect(isStatusWithErrorTimestamp(statusBody)).toBe(true);
      expect(wechatBotApi.commitCursorCalls).toEqual([]);
      await expect(queue.claimReadyForChat('wx_user_1')).resolves.toEqual([
        {
          deferredId: 'deferred_1',
          chatId: 'wx_user_1',
          text: 'queued hello',
          deliveryMode: 'proactive',
          createdAt: 1_000
        }
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('reply delivery without token fails instead of faking success or deferred', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const tokenStore = createContextTokenStore({ stateDir });
      const queue = createOutboundQueue({ stateDir });
      const wechatBotApi = createFakeWechatBotApiClient();
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        wechatBotApi,
        tokenStore,
        queue
      });

      const response = await app.request('/v1/outbound/send', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          target: { chatId: 'wx_user_1', chatType: 'private' },
          payload: { text: 'hello now' },
          deliveryMode: 'reply'
        })
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        status: 'failed',
        error: 'missing_context_token'
      });
      expect(wechatBotApi.sendCalls).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('outbound send rejects non-private targets at the gateway boundary', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const tokenStore = createContextTokenStore({ stateDir });
      const queue = createOutboundQueue({ stateDir });
      const wechatBotApi = createFakeWechatBotApiClient();
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        wechatBotApi,
        tokenStore,
        queue
      });

      const response = await app.request('/v1/outbound/send', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          target: { chatId: 'wx_group_1', chatType: 'group' },
          payload: { text: 'should reject' },
          deliveryMode: 'proactive'
        })
      });

      expect(response.status).toBe(400);
      expect(wechatBotApi.sendCalls).toEqual([]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('bearer errors return 401 before touching the gateway', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const tokenStore = createContextTokenStore({ stateDir });
      const queue = createOutboundQueue({ stateDir });
      const wechatBotApi = createFakeWechatBotApiClient();
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        wechatBotApi,
        tokenStore,
        queue
      });

      const response = await app.request('/v1/inbound/poll', {
        method: 'GET'
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        code: 'LINNSY_HTTP_BEARER_REQUIRED'
      });
      expect(wechatBotApi.getUpdatesCalls).toBe(0);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('health route returns ok behind bearer auth', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const tokenStore = createContextTokenStore({ stateDir });
      const queue = createOutboundQueue({ stateDir });
      const app = createWechatGatewayApp({
        bearerToken: 'secret',
        wechatBotApi: createFakeWechatBotApiClient(),
        tokenStore,
        queue
      });

      const response = await app.request('/v1/health', {
        method: 'GET',
        headers: { Authorization: 'Bearer secret' }
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

});
