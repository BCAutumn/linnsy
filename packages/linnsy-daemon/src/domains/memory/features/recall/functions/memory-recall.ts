import type { MemoryItem, MemoryProviderPort } from '../../../persistence/memory-store-port.js';

const SYSTEM_PROMPT_MEMORY_LIMIT = 20;
const TURN_MEMORY_CONTEXT_LIMIT = 8;
export const MEMORY_SHAPING_SCOPES = ['system_prompt', 'persona', 'work_style', 'user_preference'] as const;
export const LONG_TERM_MEMORY_SCOPE = 'long_term_memory';
export type MemoryShapingScope = typeof MEMORY_SHAPING_SCOPES[number];

export interface ReadMemoryRecallInput {
  memoryStore: MemoryProviderPort | undefined;
  includeLongTermMemory: boolean;
  query: string;
  skipMemory?: boolean;
}

export interface MemoryContextFact {
  body: string;
  metadata: {
    source: 'memory-store';
    count: number;
  };
}

export interface MemoryRecallSnapshot {
  systemItems: MemoryItem[];
  shapingItems: MemoryItem[];
  turnMemoryContext?: MemoryContextFact;
  shapingVersionSuffix?: string;
}

export async function readMemoryRecall(input: ReadMemoryRecallInput): Promise<MemoryRecallSnapshot> {
  if (!shouldUseMemory(input)) {
    return { systemItems: [], shapingItems: [] };
  }

  const [rawSystemItems, rawTurnItems, ...rawShapingGroups] = await Promise.all([
    input.memoryStore.list({
      scope: LONG_TERM_MEMORY_SCOPE,
      limit: SYSTEM_PROMPT_MEMORY_LIMIT
    }),
    input.memoryStore.recall({
      query: input.query,
      limit: TURN_MEMORY_CONTEXT_LIMIT
    }),
    ...MEMORY_SHAPING_SCOPES.map((scope) => input.memoryStore.list({ scope, limit: SYSTEM_PROMPT_MEMORY_LIMIT }))
  ]);
  const systemItems = rawSystemItems.filter(isMemoryItemEnabled);
  const turnItems = rawTurnItems.filter(isMemoryItemEnabled);
  const shapingGroups = rawShapingGroups.map((items) => items.filter(isMemoryItemEnabled));
  const shapingItems = shapingGroups.flat();

  return {
    systemItems,
    shapingItems,
    ...toOptionalTurnMemoryContext(createMemoryContextFact(turnItems.filter((item) => !isSystemShapingScope(item.scope)))),
    ...toOptionalShapingVersion(createMemoryShapingVersionSuffix([...systemItems, ...shapingItems]))
  };
}

function shouldUseMemory(input: ReadMemoryRecallInput): input is ReadMemoryRecallInput & {
  memoryStore: MemoryProviderPort;
} {
  return input.memoryStore !== undefined
    && input.skipMemory !== true
    && input.includeLongTermMemory;
}

function createMemoryContextFact(items: MemoryItem[]): MemoryContextFact | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return {
    body: formatMemoryContext(items),
    metadata: {
      source: 'memory-store',
      count: items.length
    }
  };
}

function formatMemoryContext(items: MemoryItem[]): string {
  return items
    .map((item) => [
      `scope=${item.scope}`,
      item.body
    ].join('\n'))
    .join('\n\n');
}

function createMemoryShapingVersionSuffix(items: MemoryItem[]): string | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items
    .map((item) => `${item.memoryId}:${String(item.updatedAt)}`)
    .sort()
    .join(',');
}

function toOptionalShapingVersion(value: string | undefined): { shapingVersionSuffix?: string } {
  return value === undefined ? {} : { shapingVersionSuffix: value };
}

function toOptionalTurnMemoryContext(value: MemoryContextFact | undefined): { turnMemoryContext?: MemoryContextFact } {
  return value === undefined ? {} : { turnMemoryContext: value };
}

function isSystemShapingScope(scope: string): scope is MemoryShapingScope {
  return MEMORY_SHAPING_SCOPES.some((candidate) => candidate === scope);
}

function isMemoryItemEnabled(item: MemoryItem): boolean {
  return item.metadata?.enabled !== false;
}
