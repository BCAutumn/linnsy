import { writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';
import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTaskStore } from '../../../../task/persistence/sqlite-task-store.js';
import type { TaskRecord, TaskStatus } from '../../../../task/definitions/task.js';
import { createLinnsyAgentRegistry } from '../../agents/registry/registry.js';
import type { CodexSessionBridgePort } from '../../../../task/features/external-dispatch/codex/codex-session-bridge.js';
import {
  createCodexExecDispatcher,
  type CodexProcessRunner
} from '../../../../task/features/external-dispatch/codex/codex-exec-dispatcher.js';
import { createTaskTracker } from '../../../../task/features/tracker/task-tracker.js';
import type { WorkspacePort } from '../../../../task/features/workspace/definitions/types.js';
import { createManageExternalSessionTool } from '../tools/manage-external-session.js';
import { createManageTaskTool } from '../tools/manage-task.js';

interface Fixture {
  home: string;
  db: Database.Database;
  projectDir: string;
  tracker: ReturnType<typeof createTaskTracker>;
  workspace: WorkspacePort;
}

const fixtures: Fixture[] = [];

async function setup(): Promise<Fixture> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const tasks = new SqliteTaskStore(db);
  const tracker = createTaskTracker({ tasks, clock: { now: () => 1_000 } });
  const projectDir = join(home, 'projects', 'linnsy');
  const workspaceRoot = join(home, 'workspaces');
  await mkdir(projectDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });

  await conversations.upsert({
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 10,
    updatedAt: 10
  });

  const fixture: Fixture = {
    home,
    db,
    projectDir,
    tracker,
    workspace: {
      async create(taskId) {
        const path = join(workspaceRoot, taskId);
        await mkdir(path, { recursive: true });
        return path;
      },
      resolve: (taskId) => Promise.resolve(join(workspaceRoot, taskId)),
      list: () => Promise.resolve([])
    }
  };
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

