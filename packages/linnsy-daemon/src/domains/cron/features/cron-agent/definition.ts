import type { AgentDefinition } from '../../../agent-run/features/agents/contracts.js';

import { linnsyCronRunnerPrompt } from './prompt.js';

export const LINNSY_CRON_RUNNER_ID = 'linnsy_cron_runner';

export function createLinnsyCronRunnerDefinition(
  overrides: Partial<AgentDefinition> = {}
): AgentDefinition {
  const base: AgentDefinition = {
    id: LINNSY_CRON_RUNNER_ID,
    displayName: 'Linnsy Cron Runner',
    description: 'Phase 1 cron execution agent for scheduled reminders and summaries.',
    systemPromptId: 'linnsy_cron_runner.system_prompt.v1',
    basePrompt: linnsyCronRunnerPrompt,
    modelPolicy: { model: 'cron_summary' },
    toolPolicy: { allowedToolIds: [] },
    memoryPolicy: {
      includeLongTermMemory: false,
      includeConversationSummary: false
    },
    contextPolicy: {
      // Cron agent 负责短提醒/短总结，不保留工具历史，避免周期任务吃掉常驻预算。
      budget: {
        maxTokens: 16_000,
        reservedForResponse: 1_200,
        workingMemoryBudgetPercentage: 0.5
      },
      toolHistory: { strategy: 'none' },
      workingMemory: {
        minToolInteractionsToKeep: 0,
        maxRecentToolInteractions: 0,
        toolPairingSearchRange: 4
      }
    },
    metadata: { kind: 'cron' },
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
