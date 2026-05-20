import { describe, expect, test } from 'vitest';

import type {
  SaveModelSettingsWithSecretsInput,
  ModelSettingsStorePort,
  StoredModelSettings
} from '../../../../persistence/model-settings/model-settings-store-port.js';
import type { ModelSecretsStorePort } from '../../../../persistence/model-secrets/model-secrets-store-port.js';
import { createModelRegistry } from '../../../model-registry/model-registry.js';
import { createModelSettingsRoutes } from '../model-settings-routes.js';
import type { LinnsyConfig } from '../../../../../../config/schema.js';

describe('model settings routes', () => {
  test('returns user-added models with selected chat model', async () => {
    const registry = createModelRegistry(createConfig());
    const settingsStore = modelSettingsStore({
      userModels: [{
        id: 'deepseek',
        providerType: 'openai_compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        modelName: 'deepseek-chat',
        displayName: 'DeepSeek'
      }],
      chatModelId: 'user.deepseek'
    });
    const secretsStore = modelSecretsStore({ deepseek: 'sk-test' });
    const app = createModelSettingsRoutes({
      registry,
      settingsStore,
      secretsStore
    });

    const response = await app.request('/api/v1/models/settings');

    expect(response.status).toBe(200);
    const body = await response.json() as { settings: { userModels: Array<Record<string, unknown>> } };
    expect(body).toMatchObject({
      ok: true,
      settings: {
        chatModelId: 'user.deepseek',
        models: [
          { id: 'user.deepseek', displayName: 'DeepSeek', source: 'user' }
        ],
        userModels: [
          expect.objectContaining({ id: 'deepseek', hasApiKey: true })
        ]
      }
    });
    expect(body.settings.userModels[0]).not.toHaveProperty('apiKey');
  });

  test('persists model settings and updates the registry selection', async () => {
    const persisted: StoredModelSettings[] = [];
    const secretsStore = modelSecretsStore();
    const registry = createModelRegistry(createConfig());
    const app = createModelSettingsRoutes({
      registry,
      settingsStore: modelSettingsStore(undefined, (settings) => {
        persisted.push(settings);
      }),
      secretsStore
    });

    const response = await app.request('/api/v1/models/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatModelId: 'user.deepseek',
        userModels: [{
          id: 'deepseek',
          providerType: 'openai_compatible',
          baseUrl: 'api.deepseek.com',
          modelName: 'deepseek-chat',
          apiKey: 'sk-test'
        }]
      })
    });

    expect(response.status).toBe(200);
    expect(persisted[0]?.chatModelId).toBe('user.deepseek');
    expect(persisted[0]?.userModels).toEqual([{
      id: 'deepseek',
      providerType: 'openai_compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      modelName: 'deepseek-chat'
    }]);
    await expect(secretsStore.getApiKey('deepseek')).resolves.toBe('sk-test');
    expect(registry.getDefaultModel('secretary').id).toBe('user.deepseek');
  });

  test('rejects unknown selected chat models', async () => {
    const app = createModelSettingsRoutes({
      registry: createModelRegistry(createConfig()),
      settingsStore: modelSettingsStore(),
      secretsStore: modelSecretsStore()
    });

    const response = await app.request('/api/v1/models/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatModelId: 'user.missing',
        userModels: []
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'LINNSY_LLM_MODEL_NOT_FOUND'
    });
  });
});

function modelSettingsStore(
  initial: StoredModelSettings = { userModels: [], chatModelId: null },
  onSet?: (settings: StoredModelSettings) => void
): ModelSettingsStorePort {
  let current = initial;
  return {
    get: () => Promise.resolve(current),
    getSync: () => current,
    set(settings) {
      current = settings;
      onSet?.(settings);
      return Promise.resolve();
    },
    saveWithSecrets(input, secretsStore) {
      current = input.settings;
      onSet?.(input.settings);
      applySecretWrites(input, secretsStore);
      return Promise.resolve();
    }
  };
}

function modelSecretsStore(initial: Record<string, string> = {}): ModelSecretsStorePort {
  const secrets = new Map(Object.entries(initial));
  return {
    getApiKey(modelId) {
      return Promise.resolve(secrets.get(modelId) ?? null);
    },
    getApiKeySync(modelId) {
      return secrets.get(modelId) ?? null;
    },
    listApiKeysSync(modelIds) {
      const result = new Map<string, string>();
      for (const modelId of modelIds) {
        const apiKey = secrets.get(modelId);
        if (apiKey !== undefined) {
          result.set(modelId, apiKey);
        }
      }
      return result;
    },
    setApiKey(modelId, apiKey) {
      secrets.set(modelId, apiKey);
      return Promise.resolve();
    },
    setApiKeySync(modelId, apiKey) {
      secrets.set(modelId, apiKey);
    },
    removeApiKey(modelId) {
      const removed = secrets.delete(modelId);
      return Promise.resolve(removed);
    },
    removeApiKeysExcept(modelIds) {
      removeApiKeysExceptSync(modelIds);
      return Promise.resolve();
    },
    removeApiKeysExceptSync(modelIds) {
      removeApiKeysExceptSync(modelIds);
    }
  };

  function removeApiKeysExceptSync(modelIds: ReadonlySet<string>): void {
    for (const modelId of secrets.keys()) {
      if (!modelIds.has(modelId)) {
        secrets.delete(modelId);
      }
    }
  }
}

function applySecretWrites(
  input: SaveModelSettingsWithSecretsInput,
  secretsStore: ModelSecretsStorePort
): void {
  for (const write of input.apiKeyWrites) {
    secretsStore.setApiKeySync(write.modelId, write.apiKey);
  }
  secretsStore.removeApiKeysExceptSync(input.retainedModelIds);
}

function createConfig(): LinnsyConfig {
  return {
    profile: 'test',
    home: '/tmp/linnsy-test',
    llm: {
      default_provider: 'openai',
      defaults: {
        secretary: 'openai.gpt5',
        cron_summary: 'openai.gpt5',
        memory_consolidate: 'openai.gpt5'
      },
      providers: {
        openai: {
          api_protocol: 'openai_chat',
          api_key_env: 'LINNSY_OPENAI_KEY',
          models: {
            gpt5: { model_name: 'gpt-5' }
          }
        }
      }
    },
    channels: {
      cli: { enabled: true },
      web: { enabled: false, bind: '127.0.0.1:7700', bearer_env: 'LINNSY_WEB_BEARER' }
    },
    auth: {
      global_all: false,
      pairing: { code_ttl_ms: 600000, max_attempts: 5 }
    },
    cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 },
    memory: { on_pre_compress_provider: 'builtin' },
    mcp: { server: { enabled: true, transport: 'stdio' }, clients: [] }
  };
}
