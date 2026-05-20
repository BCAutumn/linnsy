import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import type { LinnsyModelConfig, LinnsyModelRegistryPort } from '../../model-registry/model-registry.js';
import type {
  ModelApiKeyWrite,
  ModelSettingsStorePort,
  StoredModelSettings
} from '../../../persistence/model-settings/model-settings-store-port.js';
import { toRuntimeModelSettings } from '../../../persistence/model-settings/model-settings-store-port.js';
import type { ModelSecretsStorePort } from '../../../persistence/model-secrets/model-secrets-store-port.js';
import {
  llmChatModelIdPreferenceSchema,
  llmUserModelsWriteSchema,
  toApiProtocol,
  toRuntimeModelId,
  type LlmUserModelPreference,
  type LlmUserModelWriteInput,
  type RuntimeModelSettings
} from '../model-settings.js';

export interface CreateModelSettingsRoutesOptions {
  settingsStore: ModelSettingsStorePort;
  secretsStore: ModelSecretsStorePort;
  registry: LinnsyModelRegistryPort;
}

const modelSettingsBodySchema = z.object({
  chatModelId: llmChatModelIdPreferenceSchema,
  userModels: llmUserModelsWriteSchema
}).strict();

export function createModelSettingsRoutes(options: CreateModelSettingsRoutesOptions): Hono {
  const app = new Hono();

  app.get('/api/v1/models/settings', async (context) => {
    const storedSettings = await options.settingsStore.get();
    const settings = toRuntimeSettings(storedSettings, options.secretsStore);
    options.registry.setRuntimeModelSettings(settings);
    return context.json({
      ok: true,
      settings: toResponseSettings(options.registry, storedSettings, options.secretsStore)
    });
  });

  app.put(
    '/api/v1/models/settings',
    zValidator('json', modelSettingsBodySchema),
    async (context) => {
      const input = context.req.valid('json');
      const settingsResult = await prepareStoredSettings(input, options.secretsStore);
      if (!settingsResult.ok) {
        return context.json({
          ok: false,
          code: LINNSY_ERROR_CODES.LLM_MODEL_CREDENTIAL_REQUIRED,
          message: settingsResult.message
        }, 400);
      }
      const settings = settingsResult.settings;
      const availableModelIds = collectAvailableModelIds(settings);
      if (settings.chatModelId !== null && !availableModelIds.has(settings.chatModelId)) {
        return context.json({
          ok: false,
          code: LINNSY_ERROR_CODES.LLM_MODEL_NOT_FOUND,
          message: `chat model ${settings.chatModelId} is not configured`
        }, 400);
      }

      await options.settingsStore.saveWithSecrets({
        settings,
        apiKeyWrites: collectApiKeyWrites(input.userModels),
        retainedModelIds: new Set(settings.userModels.map((model) => model.id))
      }, options.secretsStore);
      const runtimeSettings = toRuntimeSettings(settings, options.secretsStore);
      options.registry.setRuntimeModelSettings(runtimeSettings);

      return context.json({
        ok: true,
        settings: toResponseSettings(options.registry, settings, options.secretsStore)
      });
    }
  );

  return app;
}

async function prepareStoredSettings(
  input: z.infer<typeof modelSettingsBodySchema>,
  secretsStore: ModelSecretsStorePort
): Promise<{ ok: true; settings: StoredModelSettings } | { ok: false; message: string }> {
  const userModels: LlmUserModelPreference[] = [];
  for (const model of input.userModels) {
    const hasPersistedApiKey = model.apiKey !== undefined
      || model.apiKeyEnv !== undefined
      || await secretsStore.getApiKey(model.id) !== null;
    if (!hasPersistedApiKey) {
      return { ok: false, message: `model ${model.id} requires an apiKey or apiKeyEnv` };
    }
    userModels.push(stripSecret(model));
  }
  return {
    ok: true,
    settings: {
      userModels,
      chatModelId: input.chatModelId
    }
  };
}

function stripSecret(model: LlmUserModelWriteInput): LlmUserModelPreference {
  return {
    id: model.id,
    providerType: model.providerType,
    baseUrl: model.baseUrl,
    modelName: model.modelName,
    ...(model.displayName === undefined ? {} : { displayName: model.displayName }),
    ...(model.apiKeyEnv === undefined ? {} : { apiKeyEnv: model.apiKeyEnv })
  };
}

function collectApiKeyWrites(models: readonly LlmUserModelWriteInput[]): ModelApiKeyWrite[] {
  const writes: ModelApiKeyWrite[] = [];
  for (const model of models) {
    if (model.apiKey !== undefined) {
      writes.push({ modelId: model.id, apiKey: model.apiKey });
    }
  }
  return writes;
}

function toRuntimeSettings(settings: StoredModelSettings, secretsStore: ModelSecretsStorePort): RuntimeModelSettings {
  return toRuntimeModelSettings(
    settings,
    secretsStore.listApiKeysSync(settings.userModels.map((model) => model.id))
  );
}

function toResponseSettings(
  registry: LinnsyModelRegistryPort,
  storedSettings: StoredModelSettings,
  secretsStore: ModelSecretsStorePort
): {
  chatModelId: string | null;
  models: Array<{
    id: string;
    provider: string;
    apiProtocol: LinnsyModelConfig['apiProtocol'];
    modelName: string;
    displayName?: string;
    baseUrl?: string;
    source: 'user';
    hasApiKey: boolean;
  }>;
  userModels: Array<LlmUserModelPreference & { hasApiKey: boolean }>;
} {
  const settings = registry.getRuntimeModelSettings();
  const userModelIds = new Set(settings.userModels.map((model) => toRuntimeModelId(model.id)));
  const publicUserModels = storedSettings.userModels.map((model) => ({
    ...model,
    hasApiKey: secretsStore.getApiKeySync(model.id) !== null
  }));
  return {
    chatModelId: settings.chatModelId !== null && userModelIds.has(settings.chatModelId) ? settings.chatModelId : null,
    models: storedSettings.userModels.map((model) => {
      const summary: {
        id: string;
        provider: string;
        apiProtocol: LinnsyModelConfig['apiProtocol'];
        modelName: string;
        source: 'user';
        displayName?: string;
        baseUrl: string;
        hasApiKey: boolean;
      } = {
        id: toRuntimeModelId(model.id),
        provider: `user_${model.providerType}_${model.id}`,
        apiProtocol: toApiProtocol(model.providerType),
        modelName: model.modelName,
        source: 'user',
        baseUrl: model.baseUrl,
        hasApiKey: secretsStore.getApiKeySync(model.id) !== null
      };
      return {
        ...summary,
        ...(model.displayName === undefined ? {} : { displayName: model.displayName })
      };
    }),
    userModels: publicUserModels
  };
}

function collectAvailableModelIds(nextSettings: StoredModelSettings): Set<string> {
  const ids = new Set<string>();
  for (const model of nextSettings.userModels) {
    ids.add(toRuntimeModelId(model.id));
  }
  return ids;
}
