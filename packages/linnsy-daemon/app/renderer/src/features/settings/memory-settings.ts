import type { DaemonApiClient, MemoryItem, MemoryItemWriteInput, SystemPromptPreview } from '../../lib/daemon-api.js';
import { t, type I18nKey, type Locale } from '../../lib/i18n.js';

export type MemoryScopePreset = 'system_prompt' | 'persona' | 'work_style' | 'user_preference' | 'long_term_memory';

export interface MemoryScopeOption {
  scope: MemoryScopePreset;
  labelKey: I18nKey;
  descriptionKey: I18nKey;
}

export const MEMORY_SCOPE_OPTIONS: MemoryScopeOption[] = [
  { scope: 'system_prompt', labelKey: 'memoryScopeSystemPrompt', descriptionKey: 'memoryScopeSystemPromptDescription' },
  { scope: 'persona', labelKey: 'memoryScopePersona', descriptionKey: 'memoryScopePersonaDescription' },
  { scope: 'work_style', labelKey: 'memoryScopeWorkStyle', descriptionKey: 'memoryScopeWorkStyleDescription' },
  { scope: 'user_preference', labelKey: 'memoryScopeUserPreference', descriptionKey: 'memoryScopeUserPreferenceDescription' },
  { scope: 'long_term_memory', labelKey: 'memoryScopeLongTerm', descriptionKey: 'memoryScopeLongTermDescription' }
];
const DEFAULT_MEMORY_SCOPE_OPTION = MEMORY_SCOPE_OPTIONS[3];

export interface MemoryItemDraft {
  memoryId?: string;
  scope: string;
  body: string;
  conversationId?: string;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryBodyUnitStats {
  hanCharacters: number;
  englishWords: number;
  isOverLimit: boolean;
}

export const MEMORY_BODY_UNIT_LIMIT = 1000;

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/gu;
const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:[''][A-Za-z]+)?/g;

export const defaultMemoryItemDraft: MemoryItemDraft = {
  scope: 'long_term_memory',
  body: ''
};

export function createMemoryDraftFromItem(item: MemoryItem): MemoryItemDraft {
  return {
    memoryId: item.memoryId,
    scope: item.scope,
    body: item.body,
    ...(item.conversationId === undefined ? {} : { conversationId: item.conversationId }),
    ...(item.expiresAt === undefined ? {} : { expiresAt: item.expiresAt }),
    ...(item.metadata === undefined ? {} : { metadata: item.metadata })
  };
}

export function createMemoryWriteInput(draft: MemoryItemDraft): MemoryItemWriteInput {
  return {
    scope: draft.scope.trim(),
    body: draft.body.trim(),
    ...(draft.conversationId === undefined ? {} : { conversationId: draft.conversationId }),
    ...(draft.expiresAt === undefined ? {} : { expiresAt: draft.expiresAt }),
    ...(draft.metadata === undefined ? {} : { metadata: draft.metadata })
  };
}

export type MemoryDraftInvalidField = 'scope' | 'body' | 'bodyLimit';

export function validateMemoryDraft(draft: MemoryItemDraft): MemoryDraftInvalidField | null {
  if (draft.scope.trim().length === 0) {
    return 'scope';
  }
  if (draft.body.trim().length === 0) {
    return 'body';
  }
  if (countMemoryBodyUnits(draft.body).isOverLimit) {
    return 'bodyLimit';
  }
  return null;
}

export function countMemoryBodyUnits(body: string): MemoryBodyUnitStats {
  const hanCharacters = Array.from(body.matchAll(HAN_CHARACTER_PATTERN)).length;
  const englishWords = Array.from(body.matchAll(ENGLISH_WORD_PATTERN)).length;
  return {
    hanCharacters,
    englishWords,
    isOverLimit: hanCharacters > MEMORY_BODY_UNIT_LIMIT || englishWords > MEMORY_BODY_UNIT_LIMIT
  };
}

