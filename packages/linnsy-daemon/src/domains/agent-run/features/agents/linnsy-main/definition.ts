import type { AgentDefinition } from '../contracts.js';

import { linnsyMainPrompt } from './prompt.js';

export const LINNSY_MAIN_AGENT_ID = 'linnsy_main';

export function createLinnsyMainAgentDefinition(
  overrides: Partial<AgentDefinition> = {}
): AgentDefinition {
  const base: AgentDefinition = {
    id: LINNSY_MAIN_AGENT_ID,
    displayName: 'Linnsy',
    description: 'Personal AI secretary for the owner across channels',
    systemPromptId: 'linnsy_main.system_prompt.v1',
    basePrompt: linnsyMainPrompt,
    modelPolicy: {
      model: 'default',
      reasoningEffort: 'medium'
    },
    toolPolicy: {
      allowedToolIds: [
        'delegate_to_external',
        'delegate_to_internal',
        'manage_external_session',
        'list_tasks',
        'get_task_status',
        'manage_task',
        'redelegate_task',
        'manage_schedule',
        'manage_memory'
      ]
    },
    memoryPolicy: {
      includeLongTermMemory: true,
      includeConversationSummary: true
    },
    executionPolicy: {
      // 这是单轮 graph 步数预算，不是工具调用次数上限。
      maxSteps: 40
    },
    enabled: true
  };

  return {
    ...base,
    ...overrides,
    modelPolicy: { ...base.modelPolicy, ...(overrides.modelPolicy ?? {}) },
    toolPolicy: { ...base.toolPolicy, ...(overrides.toolPolicy ?? {}) },
    memoryPolicy: { ...base.memoryPolicy, ...(overrides.memoryPolicy ?? {}) },
    executionPolicy: { ...base.executionPolicy, ...(overrides.executionPolicy ?? {}) },
    metadata: { ...base.metadata, ...(overrides.metadata ?? {}) },
    basePrompt: overrides.basePrompt ?? base.basePrompt
  };
}
