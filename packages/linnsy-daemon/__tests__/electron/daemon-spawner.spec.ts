import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDaemonSpawner } from '../../electron/daemon-spawner.js';

describe('createDaemonSpawner', () => {
  test('publishes lifecycle changes from spawn to unexpected exit', async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), 'linnsy-daemon-spawner-'));
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      private: true,
      scripts: {
        fail: 'node -e "process.exit(7)"'
      }
    }));
    const statuses: string[] = [];
    const spawner = createDaemonSpawner({
      packageRoot,
      scriptName: 'fail'
    });
    const unsubscribe = spawner.subscribe((status) => {
      statuses.push(status.lifecycle);
    });

    try {
      spawner.start();
      await waitForStatus(statuses, 'failed');

      expect(statuses).toContain('starting');
      expect(statuses).toContain('running');
      expect(spawner.getStatus()).toMatchObject({
        lifecycle: 'failed',
        running: false,
        exitCode: 7
      });
    } finally {
      unsubscribe();
      await spawner.stop();
      await rm(packageRoot, { force: true, recursive: true });
    }
  });

  test('does not hang forever when an npm child ignores SIGTERM', async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), 'linnsy-daemon-spawner-'));
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      private: true,
      scripts: {
        hang: 'node -e "process.on(\'SIGTERM\',()=>{}); setInterval(()=>{},1000)"'
      }
    }));

    const spawner = createDaemonSpawner({
      packageRoot,
      scriptName: 'hang',
      stopTimeoutMs: 50
    });

    try {
      spawner.start();
      expect(spawner.isRunning()).toBe(true);
      await expect(spawner.stop()).resolves.toBeUndefined();
      expect(spawner.isRunning()).toBe(false);
    } finally {
      await spawner.stop();
      await rm(packageRoot, { force: true, recursive: true });
    }
  });

  test('does not start a second daemon while the previous process is still stopping', async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), 'linnsy-daemon-spawner-'));
    const startLog = join(packageRoot, 'starts.log');
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
      private: true,
      scripts: {
        hang: 'node -e "require(\'node:fs\').appendFileSync(process.env.START_LOG,\'start\\\\n\'); process.on(\'SIGTERM\',()=>{}); setInterval(()=>{},1000)"'
      }
    }));
    const spawner = createDaemonSpawner({
      packageRoot,
      scriptName: 'hang',
      stopTimeoutMs: 80
    });

    try {
      spawner.start({ START_LOG: startLog });
      await waitForStartLog(startLog, 1);

      const stopping = spawner.stop();
      spawner.start({ START_LOG: startLog });

      await stopping;
      expect(await readStartCount(startLog)).toBe(1);
      expect(spawner.isRunning()).toBe(false);
    } finally {
      await spawner.stop();
      await rm(packageRoot, { force: true, recursive: true });
    }
  });
});

async function waitForStatus(statuses: string[], expected: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (statuses.includes(expected)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for status ${expected}`);
}

async function waitForStartLog(filePath: string, expectedCount: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await readStartCount(filePath) >= expectedCount) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${String(expectedCount)} daemon starts`);
}

async function readStartCount(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, 'utf8');
    return content.split('\n').filter((line) => line.length > 0).length;
  } catch {
    return 0;
  }
}
