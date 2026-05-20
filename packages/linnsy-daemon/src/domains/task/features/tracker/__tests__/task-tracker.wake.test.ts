import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTaskStore } from '../../../persistence/sqlite-task-store.js';

import { createTaskTracker, shouldWakeOnTransition } from '../task-tracker.js';
import type { TaskStatus, TaskWakeHookInput } from '../definitions/types.js';

interface Fixture {
  db: Database.Database;
  home: string;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) {
      fixture.db.close();
      await rm(fixture.home, { recursive: true, force: true });
    }
  }
});

describe('TaskTracker terminal wake hook', () => {
  test.each<[TaskStatus, TaskStatus, boolean]>([
    ['received', 'dispatched', false],
    ['dispatched', 'in_progress', false],
    ['in_progress', 'paused', false],
    ['paused', 'in_progress', false],
    ['completed', 'reported', false],
    ['reported', 'archived', false],
    ['in_progress', 'completed', true],
    ['dispatched', 'failed', true],
    ['in_progress', 'cancelled', true],
    ['completed', 'completed', false]
  ])('shouldWakeOnTransition(%s -> %s) is %s', (from, to, expected) => {
    expect(shouldWakeOnTransition(from, to)).toBe(expected);
  });

  test('calls the wake hook only for terminal transitions', async () => {
    const { tasks } = await setup();
    const calls: TaskWakeHookInput[] = [];
    const tracker = createTaskTracker({
      tasks,
      clock: { now: () => 1_000 },
      wakeMainOnTransition: () => (input) => {
        calls.push(input);
      }
    });
    await tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: 'received'
    });

    await tracker.transition('task_1', 'dispatched');
    await tracker.transition('task_1', 'in_progress');
    await tracker.transition('task_1', 'completed', { result: { finalMessage: 'done' } });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.fromStatus).toBe('in_progress');
    expect(calls[0]?.task).toMatchObject({
      taskId: 'task_1',
      status: 'completed',
      result: { finalMessage: 'done' }
    });
  });

  test.each<[TaskStatus, TaskStatus]>([
    ['received', 'failed'],
    ['dispatched', 'cancelled']
  ])('calls the wake hook for %s -> %s', async (from, to) => {
    const { tasks } = await setup();
    const calls: TaskWakeHookInput[] = [];
    const tracker = createTaskTracker({
      tasks,
      clock: { now: () => 1_000 },
      wakeMainOnTransition: () => (input) => {
        calls.push(input);
      }
    });
    await tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: from
    });

    await tracker.transition('task_1', to);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      fromStatus: from,
      task: { taskId: 'task_1', status: to }
    });
  });

  test('keeps the saved terminal state when the wake hook fails', async () => {
    const { tasks } = await setup();
    const errors: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
    const tracker = createTaskTracker({
      tasks,
      clock: { now: () => 1_000 },
      wakeMainOnTransition: () => () => {
        throw new Error('spawn failed');
      },
      logger: {
        error(message, metadata) {
          errors.push(metadata === undefined ? { message } : { message, metadata });
        }
      }
    });
    await tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: 'in_progress'
    });

    await expect(tracker.transition('task_1', 'completed')).resolves.toMatchObject({ status: 'completed' });
    await expect(tracker.get('task_1')).resolves.toMatchObject({ status: 'completed' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: 'task terminal wake hook failed',
      metadata: {
        taskId: 'task_1',
        fromStatus: 'in_progress',
        toStatus: 'completed'
      }
    });
  });
});

async function setup(): Promise<{ tasks: SqliteTaskStore }> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  await conversations.upsert({
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 1,
    updatedAt: 1
  });
  fixtures.push({ db, home });
  return { tasks: new SqliteTaskStore(db) };
}
