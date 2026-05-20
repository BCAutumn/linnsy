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
import { createGetTaskStatusTool } from '../tools/get-task-status.js';
import { createListTasksTool } from '../tools/list-tasks.js';
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
  await conversations.upsert({
    conversationId: 'conv_2',
    sessionKey: 'linnsy:main:cli:private:other',
    platform: 'cli',
    chatType: 'private',
    chatId: 'other',
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

describe('task query tools', () => {
  test('list_tasks 默认返回当前会话的活跃任务 + 最近终态任务', async () => {
    const fixture = await setup();
    await seedTasks(fixture.tracker);
    const tool = createListTasksTool({ taskTracker: fixture.tracker });

    const output = await tool.execute({}, toolContext());

    expect(output.data.tasks.map((task) => task.taskId)).toEqual([
      'task_ambiguous_beta',
      'task_ambiguous_alpha',
      'task_retry',
      'task_failed',
      'task_done',
      'task_paused',
      'task_progress',
      'task_dispatched'
    ]);
    expect(output.data.appliedFilter.status).toEqual([
      'dispatched',
      'in_progress',
      'paused',
      'completed',
      'failed',
      'cancelled'
    ]);
    expect(output.data.appliedFilter.conversationId).toBe('conv_1');
    expect(output.observation).toContain('8');
    expect(output.observation).toContain('scope=conversationId=conv_1');
  });

  test('list_tasks can explicitly include all conversations', async () => {
    const fixture = await setup();
    await seedTasks(fixture.tracker);
    const tool = createListTasksTool({ taskTracker: fixture.tracker });

    const output = await tool.execute({ includeAllConversations: true }, toolContext());

    expect(output.data.tasks.map((task) => task.taskId)).toContain('task_other_conversation');
    expect(output.data.appliedFilter.conversationId).toBeUndefined();
    expect(output.observation).toContain('scope=all_conversations');
  });

  test('list_tasks supports status, kind, conversationId, and limit filters', async () => {
    const fixture = await setup();
    await seedTasks(fixture.tracker);
    const tool = createListTasksTool({ taskTracker: fixture.tracker });

    const output = await tool.execute({
      status: ['failed', 'completed'],
      kind: 'external',
      conversationId: 'conv_1',
      limit: 1
    }, toolContext());

    expect(output.data.tasks).toEqual([
      expect.objectContaining({ taskId: 'task_ambiguous_beta', status: 'failed', kind: 'external' })
    ]);
    expect(output.data.appliedFilter.limit).toBe(1);
    expect(output.observation).toContain('1');
  });

  test('get_task_status returns one task with its attempt history', async () => {
    const fixture = await setup();
    await seedTasks(fixture.tracker);
    const tool = createGetTaskStatusTool({ taskTracker: fixture.tracker });

    const output = await tool.execute({ taskId: 'task_retry' }, toolContext());

    expect(output.data.task).toMatchObject({
      taskId: 'task_retry',
      parentTaskId: 'task_failed',
      attemptCount: 2
    });
    expect(output.data.attemptHistory.map((task) => task.taskId)).toEqual(['task_failed', 'task_retry']);
    expect(output.observation).toContain('task_retry');
    expect(output.observation).toContain('任务诊断摘要');
    expect(output.observation).toContain('error=codex exec failed: exitCode=1; stderr=Not inside a trusted directory');
    expect(output.observation).toContain('位置=linnsy(/Users/tiansi/code/linnsy)');
  });

  test('get_task_status supports unique short task id prefix in current conversation', async () => {
    const fixture = await setup();
    await seedTasks(fixture.tracker);
    const tool = createGetTaskStatusTool({ taskTracker: fixture.tracker });

    const output = await tool.execute({ taskId: 'task_retr' }, toolContext());

    expect(output.data.task.taskId).toBe('task_retry');
    expect(output.observation).toContain('输入 taskId=task_retr，已按前缀匹配到 task_retry。');
  });

  test('get_task_status 展示 completed 任务的完成回复', async () => {
    const fixture = await setup();
    await seedTasks(fixture.tracker);
    const tool = createGetTaskStatusTool({ taskTracker: fixture.tracker });

    const output = await tool.execute({ taskId: 'task_done' }, toolContext());

    expect(output.data.task.taskId).toBe('task_done');
    expect(output.observation).toContain('完成回复：');
    expect(output.observation).toContain('Codex 已经完成临时文件修改。');
  });

  test('get_task_status rejects ambiguous short task id prefix', async () => {
    const fixture = await setup();
    await seedTasks(fixture.tracker);
    const tool = createGetTaskStatusTool({ taskTracker: fixture.tracker });

    await expect(tool.execute({ taskId: 'task_ambiguous' }, toolContext())).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED
    });
  });

  test('get_task_status throws LINNSY_TASK_NOT_FOUND for an unknown task', async () => {
    const fixture = await setup();
    const tool = createGetTaskStatusTool({ taskTracker: fixture.tracker });

    await expect(tool.execute({ taskId: 'missing' }, toolContext())).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.TASK_NOT_FOUND
    });
  });

  test('registers list_tasks and get_task_status in the tool runtime', async () => {
    const fixture = await setup();
    await seedTasks(fixture.tracker);
    const runtime = createLinnsyToolRuntime({
      tools: [
        createListTasksTool({ taskTracker: fixture.tracker }),
        createGetTaskStatusTool({ taskTracker: fixture.tracker })
      ]
    });

    expect(runtime.getToolSchemas().map((schema) => schema.function.name)).toEqual([
      'list_tasks',
      'get_task_status'
    ]);

    const result = await runtime.executeTool('get_task_status', { taskId: 'task_progress' }, toolContext());

    expect(result.success).toBe(true);
    expect(result.result).toContain('task_progress');
  });
});

