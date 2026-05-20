import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import type { CodexConnectionState } from '../../../../desktop-integration/definitions/application-connections.js';

export interface CodexProbeExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface CodexProbeChildProcess {
  stdout: Readable;
  stderr: Readable;
  done: Promise<CodexProbeExit>;
  kill(signal?: NodeJS.Signals): void;
}

export type CodexProbeRunner = (command: string, args: string[]) => CodexProbeChildProcess;

type CodexProbeCompletion =
  | { type: 'exit'; exit: CodexProbeExit }
  | { type: 'timeout' };

export interface CodexProbePort {
  probe(): Promise<CodexConnectionState>;
}

export interface CreateCodexProbeOptions {
  command?: string;
  now?: () => number;
  processRunner?: CodexProbeRunner;
  timeoutMs?: number;
}

const defaultCommand = 'codex';
const defaultTimeoutMs = 5000;

export function createCodexProbe(options: CreateCodexProbeOptions = {}): CodexProbePort {
  const command = options.command ?? defaultCommand;
  const now = options.now ?? Date.now;
  const processRunner = options.processRunner ?? spawnCodexVersionProcess;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

  return {
    async probe(): Promise<CodexConnectionState> {
      return probeCodexCommand({
        command,
        now,
        processRunner,
        timeoutMs
      });
    }
  };
}

async function probeCodexCommand(input: {
  command: string;
  now: () => number;
  processRunner: CodexProbeRunner;
  timeoutMs: number;
}): Promise<CodexConnectionState> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let child: CodexProbeChildProcess;
  try {
    child = input.processRunner(input.command, ['--version']);
  } catch (error: unknown) {
    return buildFailedProbe(input.command, input.now(), error);
  }

  child.stdout.on('data', (chunk: Buffer | string) => {
    stdoutChunks.push(String(chunk));
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    stderrChunks.push(String(chunk));
  });

  let resolveTimeout: (value: CodexProbeCompletion) => void = () => {};
  const timeoutCompletion = new Promise<CodexProbeCompletion>((resolve) => {
    resolveTimeout = resolve;
  });
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    resolveTimeout({ type: 'timeout' });
  }, input.timeoutMs);

  try {
    const completion: CodexProbeCompletion = await Promise.race([
      child.done.then((exit): CodexProbeCompletion => ({ type: 'exit', exit })),
      timeoutCompletion
    ]);
    if (completion.type === 'timeout') {
      return {
        status: 'failed',
        command: input.command,
        checkedAt: input.now(),
        errorMessage: `codex --version timed out after ${String(input.timeoutMs)}ms`
      };
    }
    const exit = completion.exit;
    if (exit.exitCode === 0) {
      const version = readVersion(stdoutChunks, stderrChunks);
      return {
        status: 'available',
        command: input.command,
        checkedAt: input.now(),
        ...(version === undefined ? {} : { version })
      };
    }
    return {
      status: 'failed',
      command: input.command,
      checkedAt: input.now(),
      errorMessage: buildVersionFailureMessage(exit, stderrChunks)
    };
  } catch (error: unknown) {
    return buildFailedProbe(input.command, input.now(), error);
  } finally {
    clearTimeout(timeout);
  }
}

function spawnCodexVersionProcess(command: string, args: string[]): CodexProbeChildProcess {
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

function buildFailedProbe(command: string, checkedAt: number, error: unknown): CodexConnectionState {
  if (isExecutableNotFoundError(error)) {
    return {
      status: 'not_found',
      command,
      checkedAt,
      errorMessage: readErrorMessage(error)
    };
  }
  return {
    status: 'failed',
    command,
    checkedAt,
    errorMessage: readErrorMessage(error)
  };
}

function readVersion(stdoutChunks: readonly string[], stderrChunks: readonly string[]): string | undefined {
  const output = [...stdoutChunks, ...stderrChunks]
    .join('')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return output;
}

function buildVersionFailureMessage(exit: CodexProbeExit, stderrChunks: readonly string[]): string {
  const stderr = stderrChunks.join('').trim();
  const status = exit.signal === null
    ? `exitCode=${String(exit.exitCode)}`
    : `signal=${exit.signal}`;
  return stderr.length === 0 ? `codex --version failed: ${status}` : `codex --version failed: ${status}; stderr=${stderr}`;
}

function isExecutableNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
