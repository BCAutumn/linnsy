import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTaskStore } from '../../../../task/persistence/sqlite-task-store.js';
import type { RunTerminalEvent, SpawnOptions, SpawnResult } from '../../run-spawner/types.js';
import { createTaskTracker } from '../../../../task/features/tracker/task-tracker.js';
import { createWorkspaceManager } from '../../../../task/features/workspace/workspace-manager.js';
import { createInternalSubAgentRunner } from '../runner.js';
import type { InternalSubAgentSummaryEventInput } from '../types.js';
import type { RuntimeEvent } from '../../../../observability/definitions/runtime-events.js';

interface Fixture {
  home: string;
  db: Database.Database;
  conversations: SqliteConversationStore;
  tracker: ReturnType<typeof createTaskTracker>;
  workspaceRoot: string;
}

interface PendingTerminal {
  runId: string;
  resolve(event: RunTerminalEvent): void;
}

class FakeRunSpawner {
  public readonly spawned: SpawnOptions[] = [];
  private readonly pending: PendingTerminal[] = [];
  private nextRunNumber = 0;

  public spawnDetached(options: SpawnOptions): Promise<SpawnResult> {
    this.nextRunNumber += 1;
    this.spawned.push(options);
    return Promise.resolve({
      runId: `run_child_${this.nextRunNumber.toString()}`,
      conversationId: options.conversationId
    });
  }

  public waitForTerminal(runId: string): Promise<RunTerminalEvent> {
    return new Promise((resolve) => {
      this.pending.push({ runId, resolve });
    });
  }

  public pendingCount(): number {
    return this.pending.length;
  }

  public completeNext(finalAnswer: string): void {
    this.finishNext({
      status: 'completed',
      finalAnswer,
      currentNode: 'final'
    });
  }

  public failNext(message: string): void {
    this.finishNext({
      status: 'failed',
      error: { code: 'TEST_CHILD_FAILED', message, recoverable: false }
    }, 'failed');
  }

  public cancelNext(message: string): void {
    this.finishNext({
      status: 'cancelled',
      error: { code: 'TEST_CHILD_CANCELLED', message, recoverable: false }
    }, 'cancelled');
  }

  private finishNext(outcome: RunTerminalEvent['outcome'], type: RunTerminalEvent['type'] = outcome.status): void {
    const pending = this.pending.shift();
    if (pending === undefined) {
      throw new Error('no pending child run');
    }
    pending.resolve({
      runId: pending.runId,
      type,
      outcome
    });
  }
}

class CapturingInternalSubAgentEvents {
  public readonly events: RuntimeEvent[] = [];
  private seq = 0;

  public publish(input: InternalSubAgentSummaryEventInput): RuntimeEvent {
    this.seq += 1;
    const event: RuntimeEvent = {
      eventId: `evt_${this.seq.toString()}`,
      seq: this.seq,
      kind: 'subagent.summary',
      createdAt: input.createdAt ?? 1_000 + this.seq,
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      payload: input.payload
    };
    this.events.push(event);
    return event;
  }
}

const fixtures: Fixture[] = [];

async function setup(): Promise<Fixture> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const tasks = new SqliteTaskStore(db);
  const tracker = createTaskTracker({ tasks, clock: { now: () => 1_000 } });
  const workspaceRoot = join(home, 'workspaces');

  await conversations.upsert({
    conversationId: 'conv_parent',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 100,
    updatedAt: 100
  });

  const fixture = { home, db, conversations, tracker, workspaceRoot };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) {
      fixture.db.close();
      await rm(fixture.home, { recursive: true, force: true });
    }
  }
});