async function seedTasks(tracker: ReturnType<typeof createTaskTracker>): Promise<void> {
  await tracker.upsert({
    taskId: 'task_dispatched',
    conversationId: 'conv_1',
    title: 'Dispatched',
    status: 'dispatched',
    kind: 'external',
    updatedAt: 100
  });
  await tracker.upsert({
    taskId: 'task_progress',
    conversationId: 'conv_1',
    title: 'Progress',
    status: 'in_progress',
    kind: 'internal_subagent',
    updatedAt: 200
  });
  await tracker.upsert({
    taskId: 'task_paused',
    conversationId: 'conv_1',
    title: 'Paused',
    status: 'paused',
    kind: 'external',
    updatedAt: 300
  });
  await tracker.upsert({
    taskId: 'task_done',
    conversationId: 'conv_1',
    title: 'Done',
    status: 'completed',
    kind: 'external',
    updatedAt: 400,
    result: { finalMessage: 'Codex 已经完成临时文件修改。' }
  });
  await tracker.upsert({
    taskId: 'task_failed',
    conversationId: 'conv_1',
    title: 'Failed',
    status: 'failed',
    kind: 'external',
    externalKind: 'codex',
    attemptCount: 1,
    updatedAt: 500,
    lastNode: 'codex.exit',
    locator: { kind: 'directory', label: 'owner-home', ref: '/home/owner' },
    payload: { prompt: '旧尝试' },
    result: { errorMessage: 'codex exec failed: exitCode=1; stderr=Error: No such file or directory (os error 2)' }
  });
  await tracker.upsert({
    taskId: 'task_retry',
    conversationId: 'conv_1',
    title: 'Retry',
    status: 'dispatched',
    kind: 'external',
    externalKind: 'codex',
    parentTaskId: 'task_failed',
    attemptCount: 2,
    updatedAt: 600,
    lastNode: 'codex.exit',
    locator: { kind: 'directory', label: 'linnsy', ref: '/Users/tiansi/code/linnsy' },
    payload: { prompt: '重试任务' },
    result: { errorMessage: 'codex exec failed: exitCode=1; stderr=Not inside a trusted directory' }
  });
  await tracker.upsert({
    taskId: 'task_other_conversation',
    conversationId: 'conv_2',
    title: 'Other',
    status: 'failed',
    kind: 'external',
    updatedAt: 700
  });
  await tracker.upsert({
    taskId: 'task_ambiguous_alpha',
    conversationId: 'conv_1',
    title: 'Ambiguous Alpha',
    status: 'completed',
    kind: 'external',
    updatedAt: 800
  });
  await tracker.upsert({
    taskId: 'task_ambiguous_beta',
    conversationId: 'conv_1',
    title: 'Ambiguous Beta',
    status: 'failed',
    kind: 'external',
    updatedAt: 900
  });
}

function toolContext(): ToolExecutionContext {
  return {
    runId: 'run_1',
    conversationId: 'conv_1',
    turnId: 'turn_1',
    user_query: 'what are you doing'
  };
}
