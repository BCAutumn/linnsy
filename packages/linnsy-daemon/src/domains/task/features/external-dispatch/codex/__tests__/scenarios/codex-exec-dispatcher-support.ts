import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import Database from 'better-sqlite3';
import { afterEach } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteTaskStore } from '../../../../../persistence/sqlite-task-store.js';
import { LINNSY_ERROR_CODES } from '../../../../../../../shared/errors.js';
import type { TaskLocator, TaskRecord, TaskStatus } from '../../../../../definitions/task.js';
import type { TaskWakeHook } from '../../../../../ports/task-tracker-port.js';
import { createTaskTracker } from '../../../../tracker/task-tracker.js';
import {
  createCodexExecDispatcher,
  type CodexChildProcess,
  type CodexProcessRunner
} from '../../codex-exec-dispatcher.js';

export interface Fixture {
  home: string;
  db: Database.Database;
  tracker: ReturnType<typeof createTaskTracker>;
  workspaceRoot: string;
}

export interface CapturedRun {
  command: string;
  args: string[];
}

const fixtures: Fixture[] = [];

export async function setup(options: { wakeMainOnTransition?: () => TaskWakeHook | undefined } = {}): Promise<Fixture> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const tasks = new SqliteTaskStore(db);
  const tracker = createTaskTracker({
    tasks,
    clock: { now: () => 1_000 },
    ...(options.wakeMainOnTransition === undefined ? {} : { wakeMainOnTransition: options.wakeMainOnTransition })
  });
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


export async function seedExternalTask(
  fixture: Fixture,
  taskId: string,
  status: TaskStatus,
  payload: Record<string, unknown>,
  externalRef?: string,
  locator?: TaskLocator
): Promise<void> {
  const effectiveLocator = arguments.length >= 6 ? locator : projectLocator();
  await fixture.tracker.upsert({
    taskId,
    conversationId: 'conv_1',
    title: taskId,
    status,
    kind: 'external',
    workspacePath: join(fixture.workspaceRoot, taskId),
    ...(effectiveLocator === undefined ? {} : { locator: effectiveLocator }),
    payload,
    ...(externalRef === undefined ? {} : { externalRef })
  });
}

export async function writeFakeCodexExecutable(root: string): Promise<string> {
  const binDir = join(root, 'bin');
  const executablePath = join(binDir, 'fake-codex');
  await mkdir(binDir, { recursive: true });
  await writeFile(executablePath, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    "const argsPath = process.env.LINNSY_FAKE_CODEX_ARGS_PATH;",
    "if (typeof argsPath === 'string') {",
    "  fs.writeFileSync(argsPath, JSON.stringify(args), 'utf8');",
    '}',
    "const finalIndex = args.indexOf('--output-last-message');",
    'const finalPath = args[finalIndex + 1];',
    "if (typeof finalPath === 'string') {",
    "  fs.writeFileSync(finalPath, 'fake codex final', 'utf8');",
    '}',
    "process.stdout.write(JSON.stringify({ type: 'session.started', session_id: 'fake_session' }) + '\\n');",
    "process.stdout.write(JSON.stringify({ type: 'assistant.delta', message: 'fake progress' }) + '\\n');"
  ].join('\n'), 'utf8');
  await chmod(executablePath, 0o755);
  return executablePath;
}

export async function readCapturedArgs(path: string): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('fake codex args must be a string array');
  }
  return parsed;
}

export function restoreFakeCodexArgsPath(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.LINNSY_FAKE_CODEX_ARGS_PATH;
  } else {
    process.env.LINNSY_FAKE_CODEX_ARGS_PATH = value;
  }
}

export function createProcessRunner(input: {
  capturedRuns: CapturedRun[];
  stdoutLines: Array<Record<string, unknown>>;
  finalMessage?: string;
  stderrText?: string;
  exitCode?: number;
}): CodexProcessRunner {
  return (command, args) => {
    input.capturedRuns.push({ command, args });
    const finalMessagePath = readFinalMessagePath(args);
    if (input.finalMessage !== undefined) {
      void writeFile(finalMessagePath, input.finalMessage, 'utf8');
    }
    return {
      stdout: Readable.from(input.stdoutLines.map((line) => `${JSON.stringify(line)}\n`)),
      stderr: Readable.from(input.stderrText === undefined ? [] : [input.stderrText]),
      done: Promise.resolve({
        exitCode: input.exitCode ?? 0,
        signal: null
      }),
      kill() {}
    };
  };
}

export function createLongRunningProcessRunner(killedSignals: Array<NodeJS.Signals | undefined>): CodexProcessRunner {
  return () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let resolveDone: (exit: { exitCode: number | null; signal: NodeJS.Signals | null }) => void = () => {};
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      resolveDone = resolve;
    });
    const child: CodexChildProcess = {
      stdout,
      stderr,
      done,
      kill(signal) {
        killedSignals.push(signal);
        stdout.end();
        stderr.end();
        resolveDone({ exitCode: null, signal: signal ?? null });
      }
    };
    return child;
  };
}

export function readFinalMessagePath(args: string[]): string {
  const index = args.indexOf('--output-last-message');
  const path = args[index + 1];
  if (index < 0 || path === undefined) {
    throw new Error('missing --output-last-message');
  }
  return path;
}

export function projectLocator(ref = process.cwd()): TaskLocator {
  return {
    kind: 'directory',
    label: 'project',
    ref
  };
}

export async function waitForTaskStatus(
  fixture: Fixture,
  taskId: string,
  status: TaskStatus
): Promise<TaskRecord> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const task = await fixture.tracker.get(taskId);
    if (task?.status === status) {
      return task;
    }
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 5);
    });
  }
  const latest = await fixture.tracker.get(taskId);
  throw new Error(`task ${taskId} did not reach ${status}; latest=${latest?.status ?? 'missing'}`);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export { chmod, mkdir, readFile, rm, writeFile, join, PassThrough, Readable, Database, LINNSY_ERROR_CODES, createTaskTracker, createCodexExecDispatcher };
export type { TaskLocator, TaskRecord, TaskStatus, CodexChildProcess, CodexProcessRunner };
