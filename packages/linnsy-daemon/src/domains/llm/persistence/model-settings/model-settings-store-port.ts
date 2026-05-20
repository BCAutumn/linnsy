import type {
  LlmChatModelIdPreference,
  LlmUserModelsPreference,
  RuntimeModelSettings
} from '../../definitions/model-settings.js';
import type { ModelSecretsStorePort } from '../model-secrets/model-secrets-store-port.js';

export interface StoredModelSettings {
  userModels: LlmUserModelsPreference;
  chatModelId: LlmChatModelIdPreference;
}

export interface ModelApiKeyWrite {
  modelId: string;
  apiKey: string;
}

export interface SaveModelSettingsWithSecretsInput {
  settings: StoredModelSettings;
  apiKeyWrites: readonly ModelApiKeyWrite[];
  retainedModelIds: ReadonlySet<string>;
}

export interface ModelSettingsStorePort {
  get(): Promise<StoredModelSettings>;
  getSync(): StoredModelSettings;
  set(settings: StoredModelSettings): Promise<void>;
  saveWithSecrets(
    input: SaveModelSettingsWithSecretsInput,
    secretsStore: ModelSecretsStorePort
  ): Promise<void>;
}

export function toRuntimeModelSettings(
  settings: StoredModelSettings,
  apiKeys: Map<string, string>
): RuntimeModelSettings {
  return {
    chatModelId: settings.chatModelId,
    userModels: settings.userModels.map((model) => {
      const apiKey = apiKeys.get(model.id);
      return {
        ...model,
        ...(apiKey === undefined ? {} : { apiKey })
      };
    })
  };
}
