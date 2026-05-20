import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../../__tests__/harness/temp-home.js';
import { createContextTokenStore } from '../context-token-store.js';

describe('ContextTokenStore', () => {
  test('overwrites the latest token for the same chat', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const store = createContextTokenStore({ stateDir });

      await store.save({ chatId: 'wx_user_1', token: 'token_old' });
      await store.save({ chatId: 'wx_user_1', token: 'token_new' });

      await expect(store.get('wx_user_1')).resolves.toEqual({
        chatId: 'wx_user_1',
        token: 'token_new'
      });
      await expect(store.get('missing_chat')).resolves.toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('reads persisted tokens after re-instantiation', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const firstStore = createContextTokenStore({ stateDir });

      await firstStore.save({ chatId: 'wx_user_1', token: 'token_1' });

      const secondStore = createContextTokenStore({ stateDir });
      await expect(secondStore.get('wx_user_1')).resolves.toEqual({
        chatId: 'wx_user_1',
        token: 'token_1'
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('clears all persisted tokens for account switching', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const store = createContextTokenStore({ stateDir });

      await store.save({ chatId: 'wx_user_1', token: 'token_1' });
      await store.clear();

      await expect(store.get('wx_user_1')).resolves.toBeNull();
      const secondStore = createContextTokenStore({ stateDir });
      await expect(secondStore.get('wx_user_1')).resolves.toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('serializes concurrent saves inside one process so updates are not lost', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const store = createContextTokenStore({ stateDir });

      await Promise.all([
        store.save({ chatId: 'wx_user_1', token: 'token_1' }),
        store.save({ chatId: 'wx_user_2', token: 'token_2' })
      ]);

      await expect(store.get('wx_user_1')).resolves.toEqual({
        chatId: 'wx_user_1',
        token: 'token_1'
      });
      await expect(store.get('wx_user_2')).resolves.toEqual({
        chatId: 'wx_user_2',
        token: 'token_2'
      });

      const persisted = await readPersistedTokens(join(stateDir, 'context-tokens.json'));
      expect(persisted).toEqual({
        wx_user_1: 'token_1',
        wx_user_2: 'token_2'
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

async function readPersistedTokens(filePath: string): Promise<Record<string, string>> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!isPersistedTokenMap(parsed)) {
    throw new Error(`unexpected persisted token state at ${filePath}`);
  }
  return parsed;
}

function isPersistedTokenMap(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
}
