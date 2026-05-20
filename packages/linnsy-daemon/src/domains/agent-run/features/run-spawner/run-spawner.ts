import { randomUUID } from 'node:crypto';

import {
  execution,
  graph,
  runSupervisor
} from '@linnlabs/linnkit/runtime-kernel';
import type { AuditPort } from '@linnlabs/linnkit/ports';

import type { LinnsyAgentRegistryPort } from '../agents/registry/types.js';
import type { AgentDefinition } from '../agents/contracts.js';
import {
  createLinnsyAgentSpec,
  type AgentToolSchemaSource
} from '../agents/linnkit-agent-spec.js';
import type { ConversationStorePort } from '../../../../persistence/stores/conversation/conversation-store-port.js';
import type { SqliteRunRegistryStore } from '../../../../persistence/stores/run/sqlite-run-registry-store.js';
import type { ClockPort, LoggerPort } from '../../../../shared/ports.js';
import { systemClock } from '../../../../shared/ports.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';

import type {
  RunExecutionContext,
  RunExecutorPort,
  RunOutcome,
  RunSnapshot,
  RunSpawnerEventPort,
  RunSpawnerPort,
  RunStatus,
  RunTerminalEvent,
  SpawnOptions,
  SpawnResult
} from './types.js';

type LinnkitMemoryRunRegistryStore = InstanceType<typeof runSupervisor.MemoryRunRegistryStore>;
type LinnkitRunRecord = NonNullable<Awaited<ReturnType<LinnkitMemoryRunRegistryStore['load']>>>;
interface LinnkitRunCost {
  tokensInput: number;
  tokensOutput: number;
  totalCostUsd?: number;
  latencyMs?: number;
  childrenTotal?: LinnkitRunCost;
}
type LinnkitRunCostCollector = {
  snapshot(runId: string): LinnkitRunCost | Promise<LinnkitRunCost>;
};
type LinnkitRunExecutionContext<TRequest extends Readonly<object>> = {
  runId: string;
  parentRunId?: string;
  conversationId: string;
  request: TRequest;
  signal: AbortSignal;
  query?: string;
  contextFences?: readonly unknown[];
  wakeSource?: string;
  ephemeral?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
type LinnkitRunOutcome = {
  runId: string;
  status: Extract<LinnkitRunRecord['status'], 'completed' | 'failed' | 'cancelled'>;
  completedAt: number;
  currentNode?: string;
  iterationsUsed?: number;
  error?: {
    errorCode: string;
    message: string;
    recoverable: boolean;
  };
  metadata?: Record<string, unknown>;
};

interface LinnsyRunRequest extends Readonly<object> {
  definitionKey: string;
  query: string;
  inboundMessageId?: string;
  channelTarget?: SpawnOptions['channelTarget'];
  metadata?: Record<string, unknown>;
  contextFences?: RunExecutionContext['contextFences'];
  wakeSource?: RunExecutionContext['wakeSource'];
  ephemeral?: RunExecutionContext['ephemeral'];
}

export interface CreateLinnsyRunSpawnerOptions {
  registry: LinnsyAgentRegistryPort;
  conversations: ConversationStorePort;
  runRegistry: SqliteRunRegistryStore;
  executor: RunExecutorPort;
  auditPort: AuditPort;
  clock?: ClockPort;
  logger?: LoggerPort;
  runIdFactory?: () => string;
  events?: RunSpawnerEventPort;
  costCollector?: LinnkitRunCostCollector;
  toolSchemaSource?: AgentToolSchemaSource;
  /** Track unfinished runs so `drain()` can await them (default: true). */
  trackInFlight?: boolean;
}

export function createLinnsyRunSpawner(options: CreateLinnsyRunSpawnerOptions): RunSpawnerPort {
  const clock = options.clock ?? systemClock;
  const supervisor = new runSupervisor.DefaultRunSupervisor<LinnsyRunRequest>({
    registryStore: options.runRegistry,
    auditPort: options.auditPort,
    runIdFactory: options.runIdFactory ?? defaultRunIdFactory,
    now: () => clock.now(),
    executor: createSupervisorExecutor(options, clock)
  });
  const eventStore = new graph.MemoryEventStore();
  const costCollector = options.costCollector ?? zeroCostCollector;

  async function spawnDetached(opts: SpawnOptions): Promise<SpawnResult> {
    const definition = options.registry.assertAgent(opts.definitionKey);
    const conversation = await options.conversations.get(opts.conversationId);
    if (conversation === null) {
      throw new LinnsyError(
        LINNSY_ERROR_CODES.SESSION_NOT_FOUND,
        `conversation ${opts.conversationId} not found; spawner refuses to start run`,
        false
      );
    }

    const request = createRunRequest(opts);
    const handle = await supervisor.spawnDetached({
      conversationId: opts.conversationId,
      ...(opts.parentRunId === undefined ? {} : { parentRunId: opts.parentRunId }),
      agentSpec: createLinnsyAgentSpec(definition, {
        ...(options.toolSchemaSource === undefined ? {} : { toolSchemaSource: options.toolSchemaSource })
      }),
      request,
      eventBus: new execution.EventBus(request.definitionKey),
      eventStore,
      costCollector,
      query: opts.query,
      ...(opts.contextFences === undefined ? {} : { contextFences: opts.contextFences }),
      ...(opts.wakeSource === undefined ? {} : { wakeSource: opts.wakeSource }),
      ...(opts.ephemeral === undefined ? {} : { ephemeral: opts.ephemeral }),
      ...(opts.metadata === undefined ? {} : { metadata: opts.metadata })
    });

    if (opts.blocking === true) {
      await supervisor.waitForTerminal(handle.runId);
    }

    return { runId: handle.runId, conversationId: opts.conversationId };
  }

  async function peek(runId: string): Promise<RunSnapshot | null> {
    const record = await options.runRegistry.load(runId);
    return toSnapshot(record);
  }

  async function findActiveByConversation(conversationId: string): Promise<RunSnapshot | null> {
    const activeRuns = await supervisor.findActiveByConversation(conversationId);
    for (const run of activeRuns) {
      const snapshot = await peek(run.runId);
      if (snapshot === null || snapshot.metadata?.internalSubAgent === true) {
        continue;
      }
      return snapshot;
    }
    return null;
  }

  async function cancel(runId: string, cancelOpts?: { forceCleanup?: boolean }): Promise<void> {
    try {
      await supervisor.cancel(runId, {
        reason: 'cancelled by Linnsy host',
        ...(cancelOpts?.forceCleanup === undefined ? {} : { forceCleanup: cancelOpts.forceCleanup })
      });
    } catch (error: unknown) {
      if (!canFallbackCancel(error)) {
        throw error;
      }
      await cancelPersistedRunWithoutHandle(runId, cancelOpts);
    }
  }

  async function cancelPersistedRunWithoutHandle(
    runId: string,
    cancelOpts?: { forceCleanup?: boolean }
  ): Promise<void> {
    const record = await options.runRegistry.load(runId);
    if (record === null) {
      return;
    }
    if (isActiveStatus(record.status) || (cancelOpts?.forceCleanup === true && !isTerminalStatus(record.status))) {
      await saveRunRecord({
        ...record,
        status: 'cancelled',
        updatedAt: clock.now()
      });
      publishStatusChange(options.events, record.conversationId, runId, 'cancelled', clock.now());
    }
  }

  async function waitForTerminal(runId: string): Promise<RunTerminalEvent> {
    const outcome = await supervisor.waitForTerminal(runId);
    const snapshot = await peek(runId);
    return toTerminalEvent(outcome, snapshot);
  }

  async function drain(): Promise<void> {
    if (options.trackInFlight === false) {
      return;
    }

    // drain 用在 daemon stop / 测试清理：run 结束回调可能继续派生 task wake run。
    // DefaultRunSupervisor.drain() 只等待当前 in-flight 快照，所以这里循环到没有新 run。
    let hasMoreInFlightRuns = true;
    while (hasMoreInFlightRuns) {
      const outcomes = await supervisor.drain();
      await flushRunTerminalCallbacks();
      hasMoreInFlightRuns = outcomes.length > 0;
    }
  }

  async function recoverOnBoot(): Promise<{ recovered: number; abandoned: number }> {
    const orphans = await options.runRegistry.list({
      status: ['pending', 'running', 'awaiting_user', 'paused']
    });
    let abandoned = 0;
    for (const record of orphans.runs) {
      await saveRunRecord({
        ...record,
        status: 'failed',
        updatedAt: clock.now(),
        errorIfAny: {
          errorCode: LINNSY_ERROR_CODES.RUN_ABANDONED,
          message: 'run interrupted by daemon restart',
          recoverable: false
        }
      });
      abandoned += 1;
    }
    return { recovered: 0, abandoned };
  }

  async function saveRunRecord(record: LinnkitRunRecord): Promise<void> {
    await options.runRegistry.save(record);
  }

  return {
    spawnDetached,
    peek,
    findActiveByConversation,
    cancel,
    waitForTerminal,
    drain,
    recoverOnBoot
  };
}

function createSupervisorExecutor(
  options: CreateLinnsyRunSpawnerOptions,
  clock: ClockPort
) {
  return {
    async execute(context: LinnkitRunExecutionContext<LinnsyRunRequest>): Promise<LinnkitRunOutcome> {
      publishStatusChange(options.events, context.conversationId, context.runId, 'running', clock.now());
      const definition = options.registry.assertAgent(context.request.definitionKey);
      try {
        const outcome = await options.executor.execute(toRunExecutionContext(context, definition));
        publishStatusChange(options.events, context.conversationId, context.runId, outcome.status, clock.now());
        return toLinnkitOutcome(context.runId, outcome, clock.now());
      } catch (error: unknown) {
        const runError = toRunError(error);
        const status = context.signal.aborted ? 'cancelled' : 'failed';
        publishStatusChange(options.events, context.conversationId, context.runId, status, clock.now());
        return {
          runId: context.runId,
          status,
          completedAt: clock.now(),
          error: {
            errorCode: runError.code,
            message: runError.message,
            recoverable: runError.recoverable
          }
        };
      }
    }
  };
}

function toRunExecutionContext(
  context: LinnkitRunExecutionContext<LinnsyRunRequest>,
  definition: AgentDefinition
): RunExecutionContext {
  return {
    runId: context.runId,
    conversationId: context.conversationId,
    definition,
    query: context.request.query,
    signal: context.signal,
    ...(context.parentRunId === undefined ? {} : { parentRunId: context.parentRunId }),
    ...(context.request.inboundMessageId === undefined ? {} : { inboundMessageId: context.request.inboundMessageId }),
    ...(context.request.channelTarget === undefined ? {} : { channelTarget: context.request.channelTarget }),
    ...(context.metadata === undefined ? {} : { metadata: context.metadata }),
    ...(context.request.contextFences === undefined ? {} : { contextFences: context.request.contextFences }),
    ...(context.request.wakeSource === undefined ? {} : { wakeSource: context.request.wakeSource }),
    ...(context.request.ephemeral === undefined ? {} : { ephemeral: context.request.ephemeral })
  };
}

function createRunRequest(opts: SpawnOptions): LinnsyRunRequest {
  return {
    definitionKey: opts.definitionKey,
    query: opts.query,
    ...(opts.inboundMessageId === undefined ? {} : { inboundMessageId: opts.inboundMessageId }),
    ...(opts.channelTarget === undefined ? {} : { channelTarget: opts.channelTarget }),
    ...(opts.metadata === undefined ? {} : { metadata: opts.metadata }),
    ...(opts.contextFences === undefined ? {} : { contextFences: opts.contextFences }),
    ...(opts.wakeSource === undefined ? {} : { wakeSource: opts.wakeSource }),
    ...(opts.ephemeral === undefined ? {} : { ephemeral: opts.ephemeral })
  };
}

function toLinnkitOutcome(runId: string, outcome: RunOutcome, completedAt: number): LinnkitRunOutcome {
  return {
    runId,
    status: outcome.status,
    completedAt,
    ...(outcome.currentNode === undefined ? {} : { currentNode: outcome.currentNode }),
    ...(outcome.iterationsUsed === undefined ? {} : { iterationsUsed: outcome.iterationsUsed }),
    ...(outcome.error === undefined
      ? {}
      : {
          error: {
            errorCode: outcome.error.code,
            message: outcome.error.message,
            recoverable: outcome.error.recoverable
          }
        }),
    metadata: {
      ...(outcome.metadata ?? {}),
      ...(outcome.finalAnswer === undefined ? {} : { finalAnswer: outcome.finalAnswer })
    }
  };
}

function toTerminalEvent(outcome: LinnkitRunOutcome, snapshot: RunSnapshot | null): RunTerminalEvent {
  const mappedOutcome = toRunOutcome(outcome);
  return {
    runId: outcome.runId,
    type: mappedOutcome.status,
    ...(snapshot === null ? {} : { snapshot }),
    outcome: mappedOutcome
  };
}

function toRunOutcome(outcome: LinnkitRunOutcome): RunOutcome {
  const finalAnswer = readFinalAnswer(outcome.metadata);
  const result: RunOutcome = {
    status: outcome.status,
    ...(outcome.currentNode === undefined ? {} : { currentNode: outcome.currentNode }),
    ...(outcome.iterationsUsed === undefined ? {} : { iterationsUsed: outcome.iterationsUsed }),
    ...(outcome.error === undefined
      ? {}
      : {
          error: {
            code: outcome.error.errorCode,
            message: outcome.error.message,
            recoverable: outcome.error.recoverable
          }
        }),
    ...(outcome.metadata === undefined ? {} : { metadata: outcome.metadata }),
    ...(finalAnswer === undefined ? {} : { finalAnswer })
  };
  return result;
}

function readFinalAnswer(metadata: Record<string, unknown> | undefined): string | undefined {
  const value = metadata?.finalAnswer;
  return typeof value === 'string' ? value : undefined;
}

function isActiveStatus(status: RunStatus): boolean {
  return status === 'pending' || status === 'running' || status === 'awaiting_user' || status === 'paused';
}

function isTerminalStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function defaultRunIdFactory(): string {
  return `run_${randomUUID()}`;
}

function toSnapshot(record: LinnkitRunRecord | null): RunSnapshot | null {
  if (record === null) {
    return null;
  }
  const snapshot: RunSnapshot = {
    runId: record.runId,
    conversationId: record.conversationId,
    status: record.status,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt
  };
  if (record.parentRunId !== undefined) {
    snapshot.parentRunId = record.parentRunId;
  }
  if (record.currentNode !== undefined) {
    snapshot.currentNode = record.currentNode;
  }
  if (record.iterationsUsed !== undefined) {
    snapshot.iterationsUsed = record.iterationsUsed;
  }
  if (record.iterationBudget !== undefined) {
    snapshot.iterationBudget = record.iterationBudget;
  }
  if (record.errorIfAny !== undefined) {
    snapshot.error = {
      code: record.errorIfAny.errorCode,
      message: record.errorIfAny.message,
      recoverable: record.errorIfAny.recoverable
    };
  }
  if (record.metadata !== undefined) {
    snapshot.metadata = record.metadata;
  }
  return snapshot;
}

function toRunError(error: unknown): { code: string; message: string; recoverable: boolean } {
  if (error instanceof LinnsyError) {
    return { code: error.code, message: error.message, recoverable: error.recoverable };
  }
  if (error instanceof Error) {
    return { code: LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED, message: error.message, recoverable: false };
  }
  return { code: LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED, message: String(error), recoverable: false };
}

function canFallbackCancel(error: unknown): boolean {
  return error instanceof Error && error.name === 'RunNotFoundError';
}

function publishStatusChange(
  events: RunSpawnerEventPort | undefined,
  conversationId: string,
  runId: string,
  status: RunStatus,
  updatedAt: number
): void {
  events?.publish({
    kind: 'run.status_change',
    conversationId,
    runId,
    createdAt: updatedAt,
    payload: {
      status,
      updatedAt
    }
  });
}

const zeroCostCollector: LinnkitRunCostCollector = {
  snapshot(): LinnkitRunCost {
    return {
      tokensInput: 0,
      tokensOutput: 0
    };
  }
};

function flushRunTerminalCallbacks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