export function formatMemoryTime(locale: Locale, value: number): string {
  if (value < 1000000000000) {
    return String(value);
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export function createDefaultMemoryDraft(scope: MemoryScopePreset): MemoryItemDraft {
  const preset = findMemoryScopeOption(scope);
  return {
    ...defaultMemoryItemDraft,
    scope: preset.scope
  };
}

export function isMemoryScopePreset(value: string): value is MemoryScopePreset {
  return MEMORY_SCOPE_OPTIONS.some((option) => option.scope === value);
}

export function getMemoryScopeLabelKey(scope: string): I18nKey {
  return findMemoryScopePreset(scope)?.labelKey ?? 'memoryScopeLongTerm';
}

export function getMemoryScopeDescriptionKey(scope: string): I18nKey {
  return findMemoryScopePreset(scope)?.descriptionKey ?? 'memoryScopeLongTermDescription';
}

export async function loadMemoryItems(
  client: DaemonApiClient | null,
  query = ''
): Promise<MemoryItem[]> {
  if (client === null) {
    return [];
  }
  return client.listMemoryItems({
    limit: 100,
    ...(query.trim().length === 0 ? {} : { query })
  });
}

export async function loadSystemPromptPreview(
  client: DaemonApiClient | null
): Promise<SystemPromptPreview | null> {
  if (client === null) {
    return null;
  }
  return client.getSystemPromptPreview();
}

export function selectMemoryDraftForScope(
  items: MemoryItem[],
  scope: MemoryScopePreset,
  preview?: SystemPromptPreview | null
): { item: MemoryItem | null; draft: MemoryItemDraft } {
  const item = items.find((candidate) => candidate.scope === scope) ?? null;
  const draft = item === null ? createDefaultMemoryDraft(scope) : createMemoryDraftFromItem(item);
  return {
    item,
    draft: applySystemPromptPreviewToDraft(draft, preview)
  };
}

export function applySystemPromptPreviewToDraft(
  draft: MemoryItemDraft,
  preview?: SystemPromptPreview | null
): MemoryItemDraft {
  // 后端 preview 是真实拼装结果；前端 draft 只承载当前分段的可编辑投影。
  const section = preview?.sections.find((candidate) => candidate.scope === draft.scope);
  if (section === undefined) {
    return draft;
  }
  return {
    ...draft,
    body: section.body
  };
}

export async function saveMemoryDraftToDaemon(
  client: DaemonApiClient,
  draft: MemoryItemDraft
): Promise<MemoryItem> {
  const writeInput = createMemoryWriteInput(draft);
  return draft.memoryId === undefined
    ? client.createMemoryItem(writeInput)
    : client.updateMemoryItem(draft.memoryId, writeInput);
}

export async function deleteMemoryItemFromDaemon(
  client: DaemonApiClient,
  draft: MemoryItemDraft
): Promise<void> {
  if (draft.memoryId === undefined) {
    return;
  }
  await client.deleteMemoryItem(draft.memoryId);
}

export function upsertMemoryItem(items: MemoryItem[], saved: MemoryItem): MemoryItem[] {
  const withoutSaved = items.filter((item) => item.memoryId !== saved.memoryId);
  return [saved, ...withoutSaved].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function removeMemoryItemById(items: MemoryItem[], memoryId: string | undefined): MemoryItem[] {
  if (memoryId === undefined) {
    return items;
  }
  return items.filter((item) => item.memoryId !== memoryId);
}

export function readMemoryErrorMessage(error: unknown, locale: Locale): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return t(locale, 'operationRetryLater');
}

export function isMemorySuccessMessage(message: string, locale: Locale): boolean {
  return message === t(locale, 'memorySaved') || message === t(locale, 'memoryDeleted');
}

function findMemoryScopeOption(scope: string): MemoryScopeOption {
  const option = findMemoryScopePreset(scope) ?? DEFAULT_MEMORY_SCOPE_OPTION;
  if (option === undefined) {
    throw new Error('memory scope options must include a default long-term memory option');
  }
  return option;
}

function findMemoryScopePreset(scope: string): MemoryScopeOption | undefined {
  return MEMORY_SCOPE_OPTIONS.find((candidate) => candidate.scope === scope);
}
