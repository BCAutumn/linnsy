import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { ClockPort } from '../../../../shared/ports.js';
import { systemClock } from '../../../../shared/ports.js';
import type { ConversationRecord, ConversationStorePort } from '../../../../persistence/stores/conversation/conversation-store-port.js';
import type { RunTerminalEvent, SpawnOptions, SpawnResult } from '../run-spawner/types.js';
import type { TaskTrackerPort } from '../../../task/ports/task-tracker-port.js';

import type {
  InternalSubAgentRunInput,
  InternalSubAgentEventPort,
  InternalSubAgentRunner,
  InternalSubAgentRunnerStats
} from './types.js';
import {
  defaultScheduler,
  markFailed,
  persistTranscript,
  readParentConversationId,
  type Scheduler
} from './shared.js';

export interface InternalSubAgentRunSpawnerPort {
  spawnDetached(options: SpawnOptions): Promise<SpawnResult>;
  waitForTerminal(runId: string): Promise<RunTerminalEvent>;
}

export interface CreateInternalSubAgentGraphRunnerOptions {
  taskTracker: TaskTrackerPort;
  conversations: Pick<ConversationStorePort, 'upsert'>;
  spawner: InternalSubAgentRunSpawnerPort | (() => InternalSubAgentRunSpawnerPort);
  maxConcurrency?: number;
  clock?: ClockPort;
  scheduler?: Scheduler;
  childConversationIdFactory?: (taskId: string) => string;
  // 注入后，子 agent 完成时会向前端推一条 subagent.summary 事件（与
  // createLinnsySubagentSummaryFence 注入到 LLM 的内容一一对应——同一份事实的两种表达）。
  events?: InternalSubAgentEventPort;
}

