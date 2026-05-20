export interface ModelSecretsStorePort {
  getApiKey(modelId: string): Promise<string | null>;
  getApiKeySync(modelId: string): string | null;
  listApiKeysSync(modelIds: readonly string[]): Map<string, string>;
  setApiKey(modelId: string, apiKey: string): Promise<void>;
  setApiKeySync(modelId: string, apiKey: string): void;
  removeApiKey(modelId: string): Promise<boolean>;
  removeApiKeysExcept(modelIds: ReadonlySet<string>): Promise<void>;
  removeApiKeysExceptSync(modelIds: ReadonlySet<string>): void;
}
