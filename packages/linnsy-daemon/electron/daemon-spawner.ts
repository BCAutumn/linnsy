import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DaemonDesktopStatus } from '../src/domains/desktop-integration/definitions/desktop-daemon-contract.js';

export type DaemonStatusListener = (status: DaemonDesktopStatus) => void;

export interface DaemonSpawner {
  start(env?: NodeJS.ProcessEnv, args?: string[]): void;
  stop(): Promise<void>;
  restart(env?: NodeJS.ProcessEnv): Promise<void>;
  isRunning(): boolean;
  getStatus(): DaemonDesktopStatus;
  subscribe(listener: DaemonStatusListener): () => void;
}

export interface CreateDaemonSpawnerOptions {
  packageRoot: string;
  scriptName?: string;
  env?: NodeJS.ProcessEnv;
  externalModeEnv?: string;
  onLog?: (message: string) => void;
  onStatusChanged?: DaemonStatusListener;
  stopTimeoutMs?: number;
}

const DEFAULT_STOP_TIMEOUT_MS = 2_500;

export function createDaemonSpawner(options: CreateDaemonSpawnerOptions): DaemonSpawner {
  let child: ChildProcessWithoutNullStreams | null = null;
  let status: DaemonDesktopStatus = { lifecycle: 'stopped', running: false };
  let stopping = false;
  let stopPromise: Promise<void> | null = null;
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const listeners = new Set<DaemonStatusListener>();

  const emitStatus = (nextStatus: DaemonDesktopStatus): void => {
    status = nextStatus;
    options.onStatusChanged?.(nextStatus);
    for (const listener of listeners) {
      listener(nextStatus);
    }
  };

  return {
    start(env?: NodeJS.ProcessEnv, args: string[] = []): void {
      if (child !== null || stopping || stopPromise !== null || isExternalModeEnabled(options.externalModeEnv)) {
        return;
      }
      emitStatus({ lifecycle: 'starting', running: true });
      const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const active = spawn(npmBin, ['run', options.scriptName ?? 'dev:daemon', ...args], {
        cwd: options.packageRoot,
        env: { ...process.env, ...options.env, ...env },
        detached: process.platform !== 'win32',
        stdio: 'pipe'
      });
      child = active;
      stopping = false;
      active.stdout.on('data', (chunk: Buffer) => options.onLog?.(chunk.toString('utf8').trim()));
      active.stderr.on('data', (chunk: Buffer) => options.onLog?.(chunk.toString('utf8').trim()));
      active.on('spawn', () => {
        emitStatus({ lifecycle: 'running', running: true });
      });
      active.on('error', (error) => {
        if (child === active) {
          child = null;
        }
        if (stopPromise !== null) {
          stopPromise = null;
        }
        stopping = false;
        emitStatus({
          lifecycle: 'failed',
          running: false,
          detail: error.message
        });
      });
      active.on('exit', (code, signal) => {
        if (child === active) {
          child = null;
        }
        const expectedStop = stopping || signal === 'SIGTERM' || signal === 'SIGKILL';
        stopping = false;
        stopPromise = null;
        emitStatus({
          lifecycle: expectedStop || code === 0 ? 'stopped' : 'failed',
          running: false,
          ...(code === null ? {} : { exitCode: code }),
          ...(signal === null ? {} : { signal })
        });
      });
    },

    stop(): Promise<void> {
      if (child === null) {
        return stopPromise ?? Promise.resolve();
      }
      const active = child;
      if (stopPromise !== null) {
        return stopPromise;
      }
      stopping = true;
      stopPromise = new Promise((resolve) => {
        let settled = false;
        let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
        const finish = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (forceKillTimer !== null) {
            clearTimeout(forceKillTimer);
          }
          if (child === active) {
            child = null;
          }
          stopping = false;
          stopPromise = null;
          resolve();
        };
        forceKillTimer = setTimeout(() => {
          killProcessTree(active, 'SIGKILL');
          finish();
        }, stopTimeoutMs);
        active.once('exit', () => {
          finish();
        });
        killProcessTree(active, 'SIGTERM');
      });
      return stopPromise;
    },

    async restart(env?: NodeJS.ProcessEnv): Promise<void> {
      await this.stop();
      this.start(env);
    },

    isRunning(): boolean {
      return child !== null || isExternalModeEnabled(options.externalModeEnv);
    },

    getStatus(): DaemonDesktopStatus {
      if (isExternalModeEnabled(options.externalModeEnv)) {
        return { lifecycle: 'running', running: true, detail: 'external daemon mode' };
      }
      return status;
    },

    subscribe(listener: DaemonStatusListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

function isExternalModeEnabled(envName: string | undefined): boolean {
  return envName !== undefined && process.env[envName] === '1';
}

function killProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      // detached 子进程拥有独立进程组，负 pid 可以同时收掉 npm 与它拉起的脚本。
      process.kill(-child.pid, signal);
      return;
    } catch {
      // 进程可能已经退出，继续走普通 kill 作为兜底。
    }
  }
  child.kill(signal);
}

export function resolvePackageRoot(importMetaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..');
}
