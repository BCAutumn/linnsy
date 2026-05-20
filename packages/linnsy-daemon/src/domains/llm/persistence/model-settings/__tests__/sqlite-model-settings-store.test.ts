import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import type { ModelSecretsStorePort } from '../../model-secrets/model-secrets-store-port.js';
import { SqliteModelSecretsStore } from '../../model-secrets/sqlite-model-secrets-store.js';
import { SqliteModelSettingsStore } from '../sqlite-model-settings-store.js';
import type { StoredModelSettings } from '../model-settings-store-port.js';

describe('sqlite model settings store', () => {
  test('migrates legacy llm UI preferences into model settings and encrypted secrets', async () => {
    const { db, home } = await createFixture();
    const settingsStore = new SqliteModelSettingsStore(db, { now: () => 1_000 });
    const secretsStore = new SqliteModelSecretsStore(db, { masterKey: randomBytes(32), now: () => 1_000 });

    try {
      db.prepare('INSERT INTO ui_preferences (key, value, updated_at) VALUES (?, ?, ?)')
        .run('llm.user_models', JSON.stringify([{
          id: 'deepseek',
          providerType: 'openai_compatible',
          baseUrl: 'api.deepseek.com',
          modelName: 'deepseek-chat',
          apiKey: 'sk-test',
          displayName: 'DeepSeek'
        }]), 1);
      db.prepare('INSERT INTO ui_preferences (key, value, updated_at) VALUES (?, ?, ?)')
        .run('llm.chat_model_id', JSON.stringify('user.deepseek'), 1);

      settingsStore.migrateLegacyUiPreferences(secretsStore);

      expect(settingsStore.getSync()).toEqual({
        chatModelId: 'user.deepseek',
        userModels: [{
          id: 'deepseek',
          providerType: 'openai_compatible',
          baseUrl: 'https://api.deepseek.com/v1',
          modelName: 'deepseek-chat',
          displayName: 'DeepSeek'
        }]
      });
      expect(secretsStore.getApiKeySync('deepseek')).toBe('sk-test');
      expect(db.prepare('SELECT count(*) AS count FROM ui_preferences WHERE key LIKE ?').get('llm.%'))
        .toEqual({ count: 0 });
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('rolls back model settings when credential writes fail inside saveWithSecrets', async () => {
    const { db, home } = await createFixture();
    const settingsStore = new SqliteModelSettingsStore(db, { now: () => 1_000 });

    try {
      const originalSettings: StoredModelSettings = {
        chatModelId: 'user.original',
        userModels: [{
          id: 'original',
          providerType: 'openai_compatible',
          baseUrl: 'https://api.original.example/v1',
          modelName: 'original-chat'
        }]
      };
      await settingsStore.set(originalSettings);

      await expect(settingsStore.saveWithSecrets({
        settings: {
          chatModelId: 'user.deepseek',
          userModels: [{
            id: 'deepseek',
            providerType: 'openai_compatible',
            baseUrl: 'https://api.deepseek.com/v1',
            modelName: 'deepseek-chat'
          }]
        },
        apiKeyWrites: [{ modelId: 'deepseek', apiKey: 'sk-test' }],
        retainedModelIds: new Set(['deepseek'])
      }, createThrowingSecretsStore())).rejects.toThrow('credential write failed');

      expect(settingsStore.getSync()).toEqual(originalSettings);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});

function createThrowingSecretsStore(): ModelSecretsStorePort {
  return {
    getApiKey() {
      return Promise.resolve(null);
    },
    getApiKeySync() {
      return null;
    },
    listApiKeysSync() {
      return new Map();
    },
    setApiKey() {
      return Promise.reject(new Error('credential write failed'));
    },
    setApiKeySync() {
      throw new Error('credential write failed');
    },
    removeApiKey() {
      return Promise.resolve(false);
    },
    removeApiKeysExcept() {
      return Promise.resolve();
    },
    removeApiKeysExceptSync() {}
  };
}

async function createFixture(): Promise<{ db: Database.Database; home: string }> {
  const home = await createTempLinnsyHome();
  const db = new Database(':memory:');
  createTables(db);
  return { db, home };
}
