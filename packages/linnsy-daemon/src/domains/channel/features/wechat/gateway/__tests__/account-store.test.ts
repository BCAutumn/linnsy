import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../../__tests__/harness/temp-home.js';
import { createWechatAccountStore } from '../account-store.js';

describe('wechat account store', () => {
  test('persists a single connected account across restarts', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const store = createWechatAccountStore({ stateDir });

      await expect(store.get()).resolves.toBeNull();

      await store.save({
        accountId: 'wx_account_1',
        botToken: 'bot_token_1',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        connectedAt: 1_234,
        userId: 'wx_user_1'
      });

      await expect(store.get()).resolves.toEqual({
        accountId: 'wx_account_1',
        botToken: 'bot_token_1',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        connectedAt: 1_234,
        userId: 'wx_user_1'
      });

      const restarted = createWechatAccountStore({ stateDir });
      await expect(restarted.get()).resolves.toEqual({
        accountId: 'wx_account_1',
        botToken: 'bot_token_1',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        connectedAt: 1_234,
        userId: 'wx_user_1'
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('clear removes the saved account', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const store = createWechatAccountStore({ stateDir });

      await store.save({
        accountId: 'wx_account_1',
        botToken: 'bot_token_1',
        baseUrl: 'https://ilinkai.weixin.qq.com',
        connectedAt: 1_234
      });

      await store.clear();

      await expect(store.get()).resolves.toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
