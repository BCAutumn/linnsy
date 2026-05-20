import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';
import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTaskStore } from '../../../../task/persistence/sqlite-task-store.js';
import { createTaskTracker } from '../../../../task/features/tracker/task-tracker.js';
import type { ExternalAgentDispatcherPort } from '../../../../task/features/external-dispatch/types.js';
import { createCancelTaskTool } from '../tools/cancel-task.js';
import { createContinueTaskTool } from '../tools/continue-task.js';
import { createManageTaskTool } from '../tools/manage-task.js';
import { createPauseTaskTool } from '../tools/pause-task.js';
import { createResumeTaskTool } from '../tools/resume-task.js';
import { createLinnsyToolRuntime } from '../tool-runtime.js';

interface Fixture {
  home: string;
  db: Database.Database;
  tracker: ReturnType<typeof createTaskTracker>;
}

const fixtures: Fixture[] = [];

async function setup(): Promise<Fixture> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const tasks = new SqliteTaskStore(db);
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

  const fixture = { home, db, tracker };
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

describe('task control tools', () => {
  test('cancel_task cancels an active task and keeps later external updates silent', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_1', 'in_progress');
    const tool = createCancelTaskTool({ taskTracker: fixture.tracker, now: () => 1_000 });

    const output = await tool.execute({
      taskId: 'task_1',
      reason: 'owner said stop'
    }, toolContext());

    expect(output.data.task).toMatchObject({
      taskId: 'task_1',
      status: 'cancelled',
      cancelledAt: 1_000,
      cancelReason: 'owner said stop'
    });
    expect(output.observation).toContain('task_1');
    await expect(fixture.tracker.onExternalUpdate('task_1', {
      node: 'late',
      finalResult: { ignored: true }
    })).resolves.toBe('silent');
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({ status: 'cancelled' });
  });

  test('cancel_task notifies the external dispatcher before cancelling an external task', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_1', 'in_progress');
    const cancels: Array<{ taskId: string; reason?: string }> = [];
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch: () => Promise.resolve(),
      continue: () => Promise.resolve(),
      cancel(input) {
        cancels.push(input);
        return Promise.resolve();
      }
    };
    const tool = createCancelTaskTool({ taskTracker: fixture.tracker, dispatcher, now: () => 1_000 });

    await tool.execute({
      taskId: 'task_1',
      reason: 'owner said stop'
    }, toolContext());

    expect(cancels).toEqual([{ taskId: 'task_1', reason: 'owner said stop' }]);
  });

  test('cancel_task can cancel a paused task', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_1', 'paused');
    const tool = createCancelTaskTool({ taskTracker: fixture.tracker, now: () => 1_000 });

    const output = await tool.execute({ taskId: 'task_1' }, toolContext());

    expect(output.data.task).toMatchObject({
      taskId: 'task_1',
      status: 'cancelled',
      cancelledAt: 1_000
    });
  });

  test('continue_task sends a follow-up message to the same external task', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_1', 'in_progress');
    const continues: Array<{ taskId: string; message: string }> = [];
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch: () => Promise.resolve(),
      continue(input) {
        continues.push({
          taskId: input.taskId,
          message: input.message
        });
        return Promise.resolve();
      },
      cancel: () => Promise.resolve()
    };
    const tool = createContinueTaskTool({ taskTracker: fixture.tracker, dispatcher });

    const output = await tool.execute({
      taskId: 'task_1',
      message: '主人同意了，继续执行推荐方案。'
    }, toolContext());

    expect(continues).toEqual([{ taskId: 'task_1', message: '主人同意了，继续执行推荐方案。' }]);
    expect(output.data.task).toMatchObject({
      taskId: 'task_1',
      status: 'in_progress'
    });
  });

  test('continue_task supports a unique short task id prefix in the current conversation', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_alpha-1111-2222-3333', 'in_progress');
    const continues: Array<{ taskId: string; message: string }> = [];
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch: () => Promise.resolve(),
      continue(input) {
        continues.push({
          taskId: input.taskId,
          message: input.message
        });
        return Promise.resolve();
      },
      cancel: () => Promise.resolve()
    };
    const tool = createContinueTaskTool({ taskTracker: fixture.tracker, dispatcher });

    const output = await tool.execute({
      taskId: 'task_alpha',
      message: '继续。'
    }, toolContext());

    expect(continues).toEqual([{ taskId: 'task_alpha-1111-2222-3333', message: '继续。' }]);
    expect(output.observation).toContain('已按前缀匹配到 task_alpha-1111-2222-3333');
  });

  test('continue_task rejects ambiguous short task id prefixes', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_alpha-1111-2222-3333', 'in_progress');
    await seedTask(fixture.tracker, 'task_alpha-4444-5555-6666', 'in_progress');
    const tool = createContinueTaskTool({
      taskTracker: fixture.tracker,
      dispatcher: noopDispatcher()
    });

    await expect(tool.execute({
      taskId: 'task_alpha',
      message: '继续。'
    }, toolContext())).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED
    });
  });

  test('continue_task reopens a completed external task for approval follow-up', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_1', 'completed', { final: 'needs approval' });
    const tool = createContinueTaskTool({
      taskTracker: fixture.tracker,
      dispatcher: noopDispatcher()
    });

    const output = await tool.execute({
      taskId: 'task_1',
      message: '可以，继续。'
    }, toolContext());

    expect(output.data.task).toMatchObject({
      taskId: 'task_1',
      status: 'in_progress',
      payload: {
        final: 'needs approval',
        lastContinueMessage: '可以，继续。'
      }
    });
  });

  test('continue_task rejects internal or terminal tasks', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_internal', 'in_progress', undefined, 'internal_subagent');
    await seedTask(fixture.tracker, 'task_failed', 'failed');
    const tool = createContinueTaskTool({
      taskTracker: fixture.tracker,
      dispatcher: noopDispatcher()
    });

    await expect(tool.execute({
      taskId: 'task_internal',
      message: '继续'
    }, toolContext())).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.TASK_CANNOT_CONTINUE });
    await expect(tool.execute({
      taskId: 'task_failed',
      message: '继续'
    }, toolContext())).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.TASK_CANNOT_CONTINUE });
  });

  test('continue_task marks the task failed when dispatcher continue rejects', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_1', 'completed');
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch: () => Promise.resolve(),
      continue: () => Promise.reject(new Error('codex resume failed')),
      cancel: () => Promise.resolve()
    };
    const tool = createContinueTaskTool({
      taskTracker: fixture.tracker,
      dispatcher
    });

    await expect(tool.execute({
      taskId: 'task_1',
      message: '继续'
    }, toolContext())).rejects.toThrow('codex resume failed');
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      status: 'failed',
      result: { errorMessage: 'codex resume failed' }
    });
  });

  test('pause_task pauses an active task and buffers later external updates', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_1', 'dispatched');
    const tool = createPauseTaskTool({ taskTracker: fixture.tracker, now: () => 1_000 });

    const output = await tool.execute({ taskId: 'task_1' }, toolContext());

    expect(output.data.task).toMatchObject({
      taskId: 'task_1',
      status: 'paused',
      pausedAt: 1_000
    });
    expect(output.observation).toContain('task_1');
    await expect(fixture.tracker.onExternalUpdate('task_1', {
      node: 'while_paused',
      partialResult: { chunk: 1 }
    })).resolves.toBe('silent');
    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      payload: {
        pausedUpdates: [
          expect.objectContaining({ node: 'while_paused', partialResult: { chunk: 1 } })
        ]
      }
    });
  });

  test('resume_task resumes a paused task and replays buffered updates once', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_1', 'paused', {
      pausedUpdates: [
        { node: 'step_1', partialResult: { chunk: 1 } },
        { node: 'done', finalResult: { ok: true } }
      ],
      keep: 'payload'
    });
    const tool = createResumeTaskTool({ taskTracker: fixture.tracker });

    const output = await tool.execute({ taskId: 'task_1' }, toolContext());

    expect(output.data.flushedUpdateCount).toBe(2);
    expect(output.data.task).toMatchObject({
      taskId: 'task_1',
      status: 'completed',
      lastNode: 'done',
      result: { ok: true }
    });
    expect(output.data.task.payload).toEqual({ keep: 'payload' });
    expect(output.observation).toContain('task_1');
  });

  test('manage_task continues and cancels through one task-control entrypoint', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_continue', 'completed');
    await seedTask(fixture.tracker, 'task_cancel', 'in_progress');
    const continues: Array<{ taskId: string; message: string }> = [];
    const cancels: Array<{ taskId: string; reason?: string }> = [];
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch: () => Promise.resolve(),
      continue(input) {
        continues.push({ taskId: input.taskId, message: input.message });
        return Promise.resolve();
      },
      cancel(input) {
        cancels.push(input);
        return Promise.resolve();
      }
    };
    const tool = createManageTaskTool({
      taskTracker: fixture.tracker,
      dispatcher,
      now: () => 1_000
    });

    const continued = await tool.execute({
      action: 'continue',
      taskId: 'task_continue',
      message: '主人同意，继续。'
    }, toolContext());
    const cancelled = await tool.execute({
      action: 'cancel',
      taskId: 'task_cancel',
      reason: '主人说先停'
    }, toolContext());

    expect(continues).toEqual([{ taskId: 'task_continue', message: '主人同意，继续。' }]);
    expect(cancels).toEqual([{ taskId: 'task_cancel', reason: '主人说先停' }]);
    expect(continued.data).toMatchObject({
      action: 'continue',
      task: { taskId: 'task_continue', status: 'in_progress' },
      message: '主人同意，继续。'
    });
    expect(cancelled.data).toMatchObject({
      action: 'cancel',
      task: { taskId: 'task_cancel', status: 'cancelled', cancelReason: '主人说先停' }
    });
  });

  test('control tools surface not found and invalid transitions from TaskTracker', async () => {
    const fixture = await setup();
    await seedTask(fixture.tracker, 'task_done', 'completed');
    const cancelTool = createCancelTaskTool({ taskTracker: fixture.tracker });
    const pauseTool = createPauseTaskTool({ taskTracker: fixture.tracker });
    const resumeTool = createResumeTaskTool({ taskTracker: fixture.tracker });

    await expect(cancelTool.execute({ taskId: 'missing' }, toolContext())).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.TASK_NOT_FOUND
    });
    await expect(pauseTool.execute({ taskId: 'task_done' }, toolContext())).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.TASK_TRANSITION_INVALID
    });
    await expect(resumeTool.execute({ taskId: 'task_done' }, toolContext())).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.TASK_TRANSITION_INVALID
    });
  });

  test('registers cancel_task, pause_task, resume_task, and continue_task in the tool runtime', async () => {
    const fixture = await setup();
    const runtime = createLinnsyToolRuntime({
      tools: [
        createCancelTaskTool({ taskTracker: fixture.tracker }),
        createPauseTaskTool({ taskTracker: fixture.tracker }),
        createResumeTaskTool({ taskTracker: fixture.tracker }),
        createContinueTaskTool({ taskTracker: fixture.tracker, dispatcher: noopDispatcher() })
      ]
    });

    expect(runtime.getToolSchemas().map((schema) => schema.function.name)).toEqual([
      'cancel_task',
      'pause_task',
      'resume_task',
      'continue_task'
    ]);
  });

  test('registers manage_task as the single main task-control tool', async () => {
    const fixture = await setup();
    const runtime = createLinnsyToolRuntime({
      tools: [
        createManageTaskTool({
          taskTracker: fixture.tracker,
          dispatcher: noopDispatcher()
        })
      ]
    });

    expect(runtime.getToolSchemas().map((schema) => schema.function.name)).toEqual(['manage_task']);
  });
});

async function seedTask(
  tracker: ReturnType<typeof createTaskTracker>,
  taskId: string,
  status: 'dispatched' | 'in_progress' | 'paused' | 'completed' | 'failed',
  payload?: Record<string, unknown>,
  kind: 'external' | 'internal_subagent' = 'external'
): Promise<void> {
  const input = {
    taskId,
    conversationId: 'conv_1',
    title: taskId,
    status,
    kind
  };
  await tracker.upsert(payload === undefined ? input : { ...input, payload });
}

function toolContext(): ToolExecutionContext {
  return {
    runId: 'run_1',
    conversationId: 'conv_1',
    turnId: 'turn_1',
    user_query: 'stop this task'
  };
}

function noopDispatcher(): ExternalAgentDispatcherPort {
  return {
    dispatch: () => Promise.resolve(),
    continue: () => Promise.resolve(),
    cancel: () => Promise.resolve()
  };
}
