import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../schema/schema-provider.js';
import { SqlitePairingStore } from '../sqlite-pairing-store.js';

describe('SqlitePairingStore', () => {
  test('stores only hashed pairing codes and consumes a valid code once', async () => {
    const fixture = await createFixture();
    try {
      const store = new SqlitePairingStore(fixture.db, {
        pairingIdFactory: () => 'pair_1',
        saltFactory: () => Buffer.from('1234567890abcdef', 'utf8')
      });

      await store.createPairing({
        platform: 'telegram',
        chatId: 'chat_1',
        userId: 'user_1',
        code: 'ABCDEFGH',
        expiresAt: 2000,
        createdAt: 1000
      });

      const row = fixture.db
        .prepare<[string], { code_hash: string }>('SELECT code_hash FROM pairings WHERE pairing_id = ?')
        .get('pair_1');
      expect(row?.code_hash).toMatch(/^scrypt:v1:/u);
      expect(row?.code_hash.includes('ABCDEFGH')).toBe(false);

      await expect(store.consumePairingCode({
        code: 'ABCDEFGH',
        platform: 'telegram',
        chatId: 'chat_1',
        userId: 'user_1',
        now: 1500,
        maxAttempts: 5
      })).resolves.toBe(true);
      await expect(store.consumePairingCode({
        code: 'ABCDEFGH',
        platform: 'telegram',
        chatId: 'chat_1',
        userId: 'user_1',
        now: 1501,
        maxAttempts: 5
      })).resolves.toBe(false);
      await expect(store.hasAuthorizedPairing({
        platform: 'telegram',
        chatId: 'chat_1',
        userId: 'user_1'
      })).resolves.toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  test('does not consume expired pairings', async () => {
    const fixture = await createFixture();
    try {
      const store = new SqlitePairingStore(fixture.db, {
        pairingIdFactory: () => 'pair_1',
        saltFactory: () => Buffer.from('1234567890abcdef', 'utf8')
      });
      await store.createPairing({
        platform: 'telegram',
        chatId: 'chat_1',
        code: 'ABCDEFGH',
        expiresAt: 2000,
        createdAt: 1000
      });

      await expect(store.consumePairingCode({
        code: 'ABCDEFGH',
        platform: 'telegram',
        chatId: 'chat_1',
        now: 2001,
        maxAttempts: 5
      })).resolves.toBe(false);
      await expect(store.hasAuthorizedPairing({
        platform: 'telegram',
        chatId: 'chat_1'
      })).resolves.toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  test('limits invalid consume attempts before accepting a code', async () => {
    const fixture = await createFixture();
    try {
      const store = new SqlitePairingStore(fixture.db, {
        pairingIdFactory: () => 'pair_1',
        saltFactory: () => Buffer.from('1234567890abcdef', 'utf8')
      });
      await store.createPairing({
        platform: 'telegram',
        chatId: 'chat_1',
        code: 'ABCDEFGH',
        expiresAt: 2000,
        createdAt: 1000
      });

      await expect(store.consumePairingCode({
        code: 'ZZZZZZZZ',
        platform: 'telegram',
        chatId: 'chat_1',
        now: 1500,
        maxAttempts: 2
      })).resolves.toBe(false);
      await expect(store.consumePairingCode({
        code: 'YYYYYYYY',
        platform: 'telegram',
        chatId: 'chat_1',
        now: 1501,
        maxAttempts: 2
      })).resolves.toBe(false);
      await expect(store.consumePairingCode({
        code: 'ABCDEFGH',
        platform: 'telegram',
        chatId: 'chat_1',
        now: 1502,
        maxAttempts: 2
      })).resolves.toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });
});

async function createFixture(): Promise<{ db: Database.Database; cleanup(): Promise<void> }> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  return {
    db,
    async cleanup(): Promise<void> {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  };
}
