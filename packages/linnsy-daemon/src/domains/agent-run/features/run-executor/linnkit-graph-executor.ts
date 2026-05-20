import {
  createDefaultGraphExecutor,
  GraphAgentExecutor,
  type GraphExecutor,
  LlmCaller,
  LlmNode,
  type ToolRuntimePort
} from '@linnlabs/linnkit/runtime-kernel';
import { type FenceRegistry, type agentContracts } from '@linnlabs/linnkit/context-manager';
import type { AuditPort } from '@linnlabs/linnkit/ports';

import type { LoggerPort } from '../../../../shared/ports.js';
import type { LinnsyModelRegistryPort } from '../../../llm/features/model-registry/model-registry.js';
import { getDefaultLinnsyFenceRegistry } from '../context-engineering/fences.js';
import { clearPendingContextFences } from '../context-engineering/pending-interjections.js';
import { runWithLlmRequestDebugScope } from '../../../llm/shared/llm-request-debug-scope.js';
import type { SystemPromptAssemblerPort } from '../system-prompt/types.js';
import { createPolicyScopedToolRuntime } from './policy-scoped-tool-runtime.js';
import type { PolicyScopedToolRuntimePort } from './policy-scoped-tool-runtime.js';
import type { RunExecutorPort, RunOutcome } from '../run-spawner/types.js';
import {
  captureRunContextMessages,
  createRunContextAuditScope,
  runWithRunContextAuditScope
} from './run-context-audit-scope.js';
import type { RunExecutorEventPort, RunExecutorFoundationDeps } from './types.js';
import { readFinalAnswer } from './stream-answer.js';
import {
  createAgentMessageOrchestrator,
  createToolManager,
  toLinnsyAgentInvocationRequest
} from './linnsy-agent-task.js';
import {
  createEmptyToolRuntime,
  createPassthroughObservationPreview
} from './executor-defaults.js';
import {
  createLinnsyModelCatalog,
  createLinnsyModelResolver
} from './linnsy-model-catalog.js';
import {
  serializeRunContextAuditError,
  serializeUnknownError
} from './executor-errors.js';
import { prepareRunInvocation } from './run-invocation.js';

export {
  createStreamCollectorSink,
  readFinalAnswer
} from './stream-answer.js';

export interface CreateLinnkitGraphRunExecutorOptions {
  foundation: RunExecutorFoundationDeps;
  systemPromptAssembler: SystemPromptAssemblerPort;
  logger?: LoggerPort;
  historyLimit?: number;
  toolRuntime?: ToolRuntimePort;
  events?: RunExecutorEventPort;
}

export function createLinnsyGraphExecutor(options: {
  checkpointer: RunExecutorFoundationDeps['checkpointer'];
  aiEngine: RunExecutorFoundationDeps['aiEngine'];
  modelRegistry: LinnsyModelRegistryPort;
  auditPort: AuditPort;
  maxSteps?: number;
  toolRuntime?: ToolRuntimePort;
  fenceRegistry?: FenceRegistry;
}): GraphExecutor {
  const toolRuntime = options.toolRuntime ?? createEmptyToolRuntime();
  const fenceRegistry = options.fenceRegistry ?? getDefaultLinnsyFenceRegistry();
  const modelCatalog = createLinnsyModelCatalog(options.modelRegistry);
  const modelResolver = createLinnsyModelResolver(options.modelRegistry, modelCatalog);
  const llmCaller = new LlmCaller({
    aiEngine: options.aiEngine,
    modelCatalog,
    modelResolver
  });
  const orchestrator = createAgentMessageOrchestrator({
    fenceRegistry,
    toolRuntime
  });
  const reasoner = new GraphAgentExecutor({
    llmCaller,
    toolRuntime,
    contextBuilder: {
      async build(input) {
        const linnsyRequest = toLinnsyAgentInvocationRequest(input.request);
        const request = linnsyRequest as agentContracts.AgentProfileRequest;
        const processingResult = await orchestrator.processAgentConversation(
          request,
          input.history,
          createToolManager(toolRuntime),
          undefined
        );
        captureRunContextMessages({
          modelId: linnsyRequest.model_id ?? 'unknown-model',
          messages: processingResult.messages
        });
        return {
          mode: input.request.mode === 'chat' ? 'chat' : 'agent',
          llmMessages: processingResult.messages,
          summaryEvents: []
        };
      }
    },
    modelCatalog,
    modelResolver,
    auditPort: options.auditPort
  });

  return createDefaultGraphExecutor({
    checkpointer: options.checkpointer,
    llmNode: new LlmNode({ reasoner }),
    toolRuntime,
    observationPreview: createPassthroughObservationPreview(),
    auditPort: options.auditPort,
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps })
  });
}

