import type { FenceInjection } from '@linnlabs/linnkit/context-manager';

import type { AgentDefinition } from '../agents/registry/types.js';
import type { SendTarget } from '../../../../shared/messaging.js';
import type {
  RuntimeEvent,
  RuntimeEventPublishInput,
  RuntimeRunStatus
} from '../../../observability/definitions/runtime-events.js';

export type RunStatus = RuntimeRunStatus;
export type RunWakeSource =
  | 'owner-message'
  | 'system-event'
  | 'subagent-summary'
  | 'user-interjection'
  | 'task-completed';

export interface SpawnOptions {
  definitionKey: string;
  conversationId: string;
  query: string;
  inboundMessageId?: string;
  channelTarget?: SendTarget;
  parentRunId?: string;
  metadata?: Record<string, unknown>;
  contextFences?: FenceInjection[];
  wakeSource?: RunWakeSource;
  ephemeral?: { skipMemory?: boolean; skipContextFiles?: boolean };
  /** Optional: when provided, spawnDetached awaits the executor before resolving. */
  blocking?: boolean;
}

export interface SpawnResult {
  runId: string;
  conversationId: string;
}

export interface RunSnapshot {
  runId: string;
  conversationId: string;
  parentRunId?: string;
  status: RunStatus;
  currentNode?: string;
  iterationsUsed?: number;
  iterationBudget?: { max: number; refundable: boolean };
  error?: { code: string; message: string; recoverable: boolean };
  startedAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface RunOutcome {
  status: 'completed' | 'failed' | 'cancelled';
  finalAnswer?: string;
  currentNode?: string;
  iterationsUsed?: number;
  iterationBudget?: { max: number; refundable: boolean };
  error?: { code: string; message: string; recoverable: boolean };
  metadata?: Record<string, unknown>;
}

export interface RunExecutionContext {
  runId: string;
  conversationId: string;
  parentRunId?: string;
  definition: AgentDefinition;
  query: string;
  signal: AbortSignal;
  inboundMessageId?: string;
  channelTarget?: SendTarget;
  metadata?: Record<string, unknown>;
  contextFences?: FenceInjection[];
  wakeSource?: RunWakeSource;
  ephemeral?: { skipMemory?: boolean; skipContextFiles?: boolean };
}

/**
 * Strategy injected into the spawner that owns the actual GraphExecutor wiring.
 * Phase 1 ships a mock executor; T1.6+ will graduate to a linnkit-backed one.
 */
export interface RunExecutorPort {
  execute(context: RunExecutionContext): Promise<RunOutcome>;
}

export interface RunSpawnerEventPort {
  publish(input: RuntimeEventPublishInput): RuntimeEvent;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
}

export interface RunLifecycleEvent {
  runId: string;
  conversationId: string;
  status: RunStatus;
  updatedAt: number;
}

export interface RunTerminalEvent {
  runId: string;
  type: 'completed' | 'failed' | 'cancelled';
  snapshot?: RunSnapshot;
  outcome: RunOutcome;
}

export interface RunSpawnerPort {
  spawnDetached(opts: SpawnOptions): Promise<SpawnResult>;
  peek(runId: string): Promise<RunSnapshot | null>;
  cancel(runId: string, opts?: { forceCleanup?: boolean }): Promise<void>;
  /** Stable terminal-only wait used by daemon replies and cron notifications. */
  waitForTerminal(runId: string): Promise<RunTerminalEvent>;
  findActiveByConversation?(conversationId: string): Promise<RunSnapshot | null>;
  /** Awaits all in-flight runs; useful for graceful shutdown / tests. */
  drain(): Promise<void>;
  /** Phase 1 stub: marks orphaned runs as abandoned and returns counters. */
  recoverOnBoot(): Promise<{ recovered: number; abandoned: number }>;
}
