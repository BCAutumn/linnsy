import type { AgentDefinition } from './types.js';

export function createDefaultExternalAgentDefinitions(): AgentDefinition[] {
  return [
    createExternalAgentDefinition('delegate_to_codex', 'Codex'),
    createExternalAgentDefinition('delegate_to_cursor', 'Cursor'),
    createExternalAgentDefinition('delegate_to_claude_code', 'Claude Code'),
    createExternalAgentDefinition('delegate_to_linnya', 'Linnya')
  ];
}

function createExternalAgentDefinition(id: string, displayName: string): AgentDefinition {
  return {
    id,
    displayName,
    description: `External delegation adapter for ${displayName}`,
    systemPromptId: `${id}.adapter.v1`,
    basePrompt: `External delegation adapter for ${displayName}.`,
    modelPolicy: { model: 'default' },
    toolPolicy: { allowedToolIds: [] },
    memoryPolicy: {
      includeLongTermMemory: false,
      includeConversationSummary: false
    },
    enabled: true,
    metadata: { kind: 'external_adapter' }
  };
}