describe('InternalSubAgentRunner', () => {
  test('runs an internal subagent through the registered run spawner and persists the final answer', async () => {
    const fixture = await setup();
    const spawner = new FakeRunSpawner();
    const callbacks: Array<() => Promise<void>> = [];
    const events = new CapturingInternalSubAgentEvents();
    const workspacePath = await createWorkspaceManager({ root: fixture.workspaceRoot }).create('task_1');
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_parent',
      title: 'Summarize the owner note',
      status: 'dispatched',
      kind: 'internal_subagent',
      workspacePath,
      payload: {
        definitionKey: 'linnsy_general_subagent',
        goal: 'Summarize the owner note',
        context: 'Owner prefers concise answers.'
      }
    });

    const runner = createInternalSubAgentRunner({
      taskTracker: fixture.tracker,
      conversations: fixture.conversations,
      spawner,
      maxConcurrency: 10,
      scheduler: (callback) => callbacks.push(callback),
      childConversationIdFactory: (taskId) => `conv_child_${taskId}`,
      events
    });

    runner.spawn({
      taskId: 'task_1',
      definitionKey: 'linnsy_general_subagent',
      goal: 'Summarize the owner note',
      context: 'Owner prefers concise answers.',
      workspacePath,
      parentConversationId: 'conv_parent',
      parentRunId: 'run_parent'
    });

    expect(callbacks).toHaveLength(1);
    const running = callbacks[0]?.();
    await waitForSpawnCount(spawner, 1);
    expect(spawner.spawned[0]).toMatchObject({
      definitionKey: 'linnsy_general_subagent',
      conversationId: 'conv_child_task_1',
      parentRunId: 'run_parent',
      ephemeral: { skipMemory: true, skipContextFiles: true },
      metadata: {
        taskId: 'task_1',
        parentConversationId: 'conv_parent',
        internalSubAgent: true
      }
    });
    expect(spawner.spawned[0]?.query).toContain('Summarize the owner note');

    await waitForPendingCount(spawner, 1);
    spawner.completeNext('Concise summary');
    await running;

    expect(spawner.spawned).toHaveLength(1);
    expect(events.events).toContainEqual(expect.objectContaining({
      kind: 'subagent.summary',
      conversationId: 'conv_parent',
      runId: 'run_parent',
      payload: {
        taskId: 'task_1',
        childRunId: 'run_child_1',
        childConversationId: 'conv_child_task_1',
        summary: 'Concise summary'
      }
    }));

    await expect(fixture.conversations.get('conv_child_task_1')).resolves.toMatchObject({
      conversationId: 'conv_child_task_1',
      platform: 'internal_subagent',
      chatType: 'task',
      chatId: 'task_1',
      metadata: {
        parentConversationId: 'conv_parent',
        parentRunId: 'run_parent',
        taskId: 'task_1',
        definitionKey: 'linnsy_general_subagent'
      }
    });
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      status: 'completed',
      lastNode: 'final',
      result: {
        finalAnswer: 'Concise summary',
        childConversationId: 'conv_child_task_1',
        childRunId: 'run_child_1',
        outputPath: join(workspacePath, 'outputs', 'result.txt')
      }
    });
    await expect(readFile(join(workspacePath, 'outputs', 'result.txt'), 'utf8'))
      .resolves.toBe('Concise summary\n');
  });

  test.each([
    {
      terminal: 'failed' as const,
      finish: (spawner: FakeRunSpawner) => {
        spawner.failNext('child exploded');
      }
    },
    {
      terminal: 'cancelled' as const,
      finish: (spawner: FakeRunSpawner) => {
        spawner.cancelNext('owner stopped it');
      }
    }
  ])('transitions the parent task when graph child run is $terminal', async ({ terminal, finish }) => {
    const fixture = await setup();
    const spawner = new FakeRunSpawner();
    const callbacks: Array<() => Promise<void>> = [];
    const workspacePath = await createWorkspaceManager({ root: fixture.workspaceRoot }).create('task_terminal');
    await fixture.tracker.upsert({
      taskId: 'task_terminal',
      conversationId: 'conv_parent',
      title: 'Terminal child',
      status: 'dispatched',
      kind: 'internal_subagent',
      workspacePath,
      payload: {
        definitionKey: 'linnsy_general_subagent',
        goal: 'Terminal child'
      }
    });
    const runner = createInternalSubAgentRunner({
      taskTracker: fixture.tracker,
      conversations: fixture.conversations,
      spawner,
      scheduler: (callback) => callbacks.push(callback),
      childConversationIdFactory: (taskId) => `conv_child_${taskId}`
    });

    runner.spawn({
      taskId: 'task_terminal',
      definitionKey: 'linnsy_general_subagent',
      goal: 'Terminal child',
      workspacePath,
      parentConversationId: 'conv_parent'
    });
    const running = callbacks[0]?.();
    await waitForSpawnCount(spawner, 1);
    await waitForPendingCount(spawner, 1);
    finish(spawner);
    await running;

    expect(spawner.spawned).toHaveLength(1);
    await expect(fixture.tracker.get('task_terminal')).resolves.toMatchObject({
      status: terminal,
      result: {
        childConversationId: 'conv_child_task_terminal',
        childRunId: 'run_child_1'
      }
    });
  });

  test('keeps ten child agents active and queues the eleventh without rejecting it', async () => {
    const fixture = await setup();
    const spawner = new FakeRunSpawner();
    const callbacks: Array<() => Promise<void>> = [];
    const workspace = createWorkspaceManager({ root: fixture.workspaceRoot });
    const runner = createInternalSubAgentRunner({
      taskTracker: fixture.tracker,
      conversations: fixture.conversations,
      spawner,
      maxConcurrency: 10,
      scheduler: (callback) => callbacks.push(callback),
      childConversationIdFactory: (taskId) => `conv_child_${taskId}`
    });

    for (let index = 1; index <= 11; index += 1) {
      const taskId = `task_${index.toString()}`;
      const workspacePath = await workspace.create(taskId);
      await fixture.tracker.upsert({
        taskId,
        conversationId: 'conv_parent',
        title: `task ${index.toString()}`,
        status: 'dispatched',
        kind: 'internal_subagent',
        workspacePath,
        payload: {
          definitionKey: 'linnsy_general_subagent',
          goal: `task ${index.toString()}`
        }
      });
      runner.spawn({
        taskId,
        definitionKey: 'linnsy_general_subagent',
        goal: `task ${index.toString()}`,
        workspacePath,
        parentConversationId: 'conv_parent'
      });
    }

    expect(callbacks).toHaveLength(10);
    expect(runner.getStats()).toEqual({
      activeCount: 10,
      queuedCount: 1,
      maxConcurrency: 10
    });

    const firstRun = callbacks[0]?.();
    await waitForSpawnCount(spawner, 1);
    expect(spawner.spawned).toHaveLength(1);

    await waitForPendingCount(spawner, 1);
    spawner.completeNext('first done');
    await firstRun;

    expect(callbacks).toHaveLength(11);
    expect(runner.getStats()).toEqual({
      activeCount: 10,
      queuedCount: 0,
      maxConcurrency: 10
    });
  });

  test('does not retain large in-memory state while ten child agents are active and one is queued', async () => {
    const fixture = await setup();
    const spawner = new FakeRunSpawner();
    const callbacks: Array<() => Promise<void>> = [];
    const workspace = createWorkspaceManager({ root: fixture.workspaceRoot });
    const runner = createInternalSubAgentRunner({
      taskTracker: fixture.tracker,
      conversations: fixture.conversations,
      spawner,
      maxConcurrency: 10,
      scheduler: (callback) => callbacks.push(callback),
      childConversationIdFactory: (taskId) => `conv_child_${taskId}`
    });
    const before = process.memoryUsage().heapUsed;

    for (let index = 1; index <= 11; index += 1) {
      const taskId = `task_memory_${index.toString()}`;
      const workspacePath = await workspace.create(taskId);
      await fixture.tracker.upsert({
        taskId,
        conversationId: 'conv_parent',
        title: `memory task ${index.toString()}`,
        status: 'dispatched',
        kind: 'internal_subagent',
        workspacePath,
        payload: {
          definitionKey: 'linnsy_general_subagent',
          goal: `memory task ${index.toString()}`
        }
      });
      runner.spawn({
        taskId,
        definitionKey: 'linnsy_general_subagent',
        goal: `memory task ${index.toString()}`,
        context: 'x'.repeat(32 * 1024),
        workspacePath,
        parentConversationId: 'conv_parent'
      });
    }

    const heapDelta = process.memoryUsage().heapUsed - before;

    expect(runner.getStats()).toEqual({
      activeCount: 10,
      queuedCount: 1,
      maxConcurrency: 10
    });
    expect(heapDelta).toBeLessThan(128 * 1024 * 1024);
  });
});

async function waitForSpawnCount(spawner: FakeRunSpawner, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawner.spawned.length >= expected) {
      return;
    }
    await Promise.resolve();
  }
  expect(spawner.spawned).toHaveLength(expected);
}

async function waitForPendingCount(spawner: FakeRunSpawner, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (spawner.pendingCount() >= expected) {
      return;
    }
    await Promise.resolve();
  }
  expect(spawner.pendingCount()).toBe(expected);
}
