import {
  AgentSpec,
  defineContextPolicy,
  type AgentSpecContextPolicyInput
} from '@linnlabs/linnkit/contracts';

import { LINNSY_FENCE_KINDS } from '../context-engineering/fences.js';

import type { AgentDefinition } from './contracts.js';

type LinnsyDefaultContextPolicyInput = AgentSpecContextPolicyInput & { profileId: string };

export interface AgentToolSchemaSource {
  getToolSchemas(toolNames?: string[]): AgentToolSchema[];
}

interface AgentToolSchema {
  function: {
    name: string;
    parameters: Record<string, unknown>;
  };
}

export interface CreateLinnsyAgentSpecOptions {
  toolSchemaSource?: AgentToolSchemaSource;
}

export function createLinnsyAgentSpec(
  definition: AgentDefinition,
  options: CreateLinnsyAgentSpecOptions = {}
): AgentSpec {
  return AgentSpec.parse({
    id: definition.id,
    version: '1',
    role: definition.displayName,
    description: definition.description,
    capabilities: ['linnsy-agent'],
    tools: createToolBindings(definition, options.toolSchemaSource),
    contextPolicy: createLinnsyContextPolicy(definition),
    modelHints: {
      preferredModels: [definition.modelPolicy.model],
      ...(definition.modelPolicy.fallbackChain === undefined
        ? {}
        : { fallbackChain: definition.modelPolicy.fallbackChain })
    },
    metadata: {
      enabled: definition.enabled,
      includeLongTermMemory: definition.memoryPolicy.includeLongTermMemory,
      includeConversationSummary: definition.memoryPolicy.includeConversationSummary,
      ...(definition.metadata ?? {})
    }
  });
}

function createToolBindings(
  definition: AgentDefinition,
  toolSchemaSource: AgentToolSchemaSource | undefined
) {
  if (toolSchemaSource === undefined) {
    return definition.toolPolicy.allowedToolIds.map((toolId) => ({ toolId }));
  }
  const schemasByName = new Map(
    toolSchemaSource.getToolSchemas(definition.toolPolicy.allowedToolIds)
      .map((schema) => [schema.function.name, schema])
  );
  return definition.toolPolicy.allowedToolIds.map((toolId) => {
    const schema = schemasByName.get(toolId);
    if (schema === undefined) {
      return { toolId };
    }
    return {
      toolId,
      argsSchema: schema.function.parameters
    };
  });
}

function createLinnsyContextPolicy(definition: AgentDefinition) {
  return defineContextPolicy(mergeLinnsyContextPolicy(
    createDefaultLinnsyContextPolicy(definition),
    definition.contextPolicy
  ));
}

function createDefaultLinnsyContextPolicy(definition: AgentDefinition): LinnsyDefaultContextPolicyInput {
  return {
    profileId: definition.systemPromptId,
    // 固定工具历史策略，避免 linnkit 默认值变化造成秘书长任务上下文漂移。
    budget: {
      maxTokens: 120_000,
      reservedForResponse: 2_400,
      workingMemoryBudgetPercentage: 0.7
    },
    toolHistory: {
      strategy: 'per-run',
      maxInteractionGroups: 12,
      overflowStrategy: 'keep-latest'
    },
    mustKeep: {
      alwaysKeepFenceKinds: Object.values(LINNSY_FENCE_KINDS),
      truncationRules: [
        {
          fenceKind: LINNSY_FENCE_KINDS.memoryContext,
          maxBudgetFraction: 0.2,
          strategyName: 'linnsy-memory-context-budget'
        }
      ]
    },
    workingMemory: {
      minToolInteractionsToKeep: 2,
      maxRecentToolInteractions: 2,
      toolPairingSearchRange: 10
    },
    // Linnsy 是中文高频产品；先用 0.8.0 的轻量估算入口，不急着绑定 provider 专用 tokenizer。
    tokenEstimation: { avgCharsPerToken: 1.7 }
  };
}

function mergeLinnsyContextPolicy(
  base: LinnsyDefaultContextPolicyInput,
  override: AgentDefinition['contextPolicy']
): AgentSpecContextPolicyInput {
  if (override === undefined) {
    return base;
  }
  return {
    profileId: base.profileId,
    budget: { ...base.budget, ...override.budget },
    toolHistory: { ...base.toolHistory, ...override.toolHistory },
    toolOutput: { ...base.toolOutput, ...override.toolOutput },
    providerReplay: { ...base.providerReplay, ...override.providerReplay },
    summarization: { ...base.summarization, ...override.summarization },
    mustKeep: {
      ...base.mustKeep,
      ...override.mustKeep,
      ...(override.mustKeep?.alwaysKeepTypes === undefined
        ? {}
        : { alwaysKeepTypes: override.mustKeep.alwaysKeepTypes }),
      ...(override.mustKeep?.alwaysKeepFenceKinds === undefined
        ? {}
        : { alwaysKeepFenceKinds: override.mustKeep.alwaysKeepFenceKinds }),
      ...(override.mustKeep?.truncationRules === undefined
        ? {}
        : { truncationRules: override.mustKeep.truncationRules })
    },
    workingMemory: { ...base.workingMemory, ...override.workingMemory },
    checkpoint: { ...base.checkpoint, ...override.checkpoint },
    reasoningRetention: { ...base.reasoningRetention, ...override.reasoningRetention },
    tokenEstimation: { ...base.tokenEstimation, ...override.tokenEstimation },
    systemReminder: { ...base.systemReminder, ...override.systemReminder },
    contextTrace: { ...base.contextTrace, ...override.contextTrace }
  };
}
