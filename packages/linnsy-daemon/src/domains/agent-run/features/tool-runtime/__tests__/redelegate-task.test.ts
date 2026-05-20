import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';
import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTaskStore } from '../../../../task/persistence/sqlite-task-store.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { LinnsyNotificationLayer } from '../../../../conversation/features/notification/types.js';
import { createLinnsyAgentRegistry } from '../../agents/registry/registry.js';
import { createLinnsyEchoSubagentDefinition } from '../../agents/index.js';
import type { ExternalAgentDispatcherPort } from '../../../../task/features/external-dispatch/types.js';
import { createEchoInternalSubAgentExecutor } from '../../internal-subagent/echo-executor.js';
import { createInternalSubAgentRunner } from '../../internal-subagent/runner.js';
import type { TaskLocator } from '../../../../task/definitions/task.js';
import { createTaskTracker } from '../../../../task/features/tracker/task-tracker.js';
import { createWorkspaceManager } from '../../../../task/features/workspace/workspace-manager.js';
import { createGetTaskStatusTool } from '../tools/get-task-status.js';
import { createRedelegateTaskTool } from '../tools/redelegate-task.js';
import { createLinnsyToolRuntime } from '../tool-runtime.js';

interface Fixture {
  home: string;
  db: Database.Database;
  tracker: ReturnType<typeof createTaskTracker>;
  workspaceRoot: string;
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
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 10,
    updatedAt: 10
  });

  const fixture = { home, db, tracker, workspaceRoot };
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

