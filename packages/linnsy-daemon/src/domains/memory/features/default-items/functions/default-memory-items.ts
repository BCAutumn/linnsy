import type { MemoryProviderPort, MemoryUpsertInput } from '../../../persistence/memory-store-port.js';

const DEFAULT_SYSTEM_PROMPT_MEMORY_ID = 'builtin:linnsy_main:system_prompt';
const BUILTIN_SYSTEM_PROMPT_SOURCE = 'linnsy_main.prompt';
const BUILTIN_SYSTEM_PROMPT_METADATA = {
  builtin: true,
  agentId: 'linnsy_main',
  source: BUILTIN_SYSTEM_PROMPT_SOURCE
};
const OBSOLETE_BUILTIN_MEMORY_IDS = [
  'builtin:linnsy_main:owner_shaping',
  'builtin:linnsy_main:setting'
] as const;

export function createDefaultMemoryItems(systemPrompt: string): MemoryUpsertInput[] {
  return [
    {
      memoryId: DEFAULT_SYSTEM_PROMPT_MEMORY_ID,
      scope: 'system_prompt',
      body: systemPrompt,
      metadata: BUILTIN_SYSTEM_PROMPT_METADATA
    },
    {
      memoryId: 'builtin:linnsy_main:persona',
      scope: 'persona',
      body: 'Linnsy 是常驻在主人电脑上的个人 AI 秘书，需要像同一个人一样保持连续性。',
      metadata: { builtin: true, agentId: 'linnsy_main' }
    },
    {
      memoryId: 'builtin:linnsy_main:work_style',
      scope: 'work_style',
      body: '这里记录 Linnsy 做事时长期遵守的工作方式，例如主动程度、汇报边界、回复习惯和协作节奏。',
      metadata: { builtin: true, agentId: 'linnsy_main' }
    },
    {
      memoryId: 'builtin:linnsy_main:user_preference',
      scope: 'user_preference',
      body: '这里记录主人明确说过的偏好、称呼、沟通风格、工作习惯和已经纠正过的行为。',
      metadata: { builtin: true, agentId: 'linnsy_main' }
    },
    {
      memoryId: 'builtin:linnsy_main:long_term_memory',
      scope: 'long_term_memory',
      body: '这里放稳定的长期事实，例如主人是谁、重要项目、长期合作关系、固定日程、长期偏好。',
      metadata: { builtin: true, agentId: 'linnsy_main' }
    }
  ];
}

export async function ensureDefaultMemoryItems(store: MemoryProviderPort, systemPrompt: string): Promise<void> {
  await removeObsoleteBuiltinMemoryItems(store);
  for (const item of createDefaultMemoryItems(systemPrompt)) {
    // 产品尚未发布，内置默认项始终以后端代码为准；开发期旧 SQLite 不保留兼容。
    await store.upsert(item);
  }
}

async function removeObsoleteBuiltinMemoryItems(store: MemoryProviderPort): Promise<void> {
  for (const memoryId of OBSOLETE_BUILTIN_MEMORY_IDS) {
    await store.remove(memoryId);
  }
}
