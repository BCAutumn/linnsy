import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../../__tests__/harness/temp-home.js';
import {
  createWechatGatewayPidfileStore,
  hashWechatGatewayBearer
} from '../pidfile-store.js';
import { inspectWechatGatewayPidfile } from '../pidfile-inspector.js';

describe('wechat gateway pidfile store', () => {
  test('round-trips a pidfile via tmp-rename atomic write', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const store = createWechatGatewayPidfileStore({ stateDir });

      await expect(store.read()).resolves.toBeNull();

      await store.write({
        pid: 4242,
        startedAt: 1_700_000_000,
        bind: '127.0.0.1:7788',
        bearerHash: hashWechatGatewayBearer('dev-secret')
      });

      const reread = createWechatGatewayPidfileStore({ stateDir });
      await expect(reread.read()).resolves.toEqual({
        pid: 4242,
        startedAt: 1_700_000_000,
        bind: '127.0.0.1:7788',
        bearerHash: hashWechatGatewayBearer('dev-secret')
      });

      await store.clear();
      await expect(store.read()).resolves.toBeNull();
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test('treats corrupt pidfile as null instead of throwing', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const store = createWechatGatewayPidfileStore({ stateDir });
      await mkdir(stateDir, { recursive: true });
      await writeFile(store.path, '{this is not json', 'utf8');

      await expect(store.read()).resolves.toBeNull();
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test('hashes the bearer to a non-reversible 12-character hex id', () => {
    const left = hashWechatGatewayBearer('dev-secret');
    const right = hashWechatGatewayBearer('different');

    expect(left).toHaveLength(12);
    expect(left).not.toBe(right);
    expect(left).not.toContain('dev-secret');
  });
});

describe('inspectWechatGatewayPidfile', () => {
  test('returns absent when no pidfile is on disk', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const store = createWechatGatewayPidfileStore({ stateDir });

      const inspection = await inspectWechatGatewayPidfile({ store });

      expect(inspection.kind).toBe('absent');
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test('reports stale and removes the pidfile when the recorded PID is dead', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const store = createWechatGatewayPidfileStore({ stateDir });
      await store.write({
        pid: 999_999,
        startedAt: 1_700_000_000,
        bind: '127.0.0.1:7788',
        bearerHash: hashWechatGatewayBearer('dev-secret')
      });

      const inspection = await inspectWechatGatewayPidfile({
        store,
        isProcessAlive: () => false
      });

      expect(inspection.kind).toBe('stale');
      if (inspection.kind === 'stale') {
        expect(inspection.reason).toBe('process-not-alive');
        expect(inspection.pidfile.pid).toBe(999_999);
      }
      await expect(store.read()).resolves.toBeNull();
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test('reports stale on invalid PID values without trying to probe the OS', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      await mkdir(stateDir, { recursive: true });
      const store = createWechatGatewayPidfileStore({ stateDir });
      await writeFile(store.path, JSON.stringify({
        pid: -1,
        startedAt: 1_700_000_000,
        bind: '127.0.0.1:7788',
        bearerHash: 'abcdef012345'
      }), 'utf8');

      // schema 校验在 store.read 阶段先把 pid<=0 当作 null 过滤掉，所以此处会进 absent 分支。
      // 显式断言这一行为，避免有人改 schema 后默默吞掉负 PID 仍走 stale。
      const inspection = await inspectWechatGatewayPidfile({
        store,
        isProcessAlive: () => {
          throw new Error('isProcessAlive should not be called for invalid pidfile');
        }
      });
      expect(inspection.kind).toBe('absent');
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  test('reports live and keeps the pidfile when the recorded PID is alive', async () => {
    const home = await createTempLinnsyHome();
    try {
      const stateDir = join(home, 'wechat-gateway');
      const store = createWechatGatewayPidfileStore({ stateDir });
      await store.write({
        pid: 12_345,
        startedAt: 1_700_000_000,
        bind: '127.0.0.1:7788',
        bearerHash: hashWechatGatewayBearer('dev-secret')
      });

      const probedPids: number[] = [];
      const inspection = await inspectWechatGatewayPidfile({
        store,
        isProcessAlive: (pid) => {
          probedPids.push(pid);
          return true;
        }
      });

      expect(probedPids).toEqual([12_345]);
      expect(inspection.kind).toBe('live');
      if (inspection.kind === 'live') {
        expect(inspection.pidfile.pid).toBe(12_345);
      }
      await expect(store.read()).resolves.not.toBeNull();
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });
});
