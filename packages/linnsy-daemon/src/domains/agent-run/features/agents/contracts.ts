import type { AgentSpecContextPolicyInput } from '@linnlabs/linnkit/contracts';

export interface AgentDefinition {
  id: string;
  displayName: string;
  description: string;
  systemPromptId: string;
  basePrompt: string;
  modelPolicy: AgentModelPolicy;
  toolPolicy: AgentToolPolicy;
  memoryPolicy: AgentMemoryPolicy;
  contextPolicy?: AgentContextPolicy;
  executionPolicy?: AgentExecutionPolicy;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentModelPolicy {
  model: string;
  fallbackChain?: string[];
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface AgentToolPolicy {
  allowedToolIds: string[];
  approvalRequiredToolIds?: string[];
}

export interface AgentMemoryPolicy {
  includeLongTermMemory: boolean;
  includeConversationSummary: boolean;
}

export interface AgentExecutionPolicy {
  /** 单轮 graph 推理最多允许走多少步。 */
  maxSteps?: number;
}

/**
 * Linnsy 只允许 definition 覆盖具体策略项；profileId 永远来自 systemPromptId。
 * 这样每个 agent 能声明自己的预算、工具历史与可观测策略，但不能绕开提示词身份。
 */
export type AgentContextPolicy = Omit<AgentSpecContextPolicyInput, 'profileId'>;
