import { describe, expect, test } from 'vitest';

import { createWechatGatewayStatusTracker } from '../gateway-status.js';
import type { OutboundQueuePort, WechatGatewayAccount } from '../types.js';

describe('wechat gateway status tracker', () => {
  test('exposes QR login as a first-class connection state and clears it after account connection', async () => {
    const status = createWechatGatewayStatusTracker({ queue: createQueueSummary() });
    const account = createAccount();

    status.recordGatewayStarting(100);
    await expect(status.snapshot()).resolves.toMatchObject({
      ok: false,
      account: null,
      connection: {
        state: 'not_connected',
        startedAt: 100
      }
    });

    status.recordQrIssued(200, 'https://example.com/wechat-qr', 320);
    await expect(status.snapshot()).resolves.toMatchObject({
      ok: true,
      account: null,
      connection: {
        state: 'awaiting_qr_scan',
        qrLoginUrl: 'https://example.com/wechat-qr',
        qrLoginIssuedAt: 200,
        qrLoginExpiresAt: 320
      }
    });

    status.recordQrExpired(321);
    await expect(status.snapshot()).resolves.toMatchObject({
      ok: false,
      account: null,
      connection: {
        state: 'not_connected',
        startedAt: 100
      }
    });

    status.recordQrIssued(330, 'https://example.com/wechat-qr-2', 450);

    status.recordAccountConnected(300, account, 'fresh_qr');
    await expect(status.snapshot()).resolves.toMatchObject({
      ok: true,
      account: {
        accountId: account.accountId,
        source: 'fresh_qr'
      },
      connection: {
        state: 'connected'
      }
    });
  });

  test('keeps connected after account connection and reports degraded from poll results without losing the account', async () => {
    const status = createWechatGatewayStatusTracker({
      queue: createQueueSummary(),
      account: createAccount(),
      connectionSource: 'saved_account'
    });

    await expect(status.snapshot()).resolves.toMatchObject({
      ok: true,
      account: {
        accountId: 'wx_account_1',
        source: 'saved_account'
      },
      connection: {
        state: 'connected'
      }
    });

    status.recordPollSuccess(400);
    await expect(status.snapshot()).resolves.toMatchObject({
      ok: true,
      account: {
        accountId: 'wx_account_1',
        source: 'saved_account'
      },
      connection: {
        state: 'connected',
        lastPollSucceededAt: 400
      }
    });

    status.recordPollFailure(500, 'WeChat bot API unavailable');
    await expect(status.snapshot()).resolves.toMatchObject({
      ok: false,
      account: {
        accountId: 'wx_account_1',
        source: 'saved_account'
      },
      connection: {
        state: 'degraded',
        lastPollSucceededAt: 400,
        lastPollErrorAt: 500,
        lastPollError: 'WeChat bot API unavailable'
      }
    });
  });
});

function createQueueSummary(): Pick<OutboundQueuePort, 'getSummary'> {
  return {
    getSummary: () => Promise.resolve({ readyCount: 0, claimedCount: 0 })
  };
}

function createAccount(): WechatGatewayAccount {
  return {
    accountId: 'wx_account_1',
    botToken: 'bot_token_1',
    baseUrl: 'https://ilinkai.weixin.qq.com',
    connectedAt: 1234
  };
}
