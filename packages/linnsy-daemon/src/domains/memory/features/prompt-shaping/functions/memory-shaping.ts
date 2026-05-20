import type { MemoryItem } from '../../../persistence/memory-store-port.js';
import type { MemoryRecallSnapshot, MemoryShapingScope } from '../../recall/functions/memory-recall.js';

export interface SystemPromptMemoryRecall {
  memoryId: string;
  scope: string;
  body: string;
}

export interface SystemPromptExtraSection {
  heading: string;
  body: string;
}

export interface SystemPromptShapingInputs {
  systemPromptOverride?: string;
  memoryRecall?: SystemPromptMemoryRecall[];
  extraSections?: SystemPromptExtraSection[];
}

export interface SystemPromptMemoryShape {
  systemMemoryRecall: SystemPromptMemoryRecall[];
  systemPromptOverride?: string;
  systemExtraSections: SystemPromptExtraSection[];
  shapingVersionSuffix?: string;
}

export function shapeMemoryForSystemPrompt(snapshot: MemoryRecallSnapshot): SystemPromptMemoryShape {
  const systemPromptItems = snapshot.shapingItems.filter((item) => item.scope === 'system_prompt');
  return {
    systemMemoryRecall: snapshot.systemItems.map(toSystemPromptMemoryRecall),
    ...toOptionalSystemPromptOverride(formatSystemPromptOverride(systemPromptItems)),
    systemExtraSections: createSystemExtraSections(snapshot.shapingItems.filter((item) => item.scope !== 'system_prompt')),
    ...(snapshot.shapingVersionSuffix === undefined ? {} : { shapingVersionSuffix: snapshot.shapingVersionSuffix })
  };
}

export function createSystemPromptShapingInput(shape: SystemPromptMemoryShape): {
  shaping?: SystemPromptShapingInputs;
} {
  if (
    shape.systemPromptOverride === undefined &&
    shape.systemMemoryRecall.length === 0 &&
    shape.systemExtraSections.length === 0
  ) {
    return {};
  }
  return {
    shaping: {
      ...(shape.systemPromptOverride === undefined ? {} : { systemPromptOverride: shape.systemPromptOverride }),
      ...(shape.systemMemoryRecall.length === 0 ? {} : { memoryRecall: shape.systemMemoryRecall }),
      ...(shape.systemExtraSections.length === 0 ? {} : { extraSections: shape.systemExtraSections })
    }
  };
}

function toSystemPromptMemoryRecall(item: MemoryItem): SystemPromptMemoryRecall {
  return {
    memoryId: item.memoryId,
    scope: item.scope,
    body: item.body
  };
}

function createSystemExtraSections(items: MemoryItem[]): SystemPromptExtraSection[] {
  return [
    createExtraSection('persona', 'linnsy_persona', items),
    createExtraSection('work_style', 'work_style', items),
    createExtraSection('user_preference', 'user_preference', items)
  ].filter((section): section is SystemPromptExtraSection => section !== null);
}

function createExtraSection(
  scope: Exclude<MemoryShapingScope, 'system_prompt'>,
  heading: string,
  items: MemoryItem[]
): SystemPromptExtraSection | null {
  const scopedItems = items.filter((item) => item.scope === scope);
  if (scopedItems.length === 0) {
    return null;
  }
  return {
    heading,
    body: scopedItems
      .map((item) => item.body)
      .join('\n\n')
  };
}

function formatSystemPromptOverride(items: MemoryItem[]): string | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items
    .map((item) => item.body)
    .join('\n\n');
}

function toOptionalSystemPromptOverride(value: string | undefined): { systemPromptOverride?: string } {
  return value === undefined ? {} : { systemPromptOverride: value };
}
