import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTaskStore } from '../../../../persistence/sqlite-task-store.js';
import type { TaskLocator, TaskRecord, TaskStatus } from '../../../../definitions/task.js';
import { createTaskTracker } from '../../../tracker/task-tracker.js';
import { createCodexExecDispatcher } from '../codex-exec-dispatcher.js';

interface SmokeFixture {
  home: string;
  db: Database.Database;
  tracker: ReturnType<typeof createTaskTracker>;
  workspaceRoot: string;
}

const execFileAsync = promisify(execFile);
const fixtures: SmokeFixture[] = [];
const runRealCodexSmoke = process.env.LINNSY_TEST_REAL_CODEX === '1';
const realCodexSmokeModel = process.env.LINNSY_TEST_REAL_CODEX_MODEL ?? 'gpt-5.4';
const realCodexTest = runRealCodexSmoke ? test : test.skip;

async function setupSmokeFixture(): Promise<SmokeFixture> {
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

describe('Codex real smoke', () => {
  realCodexTest('runs a real codex exec task inside a disposable git repo', async () => {
    const fixture = await setupSmokeFixture();
    const projectPath = join(fixture.home, 'real-codex-project');
    await mkdir(projectPath, { recursive: true });
    await writeFile(join(projectPath, 'smoke.txt'), 'before\n', 'utf8');
    await execFileAsync('git', ['init'], { cwd: projectPath });
    await execFileAsync('git', ['add', 'smoke.txt'], { cwd: projectPath });
    await execFileAsync('git', ['commit', '-m', 'seed smoke file'], {
      cwd: projectPath,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Linnsy Smoke',
        GIT_AUTHOR_EMAIL: 'linnsy-smoke@example.test',
        GIT_COMMITTER_NAME: 'Linnsy Smoke',
        GIT_COMMITTER_EMAIL: 'linnsy-smoke@example.test'
      }
    });

    const locator: TaskLocator = {
      kind: 'directory',
      label: 'real-codex-smoke',
      ref: projectPath
    };
    await seedExternalTask(fixture, 'task_real_codex', 'dispatched', {
      prompt: [
        'You are running inside a disposable git repository for a Linnsy smoke test.',
        'Edit only smoke.txt.',
        'Replace the entire file contents with exactly:',
        'codex smoke ok',
        'Do not modify any other file. Do not run network commands.',
        'When finished, briefly report the changed file.'
      ].join('\n')
    }, locator);
    const dispatcher = createCodexExecDispatcher({
      taskTracker: fixture.tracker,
      command: process.env.LINNSY_TEST_REAL_CODEX_COMMAND ?? 'codex',
      model: realCodexSmokeModel,
      sandbox: 'workspace-write'
    });

    await dispatcher.dispatch({
      taskId: 'task_real_codex',
      definitionKey: 'delegate_to_codex',
      locator,
      workspacePath: join(fixture.workspaceRoot, 'task_real_codex'),
      payload: {
        prompt: [
          'You are running inside a disposable git repository for a Linnsy smoke test.',
          'Edit only smoke.txt.',
          'Replace the entire file contents with exactly:',
          'codex smoke ok',
          'Do not modify any other file. Do not run network commands.',
          'When finished, briefly report the changed file.'
        ].join('\n')
      }
    });

    const task = await waitForTaskStatus(fixture, 'task_real_codex', 'completed', 180_000);
    const smokeText = await readFile(join(projectPath, 'smoke.txt'), 'utf8');
    const { stdout: diffNameOnly } = await execFileAsync('git', ['diff', '--name-only'], { cwd: projectPath });

    expect(smokeText).toBe('codex smoke ok\n');
    expect(diffNameOnly.trim()).toBe('smoke.txt');
    expect(task.externalRef).toBeDefined();
    expect(task.payload?.lastFinalMessage).toEqual(expect.any(String));
    expect(task.result?.finalMessage).toEqual(expect.any(String));
  }, 240_000);
});

async function seedExternalTask(
  fixture: SmokeFixture,
  taskId: string,
  status: TaskStatus,
  payload: Record<string, unknown>,
  locator: TaskLocator
): Promise<void> {
  await fixture.tracker.upsert({
    taskId,
    conversationId: 'conv_1',
    title: taskId,
    status,
    kind: 'external',
    workspacePath: join(fixture.workspaceRoot, taskId),
    locator,
    payload
  });
}

async function waitForTaskStatus(
  fixture: SmokeFixture,
  taskId: string,
  status: TaskStatus,
  timeoutMs: number
): Promise<TaskRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await fixture.tracker.get(taskId);
    if (task?.status === status) {
      return task;
    }
    if (task?.status === 'failed') {
      throw new Error(`real codex smoke failed: ${readTaskErrorMessage(task)}`);
    }
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 250);
    });
  }
  const latest = await fixture.tracker.get(taskId);
  throw new Error(`task ${taskId} did not reach ${status}; latest=${latest?.status ?? 'missing'}`);
}

function readTaskErrorMessage(task: TaskRecord): string {
  const errorMessage = task.result?.errorMessage;
  if (typeof errorMessage === 'string') {
    return errorMessage;
  }
  if (errorMessage === undefined) {
    return 'unknown error';
  }
  return JSON.stringify(errorMessage);
}
