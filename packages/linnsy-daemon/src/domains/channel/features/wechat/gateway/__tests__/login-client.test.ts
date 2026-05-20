import { describe, expect, test, vi } from 'vitest';

import {
  createWechatQrLoginClient,
  DEFAULT_WECHAT_BOT_API_BASE_URL
} from '../login-client.js';

describe('wechat qr login client', () => {
  test('starts qr login and returns the qr url', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({
        qrcode: 'qr_token_1',
        qrcode_img_content: 'https://example.com/qr/1'
      })));
    const client = createWechatQrLoginClient({ fetch });

    const result = await client.start();

    expect(result.qrcode).toBe('qr_token_1');
    expect(result.qrUrl).toBe('https://example.com/qr/1');
    expect(typeof result.expiresAt).toBe('number');

    expect(fetch).toHaveBeenCalledWith(
      `${DEFAULT_WECHAT_BOT_API_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
      expect.objectContaining({
        method: 'GET'
      })
    );
  });

  test('waits for qr confirmation and returns connected account data', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'wait'
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'confirmed',
        bot_token: 'bot_token_1',
        ilink_bot_id: 'wx_account_1',
        ilink_user_id: 'wx_user_1',
        baseurl: 'https://redirect.example.com'
      })));
    const client = createWechatQrLoginClient({
      fetch,
      sleep: () => Promise.resolve()
    });

    const result = await client.waitForConfirmation({
      qrcode: 'qr_token_1',
      timeoutMs: 10_000
    });

    expect(result.connected).toBe(true);
    if (!result.connected) {
      throw new Error('expected the QR login to connect');
    }
    expect(result.account.accountId).toBe('wx_account_1');
    expect(result.account.botToken).toBe('bot_token_1');
    expect(result.account.baseUrl).toBe('https://redirect.example.com');
    expect(typeof result.account.connectedAt).toBe('number');
    expect(result.account.userId).toBe('wx_user_1');
  });

  test('returns expired when the QR code expires before confirmation', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({
        status: 'expired'
      })));
    const client = createWechatQrLoginClient({
      fetch,
      sleep: () => Promise.resolve()
    });

    await expect(client.waitForConfirmation({
      qrcode: 'qr_token_1',
      timeoutMs: 10_000
    })).resolves.toEqual({
      connected: false,
      reason: 'expired'
    });
  });
});
