import type { MemoryProviderPort } from '../../../memory/persistence/memory-store-port.js';
import {
  readMemoryRecall
} from '../../../memory/features/recall/functions/memory-recall.js';
import {
  createSystemPromptShapingInput,
  shapeMemoryForSystemPrompt,
  type SystemPromptMemoryShape
} from '../../../memory/features/prompt-shaping/functions/memory-shaping.js';
import type { AgentDefinition } from '../agents/contracts.js';
import { LINNSY_MAIN_AGENT_ID } from '../agents/index.js';
import { renderPromptTemplate } from '../agents/prompt-template.js';

import { composeSystemPrompt, DEFAULT_SHAPING_VERSION } from './system-prompt-assembler.js';

export type SystemPromptPreviewSectionScope =
  | 'system_prompt'
  | 'persona'
  | 'work_style'
  | 'user_preference'
  | 'long_term_memory';

export interface SystemPromptPreviewSection {
  scope: SystemPromptPreviewSectionScope;
  heading: string;
  body: string;
  editable: boolean;
}

export interface SystemPromptPreview {
  agentId: string;
  role: 'system';
  shapingVersion: string;
  assembledPrompt: string;
  sections: SystemPromptPreviewSection[];
}

export async function buildSystemPromptPreview(input: {
  definition: AgentDefinition;
  memoryStore: MemoryProviderPort;
}): Promise<SystemPromptPreview> {
  const memoryRecall = await readMemoryRecall({
    memoryStore: input.memoryStore,
    includeLongTermMemory: input.definition.id === LINNSY_MAIN_AGENT_ID
      && input.definition.memoryPolicy.includeLongTermMemory,
    // 设置页预览的是 role=system 的稳定内容；每轮变化的 memory-context 围栏不参与这里的召回。
    query: ''
  });
  const memoryShape = shapeMemoryForSystemPrompt(memoryRecall);
  const shapingInput = createSystemPromptShapingInput(memoryShape);
  const shapingVersion = memoryShape.shapingVersionSuffix === undefined
    ? DEFAULT_SHAPING_VERSION
    : `${DEFAULT_SHAPING_VERSION}.memory:${memoryShape.shapingVersionSuffix}`;
  return {
    agentId: input.definition.id,
    role: 'system',
    shapingVersion,
    assembledPrompt: composeSystemPrompt({
      definition: input.definition,
      conversationId: 'settings:system-prompt-preview',
      ...(shapingInput.shaping === undefined ? {} : { shaping: shapingInput.shaping })
    }, shapingVersion),
    sections: createPreviewSections(input.definition, memoryShape)
  };
}

function createPreviewSections(
  definition: AgentDefinition,
  memoryShape: SystemPromptMemoryShape
): SystemPromptPreviewSection[] {
  const sections: SystemPromptPreviewSection[] = [
    {
      scope: 'system_prompt',
      heading: 'system_prompt',
      body: memoryShape.systemPromptOverride ?? renderDefinitionBasePrompt(definition),
      editable: true
    },
    ...memoryShape.systemExtraSections.map((section) => ({
      scope: readSectionScope(section.heading),
      heading: section.heading,
      body: section.body,
      editable: true
    })),
    {
      scope: 'long_term_memory',
      heading: 'long_term_memory',
      body: memoryShape.systemMemoryRecall.map((item) => item.body).join('\n\n'),
      editable: true
    }
  ];
  return sections.filter((section) => section.body.trim().length > 0);
}

function renderDefinitionBasePrompt(definition: AgentDefinition): string {
  return renderPromptTemplate(definition.basePrompt, {
    agent: {
      id: definition.id,
      displayName: definition.displayName
    }
  });
}

function readSectionScope(heading: string): Exclude<SystemPromptPreviewSectionScope, 'system_prompt' | 'long_term_memory'> {
  if (heading === 'linnsy_persona') {
    return 'persona';
  }
  if (heading === 'work_style') {
    return 'work_style';
  }
  return 'user_preference';
}
