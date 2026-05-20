import type {
  ModelSettings,
  ModelSummary,
  UserModelPreference,
  UserModelWriteInput,
  UserModelProviderType
} from '../../lib/daemon-api.js';
import { t, type Locale } from '../../lib/i18n.js';

export interface UserModelDraft {
  id: string;
  providerType: UserModelProviderType;
  baseUrl: string;
  modelName: string;
  displayName: string;
  apiKey: string;
  hasApiKey: boolean;
}

export function createEmptyUserModelDraft(): UserModelDraft {
  return {
    id: createDraftId(),
    providerType: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    modelName: '',
    displayName: '',
    apiKey: '',
    hasApiKey: false
  };
}

export function toUserModelDraft(model: UserModelPreference): UserModelDraft {
  return {
    id: model.id,
    providerType: model.providerType,
    baseUrl: model.baseUrl,
    modelName: model.modelName,
    displayName: model.displayName ?? '',
    apiKey: '',
    hasApiKey: model.hasApiKey
  };
}

export function toUserModelWriteInput(draft: UserModelDraft): UserModelWriteInput | null {
  const baseUrl = normalizeUrlInput(draft.baseUrl);
  const modelName = draft.modelName.trim();
  const displayName = draft.displayName.trim();
  const apiKey = draft.apiKey.trim();
  if (baseUrl === null || modelName.length === 0 || (apiKey.length === 0 && !draft.hasApiKey)) {
    return null;
  }

  return {
    id: draft.id,
    providerType: draft.providerType,
    baseUrl,
    modelName,
    ...(apiKey.length === 0 ? {} : { apiKey }),
    ...(displayName.length === 0 ? {} : { displayName })
  };
}

export function upsertUserModel(
  models: UserModelPreference[],
  model: UserModelWriteInput
): UserModelWriteInput[] {
  const index = models.findIndex((item) => item.id === model.id);
  const existing = models.map(toWriteInputWithoutSecret);
  if (index === -1) {
    return [...existing, model];
  }
  return existing.map((item, itemIndex) => itemIndex === index ? model : item);
}

export function removeUserModel(
  settings: ModelSettings,
  userModelId: string
): { chatModelId: string | null; userModels: UserModelPreference[] } {
  const removedRuntimeId = `user.${userModelId}`;
  const userModels = settings.userModels.filter((model) => model.id !== userModelId);
  const selectedStillExists = settings.chatModelId !== null
    && settings.chatModelId !== removedRuntimeId
    && userModels.some((model) => toRuntimeModelId(model.id) === settings.chatModelId);
  return {
    userModels,
    chatModelId: selectedStillExists ? settings.chatModelId : toFirstRuntimeModelId(userModels)
  };
}

export function selectChatModelAfterUpsert(
  currentChatModelId: string | null,
  models: Array<{ id: string }>,
  upsertedModelId: string
): string {
  if (currentChatModelId !== null && models.some((model) => toRuntimeModelId(model.id) === currentChatModelId)) {
    return currentChatModelId;
  }
  return toRuntimeModelId(upsertedModelId);
}

export function modelOptionLabel(model: ModelSummary): string {
  return model.displayName ?? model.modelName;
}

export function providerTypeLabel(locale: Locale, providerType: UserModelProviderType): string {
  return providerType === 'openai_compatible'
    ? t(locale, 'modelProviderOpenAiCompatible')
    : t(locale, 'modelProviderAnthropicCompatible');
}

function normalizeUrlInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const withProtocol = /^https?:\/\//u.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    const pathname = url.pathname.replace(/\/+$/u, '');
    url.pathname = pathname.length === 0 ? '/v1' : pathname;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return null;
  }
}

function createDraftId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/gu, '').slice(0, 12);
  }
  return `m${String(Date.now())}`;
}

function toRuntimeModelId(userModelId: string): string {
  return `user.${userModelId}`;
}

function toFirstRuntimeModelId(models: UserModelPreference[]): string | null {
  const first = models[0];
  return first === undefined ? null : toRuntimeModelId(first.id);
}

function toWriteInputWithoutSecret(model: UserModelPreference): UserModelWriteInput {
  return {
    id: model.id,
    providerType: model.providerType,
    baseUrl: model.baseUrl,
    modelName: model.modelName,
    ...(model.displayName === undefined ? {} : { displayName: model.displayName }),
    ...(model.apiKeyEnv === undefined ? {} : { apiKeyEnv: model.apiKeyEnv })
  };
}
