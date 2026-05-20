import {
  createSystemMessage,
  createUserMessage,
  type AgentSpecContextPolicy,
  type AiMessage
} from '@linnlabs/linnkit/contracts';
import {
  agentContext,
  agentOrchestration,
  agentTools,
  contextPolicyToMustKeepPolicy,
  type FenceInjection,
  type FenceRegistry,
  DEFAULT_MUST_KEEP_POLICY,
  type MustKeepPolicy,
  type agentTasks,
  type agentContracts
} from '@linnlabs/linnkit/context-manager';
import type { AgentInvocationRequest } from '@linnlabs/linnkit/ports';
import type { ToolRuntimePort } from '@linnlabs/linnkit/runtime-kernel';

import { isRecord } from '../../../../shared/json.js';
import { LINNSY_FENCE_KINDS } from '../context-engineering/fences.js';
import { consumePendingContextFences } from '../context-engineering/pending-interjections.js';
import type { RunWakeSource } from '../run-spawner/types.js';
import {
  createUserRequestMessage,
  shouldAppendCurrentUserRequest
} from './conversation-history.js';

export interface LinnsyAgentInvocationRequest extends AgentInvocationRequest {
  systemPrompt: string;
  runId?: string;
  fences?: FenceInjection[];
  wakeSource?: RunWakeSource;
  contextPolicy?: AgentSpecContextPolicy;
}

export function createAgentMessageOrchestrator(input: {
  fenceRegistry: FenceRegistry;
  toolRuntime: ToolRuntimePort;
}): agentOrchestration.AgentMessageOrchestrator {
  const providerRegistry = new agentContext.ContextProviderRegistry();
  providerRegistry.register(new agentContext.AgentCoreContextProvider({
    mustKeepPolicy: createLinnsyMustKeepPolicy()
  }));
  providerRegistry.register(new agentContext.AgentWorkingMemoryProvider());

  const task = new LinnsyAgentTask(input.fenceRegistry);
  return new agentOrchestration.AgentMessageOrchestrator({
    tokenBudget: { maxTokens: 32_000, reservedForResponse: 4_000 },
    processing: { debugMode: false, preserveMetadata: true },
    resolveContextPolicy(request) {
      return toLinnsyAgentInvocationRequest(request).contextPolicy;
    },
    createProviderRegistry({ contextPolicy, contextBuilderConfig }) {
      const registry = new agentContext.ContextProviderRegistry();
      registry.register(new agentContext.AgentCoreContextProvider({
        mustKeepPolicy: resolveLinnsyMustKeepPolicy(contextPolicy)
      }));
      registry.register(new agentContext.AgentWorkingMemoryProvider(contextBuilderConfig));
      return registry;
    },
    taskResolver: () => task,
    providerRegistry,
    fenceRegistry: input.fenceRegistry
  });
}

export function toLinnsyAgentInvocationRequest(request: unknown): LinnsyAgentInvocationRequest {
  if (!isLinnsyAgentInvocationRequest(request)) {
    throw new Error('Linnsy agent request requires systemPrompt');
  }
  return request;
}

function createLinnsyMustKeepPolicy(): MustKeepPolicy {
  return {
    ...DEFAULT_MUST_KEEP_POLICY,
    alwaysKeepFenceKinds: [
      ...DEFAULT_MUST_KEEP_POLICY.alwaysKeepFenceKinds,
      ...Object.values(LINNSY_FENCE_KINDS)
    ]
  };
}

function isLinnsyAgentInvocationRequest(value: unknown): value is LinnsyAgentInvocationRequest {
  return isRecord(value) &&
    typeof value.query === 'string' &&
    typeof value.promptKey === 'string' &&
    typeof value.systemPrompt === 'string' &&
    (value.contextPolicy === undefined || isRecord(value.contextPolicy)) &&
    (value.runId === undefined || typeof value.runId === 'string') &&
    (value.fences === undefined || (Array.isArray(value.fences) && value.fences.every(isFenceInjection)));
}

function resolveLinnsyMustKeepPolicy(contextPolicy: AgentSpecContextPolicy | undefined): MustKeepPolicy {
  return contextPolicyToMustKeepPolicy(contextPolicy) ?? createLinnsyMustKeepPolicy();
}

class LinnsyAgentTask implements agentTasks.IAgentTask {
  public readonly name = 'linnsy-agent';

  public constructor(private readonly fenceRegistry: FenceRegistry) {}