export function createLinnkitGraphRunExecutor(
  options: CreateLinnkitGraphRunExecutorOptions
): RunExecutorPort {
  const logger = options.logger ?? options.foundation.logger;
  const historyLimit = options.historyLimit;
  const scopedToolRuntime = options.toolRuntime === undefined
    ? undefined
    : createPolicyScopedToolRuntime(options.toolRuntime, {
        ...(options.events === undefined ? {} : { events: options.events })
      });

  return {
    async execute(context): Promise<RunOutcome> {
      const startedAt = options.foundation.clock.now();
      const contextAuditScope = createRunContextAuditScope();
      let runStatus: RunOutcome['status'] = 'failed';
      let currentNode: string | undefined;
      let iterationsUsed: number | undefined;
      let finalAnswer: string | undefined;
      let runError: RunOutcome['error'] | undefined;
      const definitionMaxSteps = context.definition.executionPolicy?.maxSteps;
      const prepared = await prepareRunInvocation({
        context,
        foundation: options.foundation,
        systemPromptAssembler: options.systemPromptAssembler,
        ...(historyLimit === undefined ? {} : { historyLimit }),
        ...(options.events === undefined ? {} : { events: options.events })
      });
      const graphExecutor = createGraphExecutorForRun({
        foundation: options.foundation,
        scopedToolRuntime,
        maxSteps: definitionMaxSteps
      });

      let result: Awaited<ReturnType<typeof graphExecutor.runUntilYield>>;
      try {
        result = await runWithRunToolPolicy(
          scopedToolRuntime,
          context.runId,
          context.definition.toolPolicy.allowedToolIds,
          () => runWithRunContextAuditScope(contextAuditScope, () => {
            return runWithLlmRequestDebugScope({
              runId: context.runId,
              conversationId: context.conversationId,
              turnId: prepared.turnId
            }, async () => {
              await graphExecutor.prime(context.conversationId, prepared.local, 'user');
              return graphExecutor.runUntilYield(context.conversationId);
            });
          })
        );
        finalAnswer = readFinalAnswer(result.events, result.checkpoint.local);
        currentNode = result.checkpoint.nodeId;
        iterationsUsed = result.stepCount;
        runStatus = 'completed';

        logger.info('linnkit graph executor completed run', {
          runId: context.runId,
          conversationId: context.conversationId,
          stepCount: result.stepCount,
          hasFinalAnswer: finalAnswer !== undefined
        });

        return {
          status: 'completed',
          currentNode,
          iterationsUsed,
          ...(finalAnswer === undefined ? {} : { finalAnswer })
        };
      } catch (error: unknown) {
        runStatus = context.signal.aborted ? 'cancelled' : 'failed';
        runError = serializeRunContextAuditError(error, runStatus);
        throw error;
      } finally {
        clearPendingContextFences(context.runId);
        await options.foundation.runContextAudit.recordRunContext({
          runId: context.runId,
          conversationId: context.conversationId,
          turnId: prepared.turnId,
          query: context.query,
          status: runStatus,
          ...(currentNode === undefined ? {} : { currentNode }),
          ...(iterationsUsed === undefined ? {} : { iterationsUsed }),
          ...(finalAnswer === undefined ? {} : { finalAnswer }),
          ...(runError === undefined ? {} : { error: runError }),
          ...(context.wakeSource === undefined ? {} : { wakeSource: context.wakeSource }),
          contextFenceCount: prepared.contextFenceCount,
          startedAt,
          completedAt: options.foundation.clock.now(),
          snapshots: contextAuditScope.snapshots()
        }).catch((error: unknown) => {
          logger.error('run context audit write failed', {
            runId: context.runId,
            conversationId: context.conversationId,
            error: serializeUnknownError(error)
          });
        });
      }
    }
  };
}

function runWithRunToolPolicy<T>(
  scopedToolRuntime: PolicyScopedToolRuntimePort | undefined,
  runId: string,
  toolIds: readonly string[],
  action: () => Promise<T>
): Promise<T> {
  if (scopedToolRuntime === undefined) {
    return action();
  }
  return scopedToolRuntime.runWithAllowedToolIdsForRun(runId, toolIds, action);
}

function createGraphExecutorForRun(options: {
  foundation: RunExecutorFoundationDeps;
  scopedToolRuntime: PolicyScopedToolRuntimePort | undefined;
  maxSteps: number | undefined;
}): GraphExecutor {
  if (options.scopedToolRuntime === undefined && options.maxSteps === undefined) {
    return options.foundation.graphExecutor;
  }

  return createLinnsyGraphExecutor({
    checkpointer: options.foundation.checkpointer,
    aiEngine: options.foundation.aiEngine,
    modelRegistry: options.foundation.modelRegistry,
    auditPort: options.foundation.auditPort,
    ...(options.scopedToolRuntime === undefined ? {} : { toolRuntime: options.scopedToolRuntime }),
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps })
  });
}