describe('redelegate_task tool', () => {
  test('redelegates a failed external task into a new dispatched attempt and workspace', async () => {
    const fixture = await setup();
    const dispatches: Array<{ taskId: string; definitionKey: string; locator: TaskLocator; workspacePath: string; payload?: Record<string, unknown> }> = [];
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch(input) {
        dispatches.push({
          taskId: input.taskId,
          definitionKey: input.definitionKey,
          locator: input.locator,
          workspacePath: input.workspacePath,
          ...(input.payload === undefined ? {} : { payload: input.payload })
        });
        return Promise.resolve();
      },
      continue: () => Promise.resolve(),
      cancel: () => Promise.resolve()
    };
    await fixture.tracker.upsert({
      taskId: 'task_failed',
      conversationId: 'conv_1',
      title: 'Original title',
      status: 'failed',
      kind: 'external',
      attemptCount: 1,
      locator: linnsyLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_failed'),
      payload: { definitionKey: 'delegate_to_codex', repo: 'linnsy' },
      result: { errorMessage: 'bad result' }
    });
    const tool = createRedelegateTaskTool({
      registry: createLinnsyAgentRegistry(),
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher,
      internalRunner: createInternalSubAgentRunner({
        taskTracker: fixture.tracker,
        executor: createEchoInternalSubAgentExecutor()
      }),
      taskIdFactory: () => 'task_retry'
    });

    const output = await tool.execute({
      taskId: 'task_failed',
      improvedSpec: {
        title: 'Improved title',
        payload: { repo: 'linnsy', instruction: 'try smaller diff' },
        targetDefinitionKey: 'cursor'
      }
    }, toolContext());

    expect(output.data).toEqual({
      oldTaskId: 'task_failed',
      newTaskId: 'task_retry',
      workspacePath: join(fixture.workspaceRoot, 'task_retry'),
      status: 'dispatched'
    });
    expect(output.observation).toContain('task_retry');
    expect(dispatches).toEqual([{
      taskId: 'task_retry',
      definitionKey: 'delegate_to_cursor',
      locator: linnsyLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_retry'),
      payload: { repo: 'linnsy', instruction: 'try smaller diff' }
    }]);
    await expect(fixture.tracker.get('task_retry')).resolves.toMatchObject({
      taskId: 'task_retry',
      parentTaskId: 'task_failed',
      attemptCount: 2,
      title: 'Improved title',
      status: 'dispatched',
      kind: 'external',
      externalKind: 'cursor',
      locator: linnsyLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_retry'),
      payload: {
        definitionKey: 'delegate_to_cursor',
        repo: 'linnsy',
        instruction: 'try smaller diff'
      }
    });

    const statusTool = createGetTaskStatusTool({ taskTracker: fixture.tracker });
    const status = await statusTool.execute({ taskId: 'task_retry' }, toolContext());
    expect(status.data.attemptHistory.map((task) => task.taskId)).toEqual(['task_failed', 'task_retry']);
  });

  test('redelegates a failed internal subagent task through the internal runner', async () => {
    const fixture = await setup();
    const callbacks: Array<() => Promise<void>> = [];
    const runner = createInternalSubAgentRunner({
      taskTracker: fixture.tracker,
      executor: createEchoInternalSubAgentExecutor(),
      scheduler: (callback) => callbacks.push(callback)
    });
    await fixture.tracker.upsert({
      taskId: 'task_internal_failed',
      conversationId: 'conv_1',
      title: 'Old goal',
      status: 'failed',
      kind: 'internal_subagent',
      attemptCount: 1,
      payload: { definitionKey: 'linnsy_echo_subagent', goal: 'Old goal', context: 'old context' }
    });
    const tool = createRedelegateTaskTool({
      registry: createLinnsyAgentRegistry({
        definitions: [createLinnsyEchoSubagentDefinition()],
        autoRegisterMain: false,
        defaultAgentId: 'linnsy_echo_subagent'
      }),
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher: noopDispatcher(),
      internalRunner: runner,
      taskIdFactory: () => 'task_internal_retry'
    });

    const output = await tool.execute({
      taskId: 'task_internal_failed',
      improvedSpec: {
        title: 'New goal',
        payload: { context: 'new context' }
      }
    }, toolContext());

    expect(output.data.newTaskId).toBe('task_internal_retry');
    expect(output.observation).toContain('task_internal_retry');
    expect(callbacks).toHaveLength(1);
    await expect(fixture.tracker.get('task_internal_retry')).resolves.toMatchObject({
      status: 'dispatched',
      kind: 'internal_subagent',
      parentTaskId: 'task_internal_failed',
      attemptCount: 2,
      payload: {
        definitionKey: 'linnsy_echo_subagent',
        goal: 'New goal',
        context: 'new context'
      }
    });

    await callbacks[0]?.();

    await expect(fixture.tracker.get('task_internal_retry')).resolves.toMatchObject({
      status: 'completed',
      result: { text: 'Echo: New goal' }
    });
  });

  test('rejects external redelegation without a locator before creating a task', async () => {
    const fixture = await setup();
    await fixture.tracker.upsert({
      taskId: 'task_codex_failed',
      conversationId: 'conv_1',
      title: 'Bad cwd',
      status: 'failed',
      kind: 'external',
      attemptCount: 1,
      workspacePath: join(fixture.workspaceRoot, 'task_codex_failed'),
      payload: { definitionKey: 'delegate_to_codex', prompt: 'say hello' },
      result: { errorMessage: 'wrong cwd' }
    });
    const tool = createRedelegateTaskTool({
      registry: createLinnsyAgentRegistry(),
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher: noopDispatcher(),
      internalRunner: createInternalSubAgentRunner({
        taskTracker: fixture.tracker,
        executor: createEchoInternalSubAgentExecutor()
      }),
      taskIdFactory: () => 'task_codex_retry'
    });

    await expectLinnsyError(
      tool.execute({ taskId: 'task_codex_failed' }, toolContext()),
      LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
      'requires locator'
    );
    await expect(fixture.tracker.get('task_codex_retry')).resolves.toBeNull();
  });

  test('allows redelegating Codex after improvedSpec provides a concrete locator', async () => {
    const fixture = await setup();
    const dispatches: Array<{ taskId: string; definitionKey: string; locator: TaskLocator; workspacePath: string; payload?: Record<string, unknown> }> = [];
    const dispatcher: ExternalAgentDispatcherPort = {
      dispatch(input) {
        dispatches.push({
          taskId: input.taskId,
          definitionKey: input.definitionKey,
          locator: input.locator,
          workspacePath: input.workspacePath,
          ...(input.payload === undefined ? {} : { payload: input.payload })
        });
        return Promise.resolve();
      },
      continue: () => Promise.resolve(),
      cancel: () => Promise.resolve()
    };
    await fixture.tracker.upsert({
      taskId: 'task_codex_needs_retry',
      conversationId: 'conv_1',
      title: 'Fix cwd',
      status: 'failed',
      kind: 'external',
      attemptCount: 1,
      workspacePath: join(fixture.workspaceRoot, 'task_codex_needs_retry'),
      payload: { definitionKey: 'delegate_to_codex', prompt: 'say hello' },
      result: { errorMessage: 'wrong cwd' }
    });
    const tool = createRedelegateTaskTool({
      registry: createLinnsyAgentRegistry(),
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher,
      internalRunner: createInternalSubAgentRunner({
        taskTracker: fixture.tracker,
        executor: createEchoInternalSubAgentExecutor()
      }),
      taskIdFactory: () => 'task_codex_fixed_retry'
    });

    await expect(tool.execute({
      taskId: 'task_codex_needs_retry',
      improvedSpec: {
        locator: linnsyLocator(),
        payload: { prompt: 'say hello from the project' }
      }
    }, toolContext())).resolves.toMatchObject({
      data: {
        newTaskId: 'task_codex_fixed_retry',
        status: 'dispatched'
      }
    });
    expect(dispatches).toEqual([{
      taskId: 'task_codex_fixed_retry',
      definitionKey: 'delegate_to_codex',
      locator: linnsyLocator(),
      workspacePath: join(fixture.workspaceRoot, 'task_codex_fixed_retry'),
      payload: { prompt: 'say hello from the project' }
    }]);
  });

  test('rejects redelegation when the old task is missing, not failed, or past attempt limit', async () => {
    const fixture = await setup();
    const notifications: string[] = [];
    const tool = createRedelegateTaskTool({
      registry: createLinnsyAgentRegistry(),
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher: noopDispatcher(),
      internalRunner: createInternalSubAgentRunner({
        taskTracker: fixture.tracker,
        executor: createEchoInternalSubAgentExecutor()
      }),
      notification: notificationLayer(notifications),
      taskIdFactory: () => 'task_should_not_exist'
    });
    await fixture.tracker.upsert({
      taskId: 'task_active',
      conversationId: 'conv_1',
      title: 'Active',
      status: 'in_progress',
      kind: 'external'
    });
    await fixture.tracker.upsert({
      taskId: 'task_limit',
      conversationId: 'conv_1',
      title: 'Limit',
      status: 'failed',
      kind: 'external',
      attemptCount: 2,
      payload: { definitionKey: 'delegate_to_codex' }
    });

    await expect(tool.execute({ taskId: 'missing' }, toolContext())).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.TASK_NOT_FOUND
    });
    await expect(tool.execute({ taskId: 'task_active' }, toolContext())).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.TASK_TRANSITION_INVALID
    });
    await expect(tool.execute({ taskId: 'task_limit' }, toolContext())).rejects.toMatchObject({
      code: LINNSY_ERROR_CODES.TASK_REDELEGATE_LIMIT
    });
    expect(notifications).toEqual([
      '我让 Limit 试了两次都不对，要不你看看？'
    ]);
    await expect(fixture.tracker.get('task_should_not_exist')).resolves.toBeNull();
  });

  test('registers redelegate_task in the tool runtime', async () => {
    const fixture = await setup();
    const runtime = createLinnsyToolRuntime({
      tools: [
        createRedelegateTaskTool({
          registry: createLinnsyAgentRegistry(),
          taskTracker: fixture.tracker,
          workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
          dispatcher: noopDispatcher(),
          internalRunner: createInternalSubAgentRunner({
            taskTracker: fixture.tracker,
            executor: createEchoInternalSubAgentExecutor()
          })
        })
      ]
    });

    expect(runtime.getToolSchemas().map((schema) => schema.function.name)).toEqual(['redelegate_task']);
  });
});