describe('external session tools', () => {
  test('manage_external_session lists Codex project groups when requested', async () => {
    const fixture = await setup();
    const tool = createManageExternalSessionTool({
      registry: createLinnsyAgentRegistry(),
      taskTracker: fixture.tracker,
      workspace: fixture.workspace,
      codexSessionBridge: codexBridge({
        listProjects: () => Promise.resolve([{
          cwd: fixture.projectDir,
          label: 'linnsy',
          threadCount: 2,
          latestUpdatedAt: 20
        }])
      })
    });

    const output = await tool.execute({
      action: 'list_projects',
      definitionKey: 'delegate_to_codex',
      limit: 5
    }, toolContext());

    expect(output.data).toMatchObject({
      provider: 'codex',
      action: 'list_projects',
      projects: [{
        cwd: fixture.projectDir,
        label: 'linnsy',
        threadCount: 2,
        latestUpdatedAt: 20
      }]
    });
    expect(output.observation).toContain('项目历史分组');
  });

  test('manage_external_session filters Codex threads by directory locator', async () => {
    const fixture = await setup();
    const calls: Array<{ cwd?: string; includeChildDirectories?: boolean; limit?: number }> = [];
    const tool = createManageExternalSessionTool({
      registry: createLinnsyAgentRegistry(),
      taskTracker: fixture.tracker,
      workspace: fixture.workspace,
      codexSessionBridge: codexBridge({
        listRecentThreads(input) {
          calls.push(input ?? {});
          return Promise.resolve([{
            id: 'session_1',
            cwd: fixture.projectDir,
            threadName: '继续 Linnsy',
            updatedAt: 30
          }]);
        }
      })
    });

    const output = await tool.execute({
      action: 'list_threads',
      definitionKey: 'codex',
      locator: { kind: 'directory', label: 'linnsy', ref: fixture.projectDir },
      includeChildDirectories: true,
      limit: 3
    }, toolContext());

    expect(calls).toEqual([{
      cwd: fixture.projectDir,
      includeChildDirectories: true,
      limit: 3
    }]);
    expect(output.data).toMatchObject({
      provider: 'codex',
      action: 'list_threads',
      threads: [{ id: 'session_1', cwd: fixture.projectDir }]
    });
  });

  test('manage_external_session attaches a completed Codex task bound to the session cwd', async () => {
    const fixture = await setup();
    const tool = createManageExternalSessionTool({
      registry: createLinnsyAgentRegistry(),
      taskTracker: fixture.tracker,
      workspace: fixture.workspace,
      codexSessionBridge: codexBridge({
        getThread: () => Promise.resolve({
          id: 'session_1',
          cwd: fixture.projectDir,
          threadName: '历史接管研究',
          updatedAt: 30
        })
      }),
      taskIdFactory: () => 'task_attached',
      now: () => 2_000
    });

    const output = await tool.execute({
      action: 'attach',
      definitionKey: 'delegate_to_codex',
      sessionId: 'session_1'
    }, toolContext());

    expect(output.data.task).toMatchObject({
      taskId: 'task_attached',
      conversationId: 'conv_1',
      status: 'completed',
      externalKind: 'codex',
      externalRef: 'session_1',
      locator: {
        kind: 'directory',
        label: 'linnsy',
        ref: fixture.projectDir,
        meta: {
          source: 'codex_history',
          codexSessionId: 'session_1'
        }
      },
      payload: {
        definitionKey: 'delegate_to_codex',
        source: 'codex_history',
        codexSessionId: 'session_1'
      },
      completedAt: 2_000
    });
    expect(output.observation).toContain('manage_task');
  });

  test('Codex history can be listed, attached, continued, and completed through the public tools', async () => {
    const fixture = await setup();
    const listThreadCalls: Array<{ cwd?: string; includeChildDirectories?: boolean; limit?: number }> = [];
    const capturedRuns: Array<{ command: string; args: string[] }> = [];
    const terminalWakes: Array<{ taskId: string; status: string; fromStatus: string }> = [];
    const tracker = createTaskTracker({
      tasks: new SqliteTaskStore(fixture.db),
      clock: { now: () => 1_000 },
      wakeMainOnTransition: () => ({ task, fromStatus }) => {
        terminalWakes.push({ taskId: task.taskId, status: task.status, fromStatus });
        return Promise.resolve();
      }
    });
    const externalSessionTool = createManageExternalSessionTool({
      registry: createLinnsyAgentRegistry(),
      taskTracker: tracker,
      workspace: fixture.workspace,
      codexSessionBridge: codexBridge({
        listProjects: () => Promise.resolve([{
          cwd: fixture.projectDir,
          label: 'linnsy',
          threadCount: 1,
          latestUpdatedAt: 30
        }]),
        listRecentThreads(input) {
          listThreadCalls.push(input ?? {});
          return Promise.resolve([{
            id: 'session_history',
            cwd: fixture.projectDir,
            threadName: '研究 Codex 历史续聊实现',
            updatedAt: 30
          }]);
        },
        getThread: () => Promise.resolve({
          id: 'session_history',
          cwd: fixture.projectDir,
          threadName: '研究 Codex 历史续聊实现',
          updatedAt: 30
        })
      }),
      taskIdFactory: () => 'task_history',
      now: () => 2_000
    });
    const dispatcher = createCodexExecDispatcher({
      taskTracker: tracker,
      processRunner: createCompletingCodexRunner({
        capturedRuns,
        finalMessage: '收到，Linnsy 历史续聊链路已打通。'
      })
    });
    const manageTaskTool = createManageTaskTool({
      taskTracker: tracker,
      dispatcher
    });

    const projects = await externalSessionTool.execute({
      action: 'list_projects',
      definitionKey: 'delegate_to_codex',
      limit: 5
    }, toolContext());
    const threads = await externalSessionTool.execute({
      action: 'list_threads',
      definitionKey: 'delegate_to_codex',
      locator: { kind: 'directory', label: 'linnsy', ref: fixture.projectDir },
      limit: 5
    }, toolContext());
    const attached = await externalSessionTool.execute({
      action: 'attach',
      definitionKey: 'delegate_to_codex',
      sessionId: 'session_history'
    }, toolContext());
    const continued = await manageTaskTool.execute({
      action: 'continue',
      taskId: 'task_history',
      message: '这是来自linnsy的测试，收到回复。'
    }, toolContext());
    const completed = await waitForTaskStatus(tracker, 'task_history', 'completed');

    expect(projects.data.projects).toHaveLength(1);
    expect(threads.data.threads).toHaveLength(1);
    expect(listThreadCalls).toEqual([{
      cwd: fixture.projectDir,
      includeChildDirectories: false,
      limit: 5
    }]);
    expect(attached.data.task).toMatchObject({
      taskId: 'task_history',
      status: 'completed',
      externalKind: 'codex',
      externalRef: 'session_history',
      locator: {
        kind: 'directory',
        ref: fixture.projectDir,
        meta: {
          source: 'codex_history',
          codexSessionId: 'session_history'
        }
      },
      payload: {
        definitionKey: 'delegate_to_codex',
        source: 'codex_history',
        codexSessionId: 'session_history'
      }
    });
    expect(continued.data).toMatchObject({
      action: 'continue',
      task: {
        taskId: 'task_history',
        status: 'in_progress'
      },
      message: '这是来自linnsy的测试，收到回复。'
    });
    expect(capturedRuns[0]?.args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(capturedRuns[0]?.args).toContain('session_history');
    expect(capturedRuns[0]?.args).not.toContain('--cd');
    expect(capturedRuns[0]?.args).not.toContain('--sandbox');
    expect(capturedRuns[0]?.args.at(-1)).toBe('这是来自linnsy的测试，收到回复。');
    expect(completed).toMatchObject({
      status: 'completed',
      externalRef: 'session_history',
      payload: {
        lastContinueMessage: '这是来自linnsy的测试，收到回复。',
        lastFinalMessage: '收到，Linnsy 历史续聊链路已打通。'
      },
      result: {
        finalMessage: '收到，Linnsy 历史续聊链路已打通。',
        exitCode: 0
      }
    });
    expect(terminalWakes).toEqual([{
      taskId: 'task_history',
      fromStatus: 'in_progress',
      status: 'completed'
    }]);
  });
});

function codexBridge(overrides: Partial<CodexSessionBridgePort>): CodexSessionBridgePort {
  return {
    summarizeTask: () => {
      throw new Error('not used');
    },
    listProjects: () => Promise.resolve([]),
    listRecentThreads: () => Promise.resolve([]),
    getThread: () => Promise.resolve(null),
    ...overrides
  };
}

function toolContext(): ToolExecutionContext {
  return {
    runId: 'run_1',
    conversationId: 'conv_1',
    turnId: 'turn_1',
    user_query: '继续这个 Codex 历史'
  };
}

function createCompletingCodexRunner(input: {
  capturedRuns: Array<{ command: string; args: string[] }>;
  finalMessage: string;
}): CodexProcessRunner {
  return (command, args) => {
    input.capturedRuns.push({ command, args });
    const finalMessagePath = readFinalMessagePath(args);
    writeFileSync(finalMessagePath, input.finalMessage, 'utf8');
    return {
      stdout: Readable.from([
        `${JSON.stringify({ type: 'session.resumed', session_id: 'session_history' })}\n`
      ]),
      stderr: Readable.from([]),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      kill() {}
    };
  };
}

function readFinalMessagePath(args: string[]): string {
  const outputIndex = args.indexOf('--output-last-message');
  const finalMessagePath = args[outputIndex + 1];
  if (outputIndex < 0 || finalMessagePath === undefined) {
    throw new Error('fake Codex runner requires --output-last-message');
  }
  return finalMessagePath;
}

async function waitForTaskStatus(
  tracker: ReturnType<typeof createTaskTracker>,
  taskId: string,
  status: TaskStatus
): Promise<TaskRecord> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const task = await tracker.get(taskId);
    if (task?.status === status) {
      return task;
    }
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 5);
    });
  }
  const latest = await tracker.get(taskId);
  throw new Error(`task ${taskId} did not reach ${status}; latest=${latest?.status ?? 'missing'}`);
}
