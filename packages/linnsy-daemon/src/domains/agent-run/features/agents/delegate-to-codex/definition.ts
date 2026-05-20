import type { AgentDefinition } from '../contracts.js';

import { delegateToCodexPrompt } from './prompt.js';

export const DELEGATE_TO_CODEX_AGENT_ID = 'delegate_to_codex';

export function createDelegateToCodexDefinition(
  overrides: Partial<AgentDefinition> = {}
): AgentDefinition {
  const base: AgentDefinition = {
    id: DELEGATE_TO_CODEX_AGENT_ID,
    displayName: 'Codex',
    description: 'External Codex delegation adapter metadata',
    systemPromptId: 'delegate_to_codex.adapter.v1',
    basePrompt: delegateToCodexPrompt,
    modelPolicy: { model: 'default' },
    toolPolicy: { allowedToolIds: [] },
    memoryPolicy: {
      includeLongTermMemory: false,
      includeConversationSummary: false
    },
    enabled: true,
    metadata: {
      kind: 'external_adapter',
      vendor: 'codex',
      transport: 'codex_exec',
      defaultSandbox: 'workspace-write',
      requiresGitRepo: false
    }
  };

  return {
    ...base,
    ...overrides,
    modelPolicy: { ...base.modelPolicy, ...(overrides.modelPolicy ?? {}) },
    toolPolicy: { ...base.toolPolicy, ...(overrides.toolPolicy ?? {}) },
    memoryPolicy: { ...base.memoryPolicy, ...(overrides.memoryPolicy ?? {}) },
    metadata: { ...(base.metadata ?? {}), ...(overrides.metadata ?? {}) },
    basePrompt: overrides.basePrompt ?? base.basePrompt
  };
}
