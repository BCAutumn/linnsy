import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';
import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import { SqliteTaskStore } from '../../../../task/persistence/sqlite-task-store.js';
import { createLinnsyAgentRegistry } from '../../agents/registry/registry.js';
import { createLinnsyEchoSubagentDefinition } from '../../agents/index.js';
import { createInternalSubAgentRunner } from '../../internal-subagent/runner.js';
import { createEchoInternalSubAgentExecutor } from '../../internal-subagent/echo-executor.js';
import { createTaskTracker } from '../../../../task/features/tracker/task-tracker.js';
import { createWorkspaceManager } from '../../../../task/features/workspace/workspace-manager.js';
import { createLinnsyToolRuntime } from '../tool-runtime.js';
import { createDelegateToInternalTool } from '../tools/delegate-to-internal.js';

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

describe('delegate_to_internal tool and InternalSubAgentRunner', () => {
  test('creates an internal task, schedules echo subagent, then completes into workspace outputs', async () => {
    const fixture = await setup();
    const callbacks: Array<() => Promise<void>> = [];
    const runner = createInternalSubAgentRunner({
      taskTracker: fixture.tracker,
      executor: createEchoInternalSubAgentExecutor(),
      scheduler: (callback) => callbacks.push(callback)
    });
    const tool = createDelegateToInternalTool({
      registry: createLinnsyAgentRegistry({
        definitions: [createLinnsyEchoSubagentDefinition()],
        autoRegisterMain: false,
        defaultAgentId: 'linnsy_echo_subagent'
      }),
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      runner,
      taskIdFactory: () => 'task_internal_1'
    });

    const result = await tool.execute({
      definitionKey: 'linnsy_echo_subagent',
      goal: 'Summarize this note',
      context: 'short context'
    }, toolContext());

    expect(result.data).toMatchObject({
      taskId: 'task_internal_1',
      status: 'dispatched',
      workspacePath: join(fixture.workspaceRoot, 'task_internal_1')
    });
    expect(result.observation).toContain('task_internal_1');
    expect(callbacks).toHaveLength(1);
    await expect(fixture.tracker.get('task_internal_1')).resolves.toMatchObject({
      taskId: 'task_internal_1',
      status: 'dispatched',
      kind: 'internal_subagent',
      payload: { goal: 'Summarize this note', context: 'short context' }
    });

    await callbacks[0]?.();

    await expect(fixture.tracker.get('task_internal_1')).resolves.toMatchObject({
      status: 'completed',
      lastNode: 'completed',
      result: {
        text: 'Echo: Summarize this note',
        outputPath: join(fixture.workspaceRoot, 'task_internal_1', 'outputs', 'result.txt')
      }
    });
    await expect(readFile(join(fixture.workspaceRoot, 'task_internal_1', 'outputs', 'result.txt'), 'utf8'))
      .resolves.toBe('Echo: Summarize this note\n');
  });

  test('rejects non-internal agent definitions before creating a task', async () => {
    const fixture = await setup();
    const tool = createDelegateToInternalTool({
      registry: createLinnsyAgentRegistry({
        definitions: [externalDefinition()],
        autoRegisterMain: false,
        defaultAgentId: 'delegate_to_codex'
      }),
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      runner: createInternalSubAgentRunner({
        taskTracker: fixture.tracker,
        executor: createEchoInternalSubAgentExecutor()
      }),
      taskIdFactory: () => 'task_should_not_exist'
    });

    await expect(tool.execute({
      definitionKey: 'delegate_to_codex',
      goal: 'Nope'
    }, toolContext())).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.DEFINITION_INVALID });
    await expect(fixture.tracker.get('task_should_not_exist')).resolves.toBeNull();
  });

  test('enforces internal subagent concurrency limit before accepting another task', async () => {
    const fixture = await setup();
    const callbacks: Array<() => Promise<void>> = [];
    const runner = createInternalSubAgentRunner({
      taskTracker: fixture.tracker,
      executor: createEchoInternalSubAgentExecutor(),
      maxConcurrency: 1,
      scheduler: (callback) => callbacks.push(callback)
    });
    const workspace = createWorkspaceManager({ root: fixture.workspaceRoot });
    const firstWorkspace = await workspace.create('task_1');
    const secondWorkspace = await workspace.create('task_2');

    runner.spawn({
      taskId: 'task_1',
      definitionKey: 'linnsy_echo_subagent',
      goal: 'first',
      workspacePath: firstWorkspace
    });
    let thrown: unknown;
    try {
      runner.spawn({
        taskId: 'task_2',
        definitionKey: 'linnsy_echo_subagent',
        goal: 'second',
        workspacePath: secondWorkspace
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: LINNSY_ERROR_CODES.INTERNAL_AGENT_SPAWN_FAILED });
  });

  test('marks an internal task failed when executor rejects', async () => {
    const fixture = await setup();
    const callbacks: Array<() => Promise<void>> = [];
    const runner = createInternalSubAgentRunner({
      taskTracker: fixture.tracker,
      executor: {
        execute() {
          return Promise.reject(new Error('boom'));
        }
      },
      scheduler: (callback) => callbacks.push(callback)
    });
    await fixture.tracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Fail',
      status: 'dispatched',
      kind: 'internal_subagent'
    });
    const workspacePath = await createWorkspaceManager({ root: fixture.workspaceRoot }).create('task_1');

    runner.spawn({
      taskId: 'task_1',
      definitionKey: 'linnsy_echo_subagent',
      goal: 'fail',
      workspacePath
    });
    await callbacks[0]?.();

    await expect(fixture.tracker.get('task_1')).resolves.toMatchObject({
      status: 'failed',
      result: { errorMessage: 'boom' }
    });
  });

  test('registers delegate_to_internal in the tool runtime', async () => {
    const fixture = await setup();
    const runtime = createLinnsyToolRuntime({
      tools: [
        createDelegateToInternalTool({
          registry: createLinnsyAgentRegistry({
            definitions: [createLinnsyEchoSubagentDefinition()],
            autoRegisterMain: false,
            defaultAgentId: 'linnsy_echo_subagent'
          }),
          taskTracker: fixture.tracker,
          workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
          runner: createInternalSubAgentRunner({
            taskTracker: fixture.tracker,
            executor: createEchoInternalSubAgentExecutor()
          }),
          taskIdFactory: () => 'task_1'
        })
      ]
    });

    expect(runtime.getToolSchemas().map((schema) => schema.function.name)).toEqual(['delegate_to_internal']);
  });
});

function toolContext(): ToolExecutionContext {
  return {
    runId: 'run_1',
    conversationId: 'conv_1',
    turnId: 'turn_1',
    user_query: 'delegate internally'
  };
}

function externalDefinition() {
  return {
    id: 'delegate_to_codex',
    displayName: 'Codex',
    description: 'Mock Codex adapter',
    systemPromptId: 'delegate_to_codex',
    basePrompt: 'Mock Codex adapter prompt',
    modelPolicy: { model: 'default' },
    toolPolicy: { allowedToolIds: [] },
    memoryPolicy: {
      includeConversationSummary: false,
      includeLongTermMemory: false
    },
    metadata: { kind: 'external_agent' },
    enabled: true
  };
}
