import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteModelSecretsStore } from '../../model-secrets/sqlite-model-secrets-store.js';

interface CredentialRow {
  encrypted_api_key: string;
  nonce: string;
  auth_tag: string;
}

describe('sqlite model secrets store', () => {
  test('encrypts API keys at rest and decrypts them with the master key', async () => {
    const { db, home } = await createFixture();
    const masterKey = randomBytes(32);

    try {
      const store = new SqliteModelSecretsStore(db, { masterKey, now: () => 1_000 });
      await store.setApiKey('deepseek', 'sk-test');

      const row = db.prepare<[string], CredentialRow>('SELECT encrypted_api_key, nonce, auth_tag FROM model_credentials WHERE model_id = ?')
        .get('deepseek');
      expect(typeof row?.nonce).toBe('string');
      expect(typeof row?.auth_tag).toBe('string');
      expect(JSON.stringify(row)).not.toContain('sk-test');
      expect(store.getApiKeySync('deepseek')).toBe('sk-test');
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('removes credentials that no longer belong to configured models', async () => {
    const { db, home } = await createFixture();
    const store = new SqliteModelSecretsStore(db, { masterKey: randomBytes(32), now: () => 1_000 });

    try {
      await store.setApiKey('keep', 'sk-keep');
      await store.setApiKey('drop', 'sk-drop');
      await store.removeApiKeysExcept(new Set(['keep']));

      expect(store.getApiKeySync('keep')).toBe('sk-keep');
      expect(store.getApiKeySync('drop')).toBeNull();
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('removes every credential when no user model is retained', async () => {
    const { db, home } = await createFixture();
    const store = new SqliteModelSecretsStore(db, { masterKey: randomBytes(32), now: () => 1_000 });

    try {
      await store.setApiKey('drop_1', 'sk-drop-1');
      await store.setApiKey('drop_2', 'sk-drop-2');

      store.removeApiKeysExceptSync(new Set());

      expect(store.getApiKeySync('drop_1')).toBeNull();
      expect(store.getApiKeySync('drop_2')).toBeNull();
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});

async function createFixture(): Promise<{ db: Database.Database; home: string }> {
  const home = await createTempLinnsyHome();
  const db = new Database(':memory:');
  createTables(db);
  return { db, home };
}