export function createGraphRunner(options: CreateInternalSubAgentGraphRunnerOptions): InternalSubAgentRunner {
  const maxConcurrency = options.maxConcurrency ?? 10;
  const clock = options.clock ?? systemClock;
  const scheduler = options.scheduler ?? defaultScheduler;
  const childConversationIdFactory = options.childConversationIdFactory ?? defaultChildConversationIdFactory;
  let activeCount = 0;
  const queue: InternalSubAgentRunInput[] = [];

  function resolveSpawner(): InternalSubAgentRunSpawnerPort {
    if (typeof options.spawner === 'function') {
      return options.spawner();
    }
    return options.spawner;
  }

  function schedule(input: InternalSubAgentRunInput): void {
    activeCount += 1;
    scheduler(async () => {
      try {
        await executeGraphRun(input, {
          taskTracker: options.taskTracker,
          conversations: options.conversations,
          spawner: resolveSpawner(),
          clock,
          childConversationId: childConversationIdFactory(input.taskId),
          ...(options.events === undefined ? {} : { events: options.events })
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await markFailed(options.taskTracker, input.taskId, message, clock);
      } finally {
        activeCount -= 1;
        scheduleNext();
      }
    });
  }

  function scheduleNext(): void {
    if (activeCount >= maxConcurrency) {
      return;
    }
    const next = queue.shift();
    if (next !== undefined) {
      schedule(next);
    }
  }

  return {
    spawn(input: InternalSubAgentRunInput): void {
      if (activeCount >= maxConcurrency) {
        queue.push(input);
        return;
      }
      schedule(input);
    },
    getStats(): InternalSubAgentRunnerStats {
      return {
        activeCount,
        queuedCount: queue.length,
        maxConcurrency
      };
    }
  };
}

async function executeGraphRun(
  input: InternalSubAgentRunInput,
  options: {
    taskTracker: TaskTrackerPort;
    conversations: Pick<ConversationStorePort, 'upsert'>;
    spawner: InternalSubAgentRunSpawnerPort;
    clock: ClockPort;
    childConversationId: string;
    events?: InternalSubAgentEventPort;
  }
): Promise<void> {
  const parentConversationId = readParentConversationId(input);
  await options.conversations.upsert(createChildConversation({
    input,
    parentConversationId,
    childConversationId: options.childConversationId,
    now: options.clock.now()
  }));
  const runningPayload = await mergedTaskPayload(options.taskTracker, input.taskId, {
    childConversationId: options.childConversationId
  });
  await options.taskTracker.transition(input.taskId, 'in_progress', {
    payload: runningPayload,
    updatedAt: options.clock.now()
  });

  const spawn = await options.spawner.spawnDetached(createSpawnOptions(input, options.childConversationId, parentConversationId));
  const payloadWithRun = await mergedTaskPayload(options.taskTracker, input.taskId, {
    childConversationId: options.childConversationId,
    childRunId: spawn.runId
  });
  await upsertActivePayload(options.taskTracker, input.taskId, payloadWithRun, options.clock);

  const terminal = await options.spawner.waitForTerminal(spawn.runId);
  if (terminal.outcome.status === 'completed') {
    await persistGraphRunSuccess(input, options.taskTracker, terminal, options.clock, options.childConversationId);
    publishCompletedSubagentSummary(input, {
      terminal,
      parentConversationId,
      childConversationId: options.childConversationId,
      now: options.clock.now(),
      ...(options.events === undefined ? {} : { events: options.events })
    });
    return;
  }
  if (terminal.outcome.status === 'cancelled') {
    await options.taskTracker.transition(input.taskId, 'cancelled', {
      result: terminalErrorResult(terminal, options.childConversationId, spawn.runId),
      lastNode: terminal.snapshot?.currentNode ?? 'cancelled',
      cancelledAt: options.clock.now(),
      updatedAt: options.clock.now()
    });
    return;
  }
  await options.taskTracker.transition(input.taskId, 'failed', {
    result: terminalErrorResult(terminal, options.childConversationId, spawn.runId),
    lastNode: terminal.snapshot?.currentNode ?? 'failed',
    updatedAt: options.clock.now()
  });
}

function publishCompletedSubagentSummary(
  input: InternalSubAgentRunInput,
  options: {
    terminal: RunTerminalEvent;
    parentConversationId: string;
    childConversationId: string;
    now: number;
    events?: InternalSubAgentEventPort;
  }
): void {
  const finalAnswer = options.terminal.outcome.finalAnswer ?? '';
  if (options.events !== undefined) {
    options.events.publish({
      kind: 'subagent.summary',
      conversationId: options.parentConversationId,
      ...(input.parentRunId === undefined ? {} : { runId: input.parentRunId }),
      createdAt: options.now,
      payload: {
        taskId: input.taskId,
        childRunId: options.terminal.runId,
        childConversationId: options.childConversationId,
        summary: finalAnswer
      }
    });
  }
}

function createSpawnOptions(
  input: InternalSubAgentRunInput,
  childConversationId: string,
  parentConversationId: string
): SpawnOptions {
  return {
    definitionKey: input.definitionKey,
    conversationId: childConversationId,
    query: buildChildQuery(input),
    ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
    ephemeral: { skipMemory: true, skipContextFiles: true },
    metadata: {
      taskId: input.taskId,
      parentConversationId,
      internalSubAgent: true
    }
  };
}

function createChildConversation(input: {
  input: InternalSubAgentRunInput;
  parentConversationId: string;
  childConversationId: string;
  now: number;
}): ConversationRecord {
  const metadata: Record<string, unknown> = {
    parentConversationId: input.parentConversationId,
    taskId: input.input.taskId,
    definitionKey: input.input.definitionKey
  };
  if (input.input.parentRunId !== undefined) {
    metadata.parentRunId = input.input.parentRunId;
  }
  return {
    conversationId: input.childConversationId,
    sessionKey: `linnsy:internal_subagent:${input.input.taskId}`,
    platform: 'internal_subagent',
    chatType: 'task',
    chatId: input.input.taskId,
    title: input.input.goal,
    createdAt: input.now,
    updatedAt: input.now,
    lastActivityAt: input.now,
    metadata
  };
}

async function persistGraphRunSuccess(
  input: InternalSubAgentRunInput,
  taskTracker: TaskTrackerPort,
  terminal: RunTerminalEvent,
  clock: ClockPort,
  childConversationId: string
): Promise<void> {
  const finalAnswer = terminal.outcome.finalAnswer ?? '';
  const outputPath = await persistResultFile(input, finalAnswer);
  await persistTranscript(input, [
    `definitionKey=${input.definitionKey}`,
    `childConversationId=${childConversationId}`,
    `childRunId=${terminal.runId}`,
    `status=${terminal.outcome.status}`,
    '',
    finalAnswer
  ].join('\n'));
  await taskTracker.transition(input.taskId, 'completed', {
    result: {
      finalAnswer,
      childConversationId,
      childRunId: terminal.runId,
      outputPath
    },
    lastNode: terminal.snapshot?.currentNode ?? terminal.outcome.currentNode ?? 'completed',
    completedAt: clock.now(),
    updatedAt: clock.now()
  });
}

async function upsertActivePayload(
  taskTracker: TaskTrackerPort,
  taskId: string,
  payload: Record<string, unknown>,
  clock: ClockPort
): Promise<void> {
  const task = await taskTracker.get(taskId);
  if (task === null) {
    throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${taskId} was not found`, false);
  }
  await taskTracker.upsert({
    ...task,
    payload,
    updatedAt: clock.now()
  });
}

async function mergedTaskPayload(
  taskTracker: TaskTrackerPort,
  taskId: string,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const task = await taskTracker.get(taskId);
  if (task === null) {
    throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${taskId} was not found`, false);
  }
  return {
    ...(task.payload ?? {}),
    ...patch
  };
}

function terminalErrorResult(
  terminal: RunTerminalEvent,
  childConversationId: string,
  childRunId: string
): Record<string, unknown> {
  return {
    childConversationId,
    childRunId,
    errorMessage: terminal.outcome.error?.message ?? terminal.type
  };
}

function buildChildQuery(input: InternalSubAgentRunInput): string {
  const lines = ['Goal:', input.goal];
  if (input.context !== undefined) {
    lines.push('', 'Explicit context:', input.context);
  }
  return lines.join('\n');
}

async function persistResultFile(input: InternalSubAgentRunInput, finalAnswer: string): Promise<string> {
  const outputsDir = join(input.workspacePath, 'outputs');
  await mkdir(outputsDir, { recursive: true, mode: 0o700 });
  const outputPath = join(outputsDir, 'result.txt');
  await writeFile(outputPath, `${finalAnswer}\n`, { mode: 0o600 });
  return outputPath;
}

function defaultChildConversationIdFactory(taskId: string): string {
  return `conv_internal_${taskId}`;
}
