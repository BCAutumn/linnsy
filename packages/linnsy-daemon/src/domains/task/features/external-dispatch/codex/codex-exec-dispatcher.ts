import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { TaskRecord } from '../../../definitions/task.js';
import type { TaskTrackerPort } from '../../../ports/task-tracker-port.js';
import type {
  ExternalAgentCancelInput,
  ExternalAgentContinueInput,
  ExternalAgentDispatcherPort,
  ExternalAgentDispatchInput
} from '../types.js';

import { normalizeCodexEvent, parseCodexJsonLine } from './codex-event-normalizer.js';
import { assertCodexCwdDirectory, readCodexCwd } from './codex-locator.js';

export interface CodexProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface CodexChildProcess {
  stdout: Readable;
  stderr: Readable;
  done: Promise<CodexProcessExit>;
  kill(signal?: NodeJS.Signals): void;
}

export type CodexProcessRunner = (command: string, args: string[]) => CodexChildProcess;

export interface CreateCodexExecDispatcherOptions {
  taskTracker: TaskTrackerPort;
  command?: string;
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  model?: string;
  processRunner?: CodexProcessRunner;
}

interface CodexRunInput {
  taskId: string;
  cwd: string;
  prompt: string;
  workspacePath: string;
  mode: 'new' | 'resume';
  sessionId?: string;
}

const defaultCommand = 'codex';
const defaultSandbox = 'workspace-write';

export function createCodexExecDispatcher(options: CreateCodexExecDispatcherOptions): ExternalAgentDispatcherPort {
  const activeProcesses = new Map<string, CodexChildProcess>();
  const processRunner = options.processRunner ?? spawnCodexProcess;
  const command = options.command ?? defaultCommand;
  const sandbox = options.sandbox ?? defaultSandbox;

  return {
    async dispatch(input: ExternalAgentDispatchInput): Promise<void> {
      const runInput = readDispatchRunInput(input);
      await assertCodexCwdDirectory(runInput.cwd);
      await startCodexRun({
        taskTracker: options.taskTracker,
        activeProcesses,
        processRunner,
        command,
        sandbox,
        model: options.model,
        runInput
      });
    },

    async continue(input: ExternalAgentContinueInput): Promise<void> {
      const task = await readTask(options.taskTracker, input.taskId);
      if (task.externalRef === undefined || task.externalRef.trim().length === 0) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.EXTERNAL_SESSION_NOT_FOUND,
          `codex session id is missing for task ${input.taskId}`,
          false
        );
      }
      const runInput = readContinueRunInput(task, input);
      await assertCodexCwdDirectory(runInput.cwd);
      await startCodexRun({
        taskTracker: options.taskTracker,
        activeProcesses,
        processRunner,
        command,
        sandbox,
        model: options.model,
        runInput
      });
    },

    cancel(input: ExternalAgentCancelInput): Promise<void> {
      activeProcesses.get(input.taskId)?.kill('SIGTERM');
      activeProcesses.delete(input.taskId);
      return Promise.resolve();
    }
  };
}

function spawnCodexProcess(command: string, args: string[]): CodexChildProcess {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    done: new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode, signal) => {
        resolve({ exitCode, signal });
      });
    }),
    kill(signal?: NodeJS.Signals): void {
      child.kill(signal);
    }
  };
}

async function startCodexRun(input: {
  taskTracker: TaskTrackerPort;
  activeProcesses: Map<string, CodexChildProcess>;
  processRunner: CodexProcessRunner;
  command: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  model: string | undefined;
  runInput: CodexRunInput;
}): Promise<void> {
  await mkdir(input.runInput.workspacePath, { recursive: true });
  const finalMessagePath = join(input.runInput.workspacePath, 'codex-final.txt');
  const args = buildCodexArgs(input.runInput, input.sandbox, finalMessagePath, input.model);
  const child = input.processRunner(input.command, args);
  input.activeProcesses.set(input.runInput.taskId, child);
  void consumeCodexRun({
    taskTracker: input.taskTracker,
    activeProcesses: input.activeProcesses,
    taskId: input.runInput.taskId,
    child,
    finalMessagePath
  });
}

function buildCodexArgs(
  input: CodexRunInput,
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access',
  finalMessagePath: string,
  model: string | undefined
): string[] {
  if (input.mode === 'resume') {
    const args = [
      'exec',
      'resume',
      '--skip-git-repo-check',
      '--json',
      '--output-last-message',
      finalMessagePath
    ];
    if (model !== undefined) {
      args.push('--model', model);
    }
    args.push(readRequired(input.sessionId, 'sessionId'), input.prompt);
    return args;
  }

  const args = [
    'exec',
    '--cd',
    input.cwd,
    '--skip-git-repo-check',
    '--sandbox',
    sandbox,
    '--json',
    '--output-last-message',
    finalMessagePath
  ];
  if (model !== undefined) {
    args.push('--model', model);
  }
  args.push(input.prompt);
  return args;
}

