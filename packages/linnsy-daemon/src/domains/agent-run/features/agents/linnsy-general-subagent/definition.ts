import type { AgentDefinition } from '../contracts.js';

import { linnsyGeneralSubagentPrompt } from './prompt.js';

export const LINNSY_GENERAL_SUBAGENT_ID = 'linnsy_general_subagent';

export function createLinnsyGeneralSubagentDefinition(
  overrides: Partial<AgentDefinition> = {}
): AgentDefinition {
  const base: AgentDefinition = {
    id: LINNSY_GENERAL_SUBAGENT_ID,
    displayName: 'Linnsy General Subagent',
    description: 'Lightweight internal subagent for bounded delegated tasks.',
    systemPromptId: 'linnsy_general_subagent.system_prompt.v1',
    basePrompt: linnsyGeneralSubagentPrompt,
    modelPolicy: {
      model: 'default',
      reasoningEffort: 'low'
    },
    toolPolicy: {
      allowedToolIds: ['list_tasks', 'get_task_status']
    },
    memoryPolicy: {
      includeLongTermMemory: false,
      includeConversationSummary: false
    },
    contextPolicy: {
      // 内部子 agent 只处理一次明确委派，不继承主会话长上下文预算。
      budget: {
        maxTokens: 32_000,
        reservedForResponse: 1_600,
        workingMemoryBudgetPercentage: 0.55
      },
      toolHistory: {
        keepLatestRuns: 1,
        maxInteractionGroups: 4
      },
      workingMemory: {
        minToolInteractionsToKeep: 1,
        maxRecentToolInteractions: 1,
        toolPairingSearchRange: 6
      }
    },
    executionPolicy: {
      maxSteps: 6
    },
    metadata: {
      kind: 'internal_subagent'
    },
    enabled: true
  };

  return {
    ...base,
    ...overrides,
    modelPolicy: { ...base.modelPolicy, ...(overrides.modelPolicy ?? {}) },
    toolPolicy: { ...base.toolPolicy, ...(overrides.toolPolicy ?? {}) },
    memoryPolicy: { ...base.memoryPolicy, ...(overrides.memoryPolicy ?? {}) },
    contextPolicy: { ...base.contextPolicy, ...(overrides.contextPolicy ?? {}) },
    executionPolicy: { ...base.executionPolicy, ...(overrides.executionPolicy ?? {}) },
    metadata: { ...base.metadata, ...(overrides.metadata ?? {}) },
    basePrompt: overrides.basePrompt ?? base.basePrompt
  };
}
