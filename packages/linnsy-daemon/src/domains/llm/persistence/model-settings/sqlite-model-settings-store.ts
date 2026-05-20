import type Database from 'better-sqlite3';

import {
  defaultRuntimeModelSettings,
  legacyLlmUserModelsPreferenceSchema,
  llmChatModelIdPreferenceSchema,
  llmUserModelsPreferenceSchema
} from '../../definitions/model-settings.js';
import type { ModelSecretsStorePort } from '../model-secrets/model-secrets-store-port.js';
import type {
  ModelSettingsStorePort,
  SaveModelSettingsWithSecretsInput,
  StoredModelSettings
} from './model-settings-store-port.js';

interface ModelSettingRow {
  value: string;
}

interface LegacyPreferenceRow {
  value: string;
}

export class SqliteModelSettingsStore implements ModelSettingsStorePort {
  private readonly getStatement: Database.Statement<[string], ModelSettingRow>;
  private readonly upsertStatement: Database.Statement<[string, string, number]>;
  private readonly getLegacyPreferenceStatement: Database.Statement<[string], LegacyPreferenceRow>;
  private readonly migrateLegacyTransaction: (secretsStore: ModelSecretsStorePort) => void;
  private readonly saveWithSecretsTransaction: (
    input: SaveModelSettingsWithSecretsInput,
    secretsStore: ModelSecretsStorePort
  ) => void;
  private readonly now: () => number;

  public constructor(private readonly db: Database.Database, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    this.getStatement = db.prepare<[string], ModelSettingRow>(
      `SELECT value FROM model_settings WHERE key = ?`
    );
    this.upsertStatement = db.prepare(
      `INSERT INTO model_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`
    );
    this.getLegacyPreferenceStatement = db.prepare<[string], LegacyPreferenceRow>(
      `SELECT value FROM ui_preferences WHERE key = ?`
    );
    this.migrateLegacyTransaction = db.transaction((secretsStore: ModelSecretsStorePort) => {
      const legacyUserModels = this.readLegacyUserModels();
      const legacyChatModelId = this.readLegacyChatModelId();
      if (legacyUserModels === null && legacyChatModelId === null) {
        return;
      }

      const nextSettings: StoredModelSettings = {
        userModels: (legacyUserModels ?? []).map((model) => ({
          id: model.id,
          providerType: model.providerType,
          baseUrl: model.baseUrl,
          modelName: model.modelName,
          ...(model.displayName === undefined ? {} : { displayName: model.displayName }),
          ...(model.apiKeyEnv === undefined ? {} : { apiKeyEnv: model.apiKeyEnv })
        })),
        chatModelId: legacyChatModelId ?? defaultRuntimeModelSettings.chatModelId
      };

      this.setSync(nextSettings);
      for (const model of legacyUserModels ?? []) {
        secretsStore.setApiKeySync(model.id, model.apiKey);
      }
      db.prepare(`DELETE FROM ui_preferences WHERE key IN ('llm.user_models', 'llm.chat_model_id')`).run();
    });
    this.saveWithSecretsTransaction = db.transaction((
      input: SaveModelSettingsWithSecretsInput,
      secretsStore: ModelSecretsStorePort
    ) => {
      this.setSync(input.settings);
      for (const write of input.apiKeyWrites) {
        secretsStore.setApiKeySync(write.modelId, write.apiKey);
      }
      secretsStore.removeApiKeysExceptSync(input.retainedModelIds);
    });
  }

  public get(): Promise<StoredModelSettings> {
    return Promise.resolve(this.getSync());
  }

  public getSync(): StoredModelSettings {
    const userModels = this.readStoredValue('user_models', defaultRuntimeModelSettings.userModels);
    const chatModelId = this.readStoredValue('chat_model_id', defaultRuntimeModelSettings.chatModelId);
    return {
      userModels: llmUserModelsPreferenceSchema.catch(defaultRuntimeModelSettings.userModels).parse(userModels),
      chatModelId: llmChatModelIdPreferenceSchema.catch(defaultRuntimeModelSettings.chatModelId).parse(chatModelId)
    };
  }

  public set(settings: StoredModelSettings): Promise<void> {
    this.setSync(settings);
    return Promise.resolve();
  }

  public saveWithSecrets(
    input: SaveModelSettingsWithSecretsInput,
    secretsStore: ModelSecretsStorePort
  ): Promise<void> {
    return Promise.resolve().then(() => {
      this.saveWithSecretsTransaction(input, secretsStore);
    });
  }

  public migrateLegacyUiPreferences(secretsStore: ModelSecretsStorePort): void {
    this.migrateLegacyTransaction(secretsStore);
  }

  private setSync(settings: StoredModelSettings): void {
    const parsed: StoredModelSettings = {
      userModels: llmUserModelsPreferenceSchema.parse(settings.userModels),
      chatModelId: llmChatModelIdPreferenceSchema.parse(settings.chatModelId)
    };
    const now = this.now();
    this.upsertStatement.run('user_models', JSON.stringify(parsed.userModels), now);
    this.upsertStatement.run('chat_model_id', JSON.stringify(parsed.chatModelId), now);
  }

  private readStoredValue(key: string, fallback: unknown): unknown {
    const row = this.getStatement.get(key);
    if (row === undefined) {
      return fallback;
    }
    return JSON.parse(row.value) as unknown;
  }

  private readLegacyUserModels(): ReturnType<typeof legacyLlmUserModelsPreferenceSchema.parse> | null {
    const row = this.getLegacyPreferenceStatement.get('llm.user_models');
    if (row === undefined) {
      return null;
    }
    return legacyLlmUserModelsPreferenceSchema.parse(JSON.parse(row.value) as unknown);
  }

  private readLegacyChatModelId(): string | null {
    const row = this.getLegacyPreferenceStatement.get('llm.chat_model_id');
    if (row === undefined) {
      return null;
    }
    return llmChatModelIdPreferenceSchema.parse(JSON.parse(row.value) as unknown);
  }
}
