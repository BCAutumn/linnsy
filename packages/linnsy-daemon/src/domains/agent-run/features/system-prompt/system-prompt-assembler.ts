import type { ClockPort } from '../../../../shared/ports.js';
import { systemClock } from '../../../../shared/ports.js';

import type {
  SystemPromptAssemblerPort,
  SystemPromptInput,
  SystemPromptOutput,
  SystemPromptShapingInputs
} from './types.js';
import {
  renderPromptTemplate,
  type PromptTemplateVariables
} from '../agents/prompt-template.js';

export const DEFAULT_SHAPING_VERSION = 'linnsy.system_prompt.v1';

export interface CreateSystemPromptAssemblerOptions {
  cacheCapacity?: number;
  clock?: ClockPort;
  composer?: (input: SystemPromptInput, shapingVersion: string, nowMs: number) => string;
}

interface CacheEntry {
  conversationId: string;
  prompt: string;
  shapingVersion: string;
  composedAt: number;
}

export function buildSystemPromptCacheKey(input: {
  definitionId: string;
  conversationId: string;
  shapingVersion: string;
}): string {
  return `${input.definitionId}::${input.conversationId}::${input.shapingVersion}`;
}

export function composeSystemPrompt(input: SystemPromptInput, shapingVersion: string): string {
  void shapingVersion;
  const lines: string[] = [];
  const definition = input.definition;
  lines.push(renderPromptTemplate(
    input.shaping?.systemPromptOverride ?? definition.basePrompt,
    createPromptTemplateVariables(definition)
  ));

  if (input.shaping !== undefined) {
    appendShaping(lines, input.shaping);
  }

  return lines.join('\n').trimEnd();
}

export function createSystemPromptAssembler(
  options: CreateSystemPromptAssemblerOptions = {}
): SystemPromptAssemblerPort {
  const capacity = options.cacheCapacity ?? 128;
  const clock = options.clock ?? systemClock;
  const composer = options.composer ?? composeSystemPrompt;
  const cache = new Map<string, CacheEntry>();
  const conversationIndex = new Map<string, Set<string>>();

  function rememberKey(conversationId: string, cacheKey: string): void {
    const bucket = conversationIndex.get(conversationId);
    if (bucket === undefined) {
      conversationIndex.set(conversationId, new Set([cacheKey]));
    } else {
      bucket.add(cacheKey);
    }
  }

  function forgetKey(conversationId: string, cacheKey: string): void {
    const bucket = conversationIndex.get(conversationId);
    if (bucket === undefined) {
      return;
    }
    bucket.delete(cacheKey);
    if (bucket.size === 0) {
      conversationIndex.delete(conversationId);
    }
  }

  function trimCache(): void {
    while (cache.size > capacity) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      const evicted = cache.get(oldestKey);
      cache.delete(oldestKey);
      if (evicted !== undefined) {
        forgetKey(evicted.conversationId, oldestKey);
      }
    }
  }

  return {
    assemble(input: SystemPromptInput): SystemPromptOutput {
      const shapingVersion = input.shapingVersion ?? DEFAULT_SHAPING_VERSION;
      const nowMs = clock.now();
      const cacheKey = buildSystemPromptCacheKey({
        definitionId: input.definition.id,
        conversationId: input.conversationId,
        shapingVersion
      });

      const existing = cache.get(cacheKey);
      if (existing !== undefined) {
        cache.delete(cacheKey);
        cache.set(cacheKey, existing);
        return {
          cacheKey,
          systemPrompt: existing.prompt,
          shapingVersion,
          reused: true,
          composedAt: existing.composedAt
        };
      }

      const composedAt = nowMs;
      const prompt = composer(input, shapingVersion, nowMs);
      cache.set(cacheKey, {
        conversationId: input.conversationId,
        prompt,
        shapingVersion,
        composedAt
      });
      rememberKey(input.conversationId, cacheKey);
      trimCache();

      return {
        cacheKey,
        systemPrompt: prompt,
        shapingVersion,
        reused: false,
        composedAt
      };
    },

    invalidate(conversationId: string): number {
      const bucket = conversationIndex.get(conversationId);
      if (bucket === undefined) {
        return 0;
      }
      let removed = 0;
      for (const cacheKey of bucket) {
        if (cache.delete(cacheKey)) {
          removed += 1;
        }
      }
      conversationIndex.delete(conversationId);
      return removed;
    },

    clear(): void {
      cache.clear();
      conversationIndex.clear();
    }
  };
}

function createPromptTemplateVariables(
  definition: SystemPromptInput['definition']
): PromptTemplateVariables {
  return {
    agent: {
      id: definition.id,
      displayName: definition.displayName
    }
  };
}

function appendShaping(lines: string[], shaping: SystemPromptShapingInputs): void {
  if (shaping.extraSections !== undefined) {
    for (const section of shaping.extraSections) {
      lines.push('');
      lines.push(`[${section.heading}]`);
      lines.push(section.body);
    }
  }
  if (shaping.memoryRecall !== undefined && shaping.memoryRecall.length > 0) {
    lines.push('');
    lines.push('[long_term_memory]');
    for (const item of shaping.memoryRecall) {
      lines.push(item.body);
    }
  }
}