function notificationLayer(texts: string[]): LinnsyNotificationLayer {
  return {
    proactive() {
      return Promise.resolve();
    },
    reply() {
      return Promise.resolve();
    },
    replyForRun() {
      return Promise.resolve({ outboundMessageId: 'out_1', delivery: 'sent' });
    },
    replyForTaskRun(input) {
      texts.push(input.text);
      return Promise.resolve({ outboundMessageId: 'out_1', delivery: 'sent' });
    },
    notifyForTask(input) {
      texts.push(input.text);
      return Promise.resolve({ outboundMessageId: 'out_1', delivery: 'sent' });
    }
  };
}

function toolContext(): ToolExecutionContext {
  return {
    runId: 'run_1',
    conversationId: 'conv_1',
    turnId: 'turn_1',
    user_query: 'try again'
  };
}

function noopDispatcher(): ExternalAgentDispatcherPort {
  return {
    dispatch: () => Promise.resolve(),
    continue: () => Promise.resolve(),
    cancel: () => Promise.resolve()
  };
}

function linnsyLocator(): TaskLocator {
  return {
    kind: 'directory',
    label: 'linnsy',
    ref: '/Users/tiansi/code/linnsy'
  };
}

async function expectLinnsyError(
  promise: Promise<unknown>,
  code: string,
  messagePart: string
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(LinnsyError);
    if (!(error instanceof LinnsyError)) {
      return;
    }
    expect(error.code).toBe(code);
    expect(error.message).toContain(messagePart);
    return;
  }
  throw new Error('expected promise to reject with LinnsyError');
}
