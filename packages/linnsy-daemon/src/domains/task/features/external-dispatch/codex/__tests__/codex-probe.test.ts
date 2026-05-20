import { PassThrough } from 'node:stream';

import { describe, expect, test } from 'vitest';

import { createCodexProbe, type CodexProbeChildProcess, type CodexProbeRunner } from '../codex-probe.js';

describe('codex probe', () => {
  test('reports available when codex --version exits successfully', async () => {
    const probe = createCodexProbe({
      command: 'fake-codex',
      now: () => 100,
      processRunner: createProbeRunner({
        stdout: 'codex-cli 1.2.3\n',
        exitCode: 0
      })
    });

    await expect(probe.probe()).resolves.toEqual({
      status: 'available',
      command: 'fake-codex',
      checkedAt: 100,
      version: 'codex-cli 1.2.3'
    });
  });

  test('reports not_found when the executable is missing', async () => {
    const probe = createCodexProbe({
      command: '/missing/codex',
      now: () => 101,
      processRunner: () => {
        const error = new Error('spawn /missing/codex ENOENT');
        Object.assign(error, { code: 'ENOENT' });
        throw error;
      }
    });

    await expect(probe.probe()).resolves.toEqual({
      status: 'not_found',
      command: '/missing/codex',
      checkedAt: 101,
      errorMessage: 'spawn /missing/codex ENOENT'
    });
  });

  test('reports failed when codex --version exits non-zero', async () => {
    const probe = createCodexProbe({
      command: 'fake-codex',
      now: () => 102,
      processRunner: createProbeRunner({
        stderr: 'not logged in\n',
        exitCode: 2
      })
    });

    await expect(probe.probe()).resolves.toEqual({
      status: 'failed',
      command: 'fake-codex',
      checkedAt: 102,
      errorMessage: 'codex --version failed: exitCode=2; stderr=not logged in'
    });
  });
});

function createProbeRunner(input: {
  stdout?: string;
  stderr?: string;
  exitCode: number | null;
}): CodexProbeRunner {
  return (_command, args) => {
    expect(args).toEqual(['--version']);
    return createChildProcess(input);
  };
}

function createChildProcess(input: {
  stdout?: string;
  stderr?: string;
  exitCode: number | null;
}): CodexProbeChildProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    setTimeout(() => {
      if (input.stdout !== undefined) {
        stdout.write(input.stdout);
      }
      if (input.stderr !== undefined) {
        stderr.write(input.stderr);
      }
      stdout.end();
      stderr.end();
      resolve({ exitCode: input.exitCode, signal: null });
    }, 0);
  });
  return {
    stdout,
    stderr,
    done,
    kill: () => {}
  };
}
