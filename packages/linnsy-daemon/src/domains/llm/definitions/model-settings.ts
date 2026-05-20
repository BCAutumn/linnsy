import { z } from 'zod';

export const userModelProviderTypes = ['openai_compatible', 'anthropic_compatible'] as const;

const modelIdFragmentSchema = z.string()
  .trim()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/u);

const urlTextSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  return /^https?:\/\//u.test(trimmed) ? trimmed : `https://${trimmed}`;
}, z.string().url());

const userModelMetadataShape = {
  id: modelIdFragmentSchema,
  providerType: z.enum(userModelProviderTypes),
  baseUrl: urlTextSchema.transform(normalizeCompatibleBaseUrl),
  modelName: z.string().trim().min(1),
  displayName: z.string().trim().optional(),
  apiKeyEnv: z.string().trim().min(1).optional()
} as const;

const userModelMetadataSchema = z.object(userModelMetadataShape).strict().transform((value) => {
  const displayName = value.displayName === undefined || value.displayName.length === 0
    ? undefined
    : value.displayName;
  return {
    id: value.id,
    providerType: value.providerType,
    baseUrl: value.baseUrl,
    modelName: value.modelName,
    ...(displayName === undefined ? {} : { displayName }),
    ...(value.apiKeyEnv === undefined ? {} : { apiKeyEnv: value.apiKeyEnv })
  };
});

export const llmUserModelMetadataSchema = userModelMetadataSchema;

export const llmUserModelWriteSchema = z.object({
  ...userModelMetadataShape,
  apiKey: z.string().trim().min(1).optional()
}).strict().transform((value) => {
  const displayName = value.displayName === undefined || value.displayName.length === 0
    ? undefined
    : value.displayName;
  return {
    id: value.id,
    providerType: value.providerType,
    baseUrl: value.baseUrl,
    modelName: value.modelName,
    ...(displayName === undefined ? {} : { displayName }),
    ...(value.apiKey === undefined ? {} : { apiKey: value.apiKey }),
    ...(value.apiKeyEnv === undefined ? {} : { apiKeyEnv: value.apiKeyEnv })
  };
});

export const legacyLlmUserModelPreferenceSchema = z.object({
  ...userModelMetadataShape,
  apiKey: z.string().trim().min(1)
}).strict().transform((value) => {
  const displayName = value.displayName === undefined || value.displayName.length === 0
    ? undefined
    : value.displayName;
  return {
    id: value.id,
    providerType: value.providerType,
    baseUrl: value.baseUrl,
    modelName: value.modelName,
    apiKey: value.apiKey,
    ...(displayName === undefined ? {} : { displayName }),
    ...(value.apiKeyEnv === undefined ? {} : { apiKeyEnv: value.apiKeyEnv })
  };
});

function uniqueUserModelIds(models: Array<{ id: string }>, context: z.RefinementCtx): void {
  const ids = new Set<string>();
  for (const [index, model] of models.entries()) {
    if (ids.has(model.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'id'],
        message: `duplicate user model id ${model.id}`
      });
    }
    ids.add(model.id);
  }
}

export const llmUserModelsMetadataSchema = z.array(llmUserModelMetadataSchema)
  .superRefine((models, context) => {
    uniqueUserModelIds(models, context);
  });

export const llmUserModelsWriteSchema = z.array(llmUserModelWriteSchema)
  .superRefine((models, context) => {
    uniqueUserModelIds(models, context);
  });

export const legacyLlmUserModelsPreferenceSchema = z.array(legacyLlmUserModelPreferenceSchema)
  .superRefine((models, context) => {
    uniqueUserModelIds(models, context);
  });

export const llmUserModelPreferenceSchema = llmUserModelMetadataSchema;
export const llmUserModelsPreferenceSchema = llmUserModelsMetadataSchema;
export const llmChatModelIdPreferenceSchema = z.string().trim().min(1).nullable();

export type LlmUserModelPreference = z.infer<typeof llmUserModelPreferenceSchema>;
export type LlmUserModelsPreference = z.infer<typeof llmUserModelsPreferenceSchema>;
export type LlmUserModelWriteInput = z.infer<typeof llmUserModelWriteSchema>;
export type LlmUserModelsWriteInput = z.infer<typeof llmUserModelsWriteSchema>;
export type LegacyLlmUserModelPreference = z.infer<typeof legacyLlmUserModelPreferenceSchema>;
export type LlmChatModelIdPreference = z.infer<typeof llmChatModelIdPreferenceSchema>;
export type LlmUserModelProviderType = LlmUserModelPreference['providerType'];

export interface RuntimeUserModel extends LlmUserModelPreference {
  apiKey?: string;
}

export interface RuntimeModelSettings {
  userModels: RuntimeUserModel[];
  chatModelId: LlmChatModelIdPreference;
}

export const defaultRuntimeModelSettings: RuntimeModelSettings = {
  userModels: [],
  chatModelId: null
};

export function toRuntimeModelId(userModelId: string): string {
  return `user.${userModelId}`;
}

export function fromRuntimeUserModelId(modelId: string): string | null {
  if (!modelId.startsWith('user.')) {
    return null;
  }
  const id = modelId.slice('user.'.length);
  return id.length === 0 ? null : id;
}

export function toApiProtocol(providerType: LlmUserModelProviderType): 'openai_chat' | 'anthropic_messages' {
  return providerType === 'openai_compatible' ? 'openai_chat' : 'anthropic_messages';
}

function normalizeCompatibleBaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const normalizedPath = normalizePathname(url.pathname);
  url.pathname = normalizedPath === '/' ? '/v1' : normalizedPath;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}

function normalizePathname(pathname: string): string {
  const withoutTrailingSlash = pathname.replace(/\/+$/u, '');
  return withoutTrailingSlash.length === 0 ? '/' : withoutTrailingSlash;
}