  public buildMessages(request: agentContracts.AgentProfileRequest, history: AiMessage[]): AiMessage[] {
    const linnsyRequest = toLinnsyAgentInvocationRequest(request);
    const messages: AiMessage[] = [
      createSystemMessage('system_prompt', linnsyRequest.systemPrompt)
    ];
    const persistedHistory = linnsyRequest.conversationHistory ?? [];
    const shouldAppendCurrentRequest = shouldAppendCurrentUserRequest(linnsyRequest.wakeSource);
    const currentUserRequest = shouldAppendCurrentRequest
      ? readCurrentUserRequestMessage(persistedHistory, linnsyRequest.query) ?? createUserRequestMessage(linnsyRequest.query)
      : undefined;
    const persistedHistoryBeforeCurrent = persistedHistory.filter((message, index, allMessages) => {
      return shouldKeepPersistedHistoryMessage(message, linnsyRequest.query, index, allMessages);
    });
    const fences = linnsyRequest.runId === undefined
      ? (linnsyRequest.fences ?? [])
      : [...(linnsyRequest.fences ?? []), ...consumePendingContextFences(linnsyRequest.runId)];
    const beforeCurrent = createFenceMessages(fences, this.fenceRegistry, 'before-current-user');
    const afterCurrent = createFenceMessages(fences, this.fenceRegistry, 'after-current-user');
    const afterTool = createFenceMessages(fences, this.fenceRegistry, 'after-last-tool-result');
    const runHistoryWithToolFences = insertAfterLastToolResult(history, afterTool);

    // 当前 user 侧请求块是本轮起点，不是每次工具结果之后的新催促。
    // graph 工具循环会反复重建上下文，所以这里必须把整块固定在 run-local 工具历史之前。
    messages.push(...persistedHistoryBeforeCurrent);
    messages.push(...beforeCurrent);
    if (currentUserRequest !== undefined) {
      messages.push(currentUserRequest);
    }
    messages.push(...afterCurrent);
    messages.push(...runHistoryWithToolFences);
    return messages;
  }

  public processResponse(rawResponse: string): string {
    return rawResponse;
  }

  public processStreamChunk(chunk: string): string {
    return chunk;
  }
}

export function createToolManager(toolRuntime: ToolRuntimePort): agentTools.ToolManager {
  return new agentTools.ToolManager({
    getAvailableToolNames(context) {
      void context;
      return toolRuntime.getToolSchemas().map((schema) => schema.function.name);
    },
    validateToolCall(toolName, args) {
      void args;
      return toolRuntime.getToolDefinition(toolName) === undefined
        ? { success: false, error: `Tool ${toolName} is not registered` }
        : { success: true };
    },
    getTool(toolName) {
      void toolName;
      return undefined;
    }
  });
}

function shouldKeepPersistedHistoryMessage(
  message: AiMessage,
  query: string,
  index: number,
  allMessages: AiMessage[]
): boolean {
  if (message.role === 'system') {
    return false;
  }
  if (isLastUserMessageForQuery(message, query, index, allMessages)) {
    return false;
  }
  return true;
}

function readCurrentUserRequestMessage(history: AiMessage[], query: string): AiMessage | undefined {
  const lastIndex = history.length - 1;
  const message = history[lastIndex];
  // 只复用已经围栏化的当前请求；裸 user 消息会在正确位置重新包装为 <user_request>。
  if (
    message === undefined ||
    !isLastUserMessageForQuery(message, query, lastIndex, history) ||
    !hasUserRequestFenceMetadata(message)
  ) {
    return undefined;
  }
  return message;
}

function isLastUserMessageForQuery(
  message: AiMessage,
  query: string,
  index: number,
  allMessages: AiMessage[]
): boolean {
  return index === allMessages.length - 1 &&
    isAiMessageWithContent(message) &&
    message.role === 'user' &&
    message.content === query;
}

function hasUserRequestFenceMetadata(message: AiMessage): boolean {
  if (!isRecord(message)) {
    return false;
  }
  const metadata = message.metadata;
  return isRecord(metadata) && metadata.fenceKind === LINNSY_FENCE_KINDS.userRequest;
}

function isAiMessageWithContent(message: AiMessage): message is AiMessage & { content: string; role: string } {
  return isRecord(message) && typeof message.content === 'string' && typeof message.role === 'string';
}

function createFenceMessages(
  fences: FenceInjection[],
  registry: FenceRegistry,
  placement: 'before-current-user' | 'after-current-user' | 'after-last-tool-result'
): AiMessage[] {
  const messages: AiMessage[] = [];
  for (const fence of fences) {
    const descriptor = registry.get(fence.kind);
    if (descriptor === undefined || descriptor.placement !== placement) {
      continue;
    }
    const metadata = {
      ...(fence.metadata ?? {}),
      fenceKind: fence.kind,
      fenceAttrs: fence.attrs ?? {},
      fencePlacement: descriptor.placement
    };
    messages.push(
      descriptor.llmRole === 'system'
        ? createSystemMessage('context_injection', fence.content, metadata)
        : createUserMessage('context_injection', fence.content, metadata)
    );
  }
  return messages;
}

function insertAfterLastToolResult(history: AiMessage[], insertions: AiMessage[]): AiMessage[] {
  if (insertions.length === 0) {
    return history;
  }
  const result = [...history];
  for (let index = result.length - 1; index >= 0; index -= 1) {
    if (result[index]?.role === 'tool') {
      result.splice(index + 1, 0, ...insertions);
      return result;
    }
  }
  return [...result, ...insertions];
}

function isFenceInjection(value: unknown): value is FenceInjection {
  return isRecord(value) &&
    typeof value.kind === 'string' &&
    typeof value.content === 'string';
}
