import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import type { FenceInjection } from '@linnlabs/linnkit/context-manager';
import { createUserInputEvent } from '@linnlabs/linnkit/contracts';

import {
  readMemoryRecall,
  type MemoryRecallSnapshot
} from '../../../memory/features/recall/functions/memory-recall.js';
import {
  createSystemPromptShapingInput,
  shapeMemoryForSystemPrompt
} from '../../../memory/features/prompt-shaping/functions/memory-shaping.js';
import { LINNSY_MAIN_AGENT_ID } from '../agents/index.js';
import { createLinnsyMemoryContextFence } from '../context-engineering/fences.js';
import { createCurrentTimeTurnContextFence } from '../context-engineering/turn-context.js';
import type { SystemPromptAssemblerPort } from '../system-prompt/types.js';
import { DEFAULT_SHAPING_VERSION } from '../system-prompt/system-prompt-assembler.js';
import type { RunExecutionContext } from '../run-spawner/types.js';

import type { RunExecutorEventPort, RunExecutorFoundationDeps } from './types.js';
import { createStreamCollectorSink } from './stream-answer.js';
import {
  buildConversationHistory,
  shouldAppendCurrentUserRequest
} from './conversation-history.js';
import type { LinnsyAgentInvocationRequest } from './linnsy-agent-task.js';
import { resolveDefinitionModelId } from './linnsy-model-catalog.js';

export interface PreparedRunInvocation {
  modelId: string;
  turnId: string;
  contextFenceCount: number;
  local: Record<string, unknown>;
}

export async function prepareRunInvocation(input: {
  context: RunExecutionContext;
  foundation: RunExecutorFoundationDeps;
  systemPromptAssembler: SystemPromptAssemblerPort;
  historyLimit: number;
  events?: RunExecutorEventPort;
}): Promise<PreparedRunInvocation> {
  // 这里是单次 run 的“入场材料”边界：准备模型能看到的输入，但不执行 graph。
  const modelId = resolveDefinitionModelId(
    input.foundation.modelRegistry,
    input.context.definition.modelPolicy.model
  );
  const definitionMaxSteps = input.context.definition.executionPolicy?.maxSteps;
  const memoryRecall = await readMemoryRecall({
    memoryStore: input.foundation.memoryStore,
    includeLongTermMemory: input.context.definition.id === LINNSY_MAIN_AGENT_ID
      && input.context.definition.memoryPolicy.includeLongTermMemory,
    query: input.context.query,
    ...(input.context.ephemeral?.skipMemory === undefined
      ? {}
      : { skipMemory: input.context.ephemeral.skipMemory })
  });
  const memoryShape = shapeMemoryForSystemPrompt(memoryRecall);
  const systemPrompt = input.systemPromptAssembler.assemble({
    definition: input.context.definition,
    conversationId: input.context.conversationId,
    ...(memoryShape.shapingVersionSuffix === undefined
      ? {}
      : { shapingVersion: `${DEFAULT_SHAPING_VERSION}.memory:${memoryShape.shapingVersionSuffix}` }),
    ...createSystemPromptShapingInput(memoryShape)
  }).systemPrompt;
  const contextFences = [
    createCurrentTimeTurnContextFence(input.foundation.clock),
    ...createMemoryContextFences(memoryRecall),
    ...(input.context.contextFences ?? [])
  ];
  const conversationHistory = await buildConversationHistory({
    foundation: input.foundation,
    conversationId: input.context.conversationId,
    systemPrompt,
    query: input.context.query,
    limit: input.historyLimit,
    skipStoredMessages: input.context.ephemeral?.skipMemory === true,
    includeCurrentUserRequest: shouldAppendCurrentUserRequest(input.context.wakeSource)
  });
  const turnId = input.context.inboundMessageId ?? input.context.runId;
  const request: LinnsyAgentInvocationRequest = {
    query: input.context.query,
    promptKey: input.context.definition.systemPromptId,
    model_id: modelId,
    mode: 'agent',
    enableTools: input.context.definition.toolPolicy.allowedToolIds.length > 0,
    availableTools: [...input.context.definition.toolPolicy.allowedToolIds],
    conversationHistory,
    systemPrompt,
    runId: input.context.runId,
    ...(input.context.wakeSource === undefined ? {} : { wakeSource: input.context.wakeSource }),
    ...(definitionMaxSteps === undefined ? {} : { maxSteps: definitionMaxSteps }),
    ...(contextFences.length === 0 ? {} : { fences: contextFences })
  };
  const toolContext: ToolExecutionContext = {
    runId: input.context.runId,
    conversationId: input.context.conversationId,
    turnId,
    abortSignal: input.context.signal,
    user_query: input.context.query,
    modelId
  };

  return {
    modelId,
    turnId,
    contextFenceCount: contextFences.length,
    local: {
      conversationId: input.context.conversationId,
      turnId,
      request,
      toolContext,
      history: [],
      sseSink: createStreamCollectorSink({
        conversationId: input.context.conversationId,
        turnId,
        runId: input.context.runId,
        ...(input.events === undefined ? {} : { events: input.events })
      }),
      newEvents: [
        createUserInputEvent(
          `user_${turnId}`,
          input.context.conversationId,
          turnId,
          input.context.query,
          {
            source: input.context.wakeSource === undefined || input.context.wakeSource === 'owner-message'
              ? 'user'
              : 'system',
            ...(input.context.wakeSource === undefined
              ? {}
              : { metadata: { wakeSource: input.context.wakeSource } })
          }
        )
      ],
      signal: input.context.signal,
      executorLocal: {
        stepCount: 0
      }
    }
  };
}

function createMemoryContextFences(memoryRecall: MemoryRecallSnapshot): FenceInjection[] {
  if (memoryRecall.turnMemoryContext === undefined) {
    return [];
  }
  return [
    createLinnsyMemoryContextFence(
      memoryRecall.turnMemoryContext.body,
      memoryRecall.turnMemoryContext.metadata
    )
  ];
}