async function consumeCodexRun(input: {
  taskTracker: TaskTrackerPort;
  activeProcesses: Map<string, CodexChildProcess>;
  taskId: string;
  child: CodexChildProcess;
  finalMessagePath: string;
}): Promise<void> {
  const stderrChunks: string[] = [];
  input.child.stderr.on('data', (chunk: Buffer | string) => {
    stderrChunks.push(String(chunk));
  });

  let finalMessage: string | undefined;
  try {
    const lines = createInterface({ input: input.child.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      const raw = parseCodexJsonLine(line);
      if (raw === null) {
        continue;
      }
      const event = normalizeCodexEvent(raw);
      if (event.sessionId !== undefined) {
        await patchTask(input.taskTracker, input.taskId, { externalRef: event.sessionId });
      }
      if (event.finalMessage !== undefined) {
        finalMessage = event.finalMessage;
      }
      if (event.errorMessage !== undefined) {
        await reportCodexFailure(input.taskTracker, input.taskId, {
          node: event.node,
          errorMessage: event.errorMessage
        });
      } else {
        await input.taskTracker.onExternalUpdate(input.taskId, withOptionalPartialResult({
          node: event.node
        }, event.partialResult));
      }
    }

    const exit = await input.child.done;
    const wasCancelledByDispatcher = input.activeProcesses.get(input.taskId) !== input.child;
    input.activeProcesses.delete(input.taskId);
    if (wasCancelledByDispatcher) {
      return;
    }
    if (exit.exitCode !== 0) {
      await reportCodexFailure(input.taskTracker, input.taskId, {
        node: 'codex.exit',
        errorMessage: buildExitError(exit, stderrChunks)
      });
      return;
    }

    const fileFinalMessage = await readFinalMessageFile(input.finalMessagePath);
    const resolvedFinalMessage = fileFinalMessage ?? finalMessage ?? '';
    await patchTask(input.taskTracker, input.taskId, {
      payload: {
        ...((await readTask(input.taskTracker, input.taskId)).payload ?? {}),
        lastFinalMessage: resolvedFinalMessage
      }
    });
    await input.taskTracker.onExternalUpdate(input.taskId, {
      node: 'codex.completed',
      finalResult: {
        finalMessage: resolvedFinalMessage,
        exitCode: exit.exitCode,
        outputLastMessagePath: input.finalMessagePath
      }
    });
  } catch (error: unknown) {
    input.activeProcesses.delete(input.taskId);
    await reportCodexFailure(input.taskTracker, input.taskId, {
      node: 'codex.error',
      errorMessage: error instanceof Error ? error.message : String(error)
    });
  }
}

async function reportCodexFailure(
  taskTracker: TaskTrackerPort,
  taskId: string,
  update: { node: string; errorMessage: string }
): Promise<void> {
  const task = await readTask(taskTracker, taskId);
  if (task.status === 'failed') {
    return;
  }
  await taskTracker.onExternalUpdate(taskId, update);
}

function readDispatchRunInput(input: ExternalAgentDispatchInput): CodexRunInput {
  return {
    taskId: input.taskId,
    cwd: readCodexCwd(input.locator),
    prompt: readPayloadPrompt(input.payload),
    workspacePath: input.workspacePath,
    mode: 'new'
  };
}

function readContinueRunInput(task: TaskRecord, input: ExternalAgentContinueInput): CodexRunInput {
  const lastFinalMessage = typeof task.payload?.lastFinalMessage === 'string'
    ? task.payload.lastFinalMessage
    : '';
  return {
    taskId: input.taskId,
    cwd: readCodexCwd(task.locator),
    prompt: [input.message, lastFinalMessage].filter((part) => part.trim().length > 0).join('\n\n上次 Codex 最终消息：\n'),
    workspacePath: readRequired(task.workspacePath, 'workspacePath'),
    mode: 'resume',
    sessionId: readRequired(task.externalRef, 'sessionId')
  };
}

function withOptionalPartialResult(
  update: { node: string; partialResult?: Record<string, unknown> },
  partialResult: Record<string, unknown> | undefined
): { node: string; partialResult?: Record<string, unknown> } {
  if (partialResult !== undefined) {
    update.partialResult = partialResult;
  }
  return update;
}

function readPayloadPrompt(payload: Record<string, unknown> | undefined): string {
  const value = payload?.prompt;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.EXTERNAL_DISPATCH_FAILED,
      'codex dispatcher requires payload.prompt',
      false
    );
  }
  return value.trim();
}

function readRequired(value: string | undefined, label: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.EXTERNAL_DISPATCH_FAILED,
      `codex dispatcher requires ${label}`,
      false
    );
  }
  return value;
}

async function readTask(taskTracker: TaskTrackerPort, taskId: string): Promise<TaskRecord> {
  const task = await taskTracker.get(taskId);
  if (task === null) {
    throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${taskId} was not found`, false);
  }
  return task;
}

async function patchTask(
  taskTracker: TaskTrackerPort,
  taskId: string,
  patch: Partial<TaskRecord>
): Promise<void> {
  const task = await readTask(taskTracker, taskId);
  await taskTracker.upsert({
    ...task,
    ...patch
  });
}

async function readFinalMessageFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

function buildExitError(exit: CodexProcessExit, stderrChunks: string[]): string {
  const stderr = stderrChunks.join('').trim();
  const status = exit.signal === null
    ? `exitCode=${String(exit.exitCode)}`
    : `signal=${exit.signal}`;
  return stderr.length === 0 ? `codex exec failed: ${status}` : `codex exec failed: ${status}; stderr=${stderr}`;
}
