import type { AgentDefinition } from '../agents/contracts.js';
import type {
  SystemPromptExtraSection,
  SystemPromptMemoryRecall,
  SystemPromptShapingInputs
} from '../../../memory/features/prompt-shaping/functions/memory-shaping.js';

export type { SystemPromptExtraSection, SystemPromptMemoryRecall, SystemPromptShapingInputs };

export interface SystemPromptInput {
  definition: AgentDefinition;
  conversationId: string;
  /** Defaults to `linnsy.system_prompt.v1`; bumping invalidates older cache entries. */
  shapingVersion?: string;
  shaping?: SystemPromptShapingInputs;
}

export interface SystemPromptOutput {
  cacheKey: string;
  systemPrompt: string;
  shapingVersion: string;
  /** True when served from cache without re-composition. */
  reused: boolean;
  /** Unix ms when the prompt was first composed for the current cache entry. */
  composedAt: number;
}

export interface SystemPromptAssemblerPort {
  assemble(input: SystemPromptInput): SystemPromptOutput;
  invalidate(conversationId: string): number;
  clear(): void;
}
