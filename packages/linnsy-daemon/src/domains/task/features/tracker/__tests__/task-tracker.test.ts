import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTaskStore } from '../../../persistence/sqlite-task-store.js';
import type {
  TaskExpectedState,
  TaskStorePort
} from '../../../persistence/task-store-port.js';
import { createTaskTracker } from '../task-tracker.js';
import type { TaskListFilter, TaskRecord, TaskStatus } from '../definitions/types.js';

interface Fixture {
  db: Database.Database;
  home: string;
  conversations: SqliteConversationStore;
  tasks: TaskStorePort;
  tracker: ReturnType<typeof createTaskTracker>;
}

const fixtures: Fixture[] = [];

async function setup(options: { conflictsBeforeSuccess?: number } = {}): Promise<Fixture> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const sqliteTasks = new SqliteTaskStore(db);
  const tasks: TaskStorePort = options.conflictsBeforeSuccess === undefined
    ? sqliteTasks
    : new ConflictOnceTaskStore(sqliteTasks, options.conflictsBeforeSuccess);
  const tracker = createTaskTracker({ tasks, clock: { now: () => 1_000 } });

  await conversations.upsert({
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 10,
    updatedAt: 10
  });

  const fixture = { db, home, conversations, tasks, tracker };
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

describe('TaskTrackerPort and SqliteTaskStore', () => {
  test('creates the expanded tasks schema required by S3', async () => {
    const fixture = await setup();

    const rows = fixture.db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
    const columns = rows.map((row) => row.name);

    expect(columns).toEqual(expect.arrayContaining([
      'parent_task_id',
      'kind',
      'attempt_count',
      'workspace_path',
      'paused_at',
      'cancelled_at',
      'cancel_reason'
    ]));
  });

  test('upserts task records with S3 defaults and round-trips structured payloads', async () => {
    const fixture = await setup();

    const task = await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      originRunId: 'run_1',
      title: 'Research ticket',
      status: 'received',
      payload: { topic: 'linnsy' },
      workspacePath: '/tmp/linnsy/task_1'
    });

    expect(task).toMatchObject({
      taskId: 'task_1',
      kind: 'external',
      attemptCount: 1,
      originRunId: 'run_1',
      payload: { topic: 'linnsy' },
      createdAt: 1_000,
      updatedAt: 1_000
    });
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      taskId: 'task_1',
      payload: { topic: 'linnsy' },
      workspacePath: '/tmp/linnsy/task_1'
    });
  });

  test('preserves optional task fields and metadata when updating an existing task', async () => {
    const fixture = await setup();

    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      originRunId: 'run_1',
      title: 'Research ticket',
      status: 'received',
      payload: { topic: 'linnsy' },
      result: { draft: true },
      metadata: { source: 'codex', traceId: 'trace_1' },
      workspacePath: '/tmp/linnsy/task_1'
    });

    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Research ticket renamed',
      status: 'dispatched'
    });

    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      title: 'Research ticket renamed',
      status: 'dispatched',
      originRunId: 'run_1',
      payload: { topic: 'linnsy' },
      result: { draft: true },
      metadata: { source: 'codex', traceId: 'trace_1' },
      workspacePath: '/tmp/linnsy/task_1'
    });
    expect(fixture.db.prepare('SELECT metadata_json FROM tasks WHERE task_id = ?').get('task_1')).toEqual({
      metadata_json: '{"source":"codex","traceId":"trace_1"}'
    });
  });

  test('preserves createdAt during direct task store updates', async () => {
    const fixture = await setup();
    const created = await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: 'received'
    });

    const upserted = await fixture.tasks.upsert({
      ...created,
      status: 'dispatched',
      createdAt: 9_999,
      updatedAt: 1_001
    });
    expect(upserted).toMatchObject({
      status: 'dispatched',
      createdAt: 1_000,
      updatedAt: 1_001
    });

    const transitioned = await fixture.tasks.updateIfCurrent({
      ...upserted,
      status: 'in_progress',
      createdAt: 8_888,
      updatedAt: 1_002
    }, {
      status: 'dispatched',
      updatedAt: 1_001
    });
    expect(transitioned).toMatchObject({
      status: 'in_progress',
      createdAt: 1_000,
      updatedAt: 1_002
    });
  });

  test.each<[TaskStatus, TaskStatus]>([
    ['received', 'dispatched'],
    ['received', 'failed'],
    ['dispatched', 'in_progress'],
    ['dispatched', 'failed'],
    ['in_progress', 'completed'],
    ['in_progress', 'failed'],
    ['completed', 'reported'],
    ['reported', 'archived'],
    ['dispatched', 'cancelled'],
    ['in_progress', 'cancelled'],
    ['dispatched', 'paused'],
    ['in_progress', 'paused'],
    ['paused', 'in_progress'],
    ['failed', 'dispatched']
  ])('allows transition %s -> %s from the S3 matrix', async (from, to) => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: from
    });

    await expect(fixture.tracker.transition('task_1', to, { lastNode: 'node_1' })).resolves.toMatchObject({
      taskId: 'task_1',
      status: to,
      lastNode: 'node_1'
    });
  });

  test('rejects invalid task transitions without mutating the stored task', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: 'received'
    });

    await expect(fixture.tracker.transition('task_1', 'completed')).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.TASK_TRANSITION_INVALID
    });
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({ status: 'received' });
  });

  test('rejects stale conditional task writes so later status cannot overwrite an earlier transition', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: 'in_progress'
    });
    const stale = await fixture.tasks.get('task_1');
    if (stale === null) {
      throw new Error('expected task_1 to exist');
    }

    await fixture.tracker.transition('task_1', 'completed', {
      result: { ok: true },
      updatedAt: 1_001
    });

    await expect(fixture.tasks.updateIfCurrent({
      ...stale,
      status: 'failed',
      updatedAt: 1_002,
      result: { errorMessage: 'late failure' }
    }, {
      status: stale.status,
      updatedAt: stale.updatedAt
    })).resolves.toBeNull();
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      status: 'completed',
      result: { ok: true }
    });
  });

  test('filters task list by status, kind, parent task, and conversation', async () => {
    const fixture = await setup();
    await fixture.conversations.upsert({
      conversationId: 'conv_2',
      sessionKey: 'linnsy:main:cli:private:other',
      platform: 'cli',
      chatType: 'private',
      chatId: 'other',
      createdAt: 10,
      updatedAt: 10
    });
    await fixture.tracker.upsert({
      taskId: 'task_parent',
      conversationId: 'conv_1',
      title: 'Parent',
      status: 'failed',
      kind: 'external'
    });
    await fixture.tracker.upsert({
      taskId: 'task_child',
      conversationId: 'conv_1',
      title: 'Child',
      status: 'dispatched',
      kind: 'internal_subagent',
      parentTaskId: 'task_parent',
      attemptCount: 2
    });
    await fixture.tracker.upsert({
      taskId: 'task_other',
      conversationId: 'conv_2',
      title: 'Other',
      status: 'dispatched',
      kind: 'external'
    });

    await expect(fixture.tracker.list({
      conversationId: 'conv_1',
      status: ['dispatched'],
      kind: 'internal_subagent',
      parentTaskId: 'task_parent'
    })).resolves.toEqual([
      expect.objectContaining({ taskId: 'task_child', attemptCount: 2 })
    ]);
    await expect(fixture.tracker.list({ status: [] })).resolves.toEqual([]);
  });

  test('returns should_notify for completed and failed external updates', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_done',
      conversationId: 'conv_1',
      title: 'Done',
      status: 'in_progress'
    });
    await fixture.tracker.upsert({
      taskId: 'task_failed',
      conversationId: 'conv_1',
      title: 'Failed',
      status: 'in_progress'
    });

    await expect(fixture.tracker.onExternalUpdate('task_done', {
      node: 'final',
      finalResult: { ok: true }
    })).resolves.toBe('should_notify');
    await expect(fixture.tracker.onExternalUpdate('task_failed', {
      node: 'error',
      errorMessage: 'boom'
    })).resolves.toBe('should_notify');

    await expect(fixture.tracker.get('task_done')).resolves.toMatchObject({ status: 'completed' });
    await expect(fixture.tracker.get('task_failed')).resolves.toMatchObject({ status: 'failed' });
  });

  test('keeps in_progress node updates silent unless meta.notify is true', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Progress',
      status: 'dispatched'
    });

    await expect(fixture.tracker.onExternalUpdate('task_1', { node: 'step_1' })).resolves.toBe('silent');
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      status: 'in_progress',
      lastNode: 'step_1'
    });
    await expect(fixture.tracker.onExternalUpdate('task_1', {
      node: 'step_2',
      meta: { notify: true }
    })).resolves.toBe('should_notify');
  });

  test('deep merges external partialResult patches into the existing task result', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Progress',
      status: 'in_progress',
      result: {
        raw: { sessionId: 'session_1' },
        nested: { kept: true, step: 1 },
        keep: 'yes'
      }
    });

    await expect(fixture.tracker.onExternalUpdate('task_1', {
      node: 'step_2',
      partialResult: {
        raw: { event: 'delta_2' },
        nested: { step: 2 },
        added: 'ok'
      }
    })).resolves.toBe('silent');

    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      lastNode: 'step_2',
      result: {
        raw: { sessionId: 'session_1', event: 'delta_2' },
        nested: { kept: true, step: 2 },
        keep: 'yes',
        added: 'ok'
      }
    });
  });

  test('retries external progress updates when the optimistic write loses a race', async () => {
    const fixture = await setup({ conflictsBeforeSuccess: 1 });
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Progress',
      status: 'in_progress'
    });

    await expect(fixture.tracker.onExternalUpdate('task_1', {
      node: 'step_1',
      partialResult: { chunk: 1 }
    })).resolves.toBe('silent');

    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      lastNode: 'step_1',
      result: { chunk: 1 }
    });
  });

  test('buffers paused task updates without notifying', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Paused',
      status: 'paused'
    });

    await expect(fixture.tracker.onExternalUpdate('task_1', {
      node: 'step_1',
      partialResult: { chunk: 1 }
    })).resolves.toBe('silent');
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      status: 'paused',
      payload: {
        pausedUpdates: [
          expect.objectContaining({ node: 'step_1', partialResult: { chunk: 1 } })
        ]
      }
    });
  });

  test('keeps at most 64 paused task updates', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Paused',
      status: 'paused'
    });

    for (let index = 0; index < 65; index += 1) {
      await fixture.tracker.onExternalUpdate('task_1', {
        node: `step_${String(index)}`,
        partialResult: { index }
      });
    }

    const task = await fixture.tracker.get('task_1');
    const pausedUpdates = task?.payload?.pausedUpdates;
    if (!Array.isArray(pausedUpdates)) {
      throw new Error('expected pausedUpdates to be an array');
    }
    expect(pausedUpdates).toHaveLength(64);
    expect(pausedUpdates[0]).toMatchObject({ node: 'step_1' });
    expect(pausedUpdates[63]).toMatchObject({ node: 'step_64' });
  });

  test('deletes archived tasks directly', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Archived',
      status: 'archived'
    });

    await expect(fixture.tracker.delete('task_1')).resolves.toBe(true);
    await expect(fixture.tracker.get('task_1')).resolves.toBeNull();
    await expect(fixture.tasks.delete('task_missing')).resolves.toBe(false);
  });

  test('cancels active tasks before deleting their record', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Running',
      status: 'in_progress'
    });

    await expect(fixture.tracker.delete('task_1', { reason: 'user_deleted' })).resolves.toBe(true);
    await expect(fixture.tracker.get('task_1')).resolves.toBeNull();
  });

  test('throws TASK_NOT_FOUND when deleting an unknown task', async () => {
    const fixture = await setup();

    await expect(fixture.tracker.delete('task_missing')).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.TASK_NOT_FOUND
    });
  });
});

class ConflictOnceTaskStore implements TaskStorePort {
  public constructor(
    private readonly delegate: TaskStorePort,
    private conflictsBeforeSuccess: number
  ) {}

  public upsert(record: TaskRecord): Promise<TaskRecord> {
    return this.delegate.upsert(record);
  }

  public updateIfCurrent(record: TaskRecord, expected: TaskExpectedState): Promise<TaskRecord | null> {
    if (this.conflictsBeforeSuccess > 0) {
      this.conflictsBeforeSuccess -= 1;
      return Promise.resolve(null);
    }
    return this.delegate.updateIfCurrent(record, expected);
  }

  public get(taskId: string): Promise<TaskRecord | null> {
    return this.delegate.get(taskId);
  }

  public list(filter?: TaskListFilter): Promise<TaskRecord[]> {
    return this.delegate.list(filter);
  }

  public delete(taskId: string): Promise<boolean> {
    return this.delegate.delete(taskId);
  }
}
