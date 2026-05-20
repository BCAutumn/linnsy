import type { AgentDefinition } from '../contracts.js';

import { linnsyEchoSubagentPrompt } from './prompt.js';

export const LINNSY_ECHO_SUBAGENT_ID = 'linnsy_echo_subagent';

export function createLinnsyEchoSubagentDefinition(
  overrides: Partial<AgentDefinition> = {}
): AgentDefinition {
  const base: AgentDefinition = {
    id: LINNSY_ECHO_SUBAGENT_ID,
    displayName: 'Linnsy Echo Subagent',
    description: 'Phase 1 mock internal subagent that echoes a goal into the task workspace.',
    systemPromptId: 'linnsy_echo_subagent.system_prompt.v1',
    basePrompt: linnsyEchoSubagentPrompt,
    modelPolicy: { model: 'default' },
    toolPolicy: { allowedToolIds: [] },
    memoryPolicy: {
      includeLongTermMemory: false,
      includeConversationSummary: false
    },
    contextPolicy: {
      // Echo 子 agent 只服务测试和最小闭环，预算应明显小于真实主会话。
      budget: {
        maxTokens: 8_000,
        reservedForResponse: 800,
        workingMemoryBudgetPercentage: 0.5
      },
      toolHistory: { strategy: 'none' },
      workingMemory: {
        minToolInteractionsToKeep: 0,
        maxRecentToolInteractions: 0,
        toolPairingSearchRange: 4
      }
    },
    metadata: { kind: 'internal_subagent' },
    enabled: true
  };

  return {
    ...base,
    ...overrides,
    modelPolicy: { ...base.modelPolicy, ...(overrides.modelPolicy ?? {}) },
    toolPolicy: { ...base.toolPolicy, ...(overrides.toolPolicy ?? {}) },
    memoryPolicy: { ...base.memoryPolicy, ...(overrides.memoryPolicy ?? {}) },
    contextPolicy: { ...base.contextPolicy, ...(overrides.contextPolicy ?? {}) },
    ...(base.executionPolicy === undefined && overrides.executionPolicy === undefined
      ? {}
      : { executionPolicy: { ...(base.executionPolicy ?? {}), ...(overrides.executionPolicy ?? {}) } }),
    metadata: { ...base.metadata, ...(overrides.metadata ?? {}) },
    basePrompt: overrides.basePrompt ?? base.basePrompt
  };
}
