import { describe, expect, test } from 'vitest';

import {
  FileCronTickLock,
  createCronScheduler,
  createJob,
  join,
  testTerminalBinding,
  track,
  createFixture
} from './scenarios/cron-scheduler-support.js';

describe('cron scheduler sweeper', () => {
  test('sweeps one-shot jobs whose last run finished outside the retention window', async () => {
    const fixture = await track(await createFixture('sweeper-expired', 1_000));
    await fixture.store.upsert({
      ...createJob('cron_one_shot_old', 1_000),
      enabled: false,
      schedule: { kind: 'one_shot', atMs: 1_000 }
    });
    await fixture.store.recordRun({
      cronRunId: 'cron_run_old',
      jobId: 'cron_one_shot_old',
      scheduledAt: 1_000,
      startedAt: 1_000,
      finishedAt: 1_500,
      status: 'completed',
      runId: 'run_old'
    });
    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        spawnDetached: () => { throw new Error('not used'); },
        waitForTerminal: () => { throw new Error('not used'); }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 100_000 },
      oneShotRetentionMs: 1_000
    });

    await fixture.scheduler.sweep();

    await expect(fixture.store.get('cron_one_shot_old')).resolves.toBeNull();
    await expect(fixture.store.listRuns('cron_one_shot_old', 10)).resolves.toEqual([]);
  });

  test('keeps one-shot jobs whose last run is still within the retention window', async () => {
    const fixture = await track(await createFixture('sweeper-fresh', 1_000));
    await fixture.store.upsert({
      ...createJob('cron_fresh', 1_000),
      enabled: false,
      schedule: { kind: 'one_shot', atMs: 1_000 }
    });
    await fixture.store.recordRun({
      cronRunId: 'cron_run_fresh',
      jobId: 'cron_fresh',
      scheduledAt: 1_000,
      startedAt: 1_000,
      finishedAt: 99_900,
      status: 'completed',
      runId: 'run_fresh'
    });
    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        spawnDetached: () => { throw new Error('not used'); },
        waitForTerminal: () => { throw new Error('not used'); }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 100_000 },
      oneShotRetentionMs: 1_000
    });

    await fixture.scheduler.sweep();

    await expect(fixture.store.get('cron_fresh')).resolves.not.toBeNull();
    await expect(fixture.store.listRuns('cron_fresh', 10)).resolves.toMatchObject([
      { cronRunId: 'cron_run_fresh' }
    ]);
  });

  test('does not sweep recurring jobs even when the user manually disabled them', async () => {
    const fixture = await track(await createFixture('sweeper-recurring', 1_000));
    await fixture.store.upsert({
      ...createJob('cron_daily_disabled', 1_000),
      enabled: false,
      schedule: { kind: 'daily', time: '09:00' }
    });
    await fixture.store.recordRun({
      cronRunId: 'cron_run_daily',
      jobId: 'cron_daily_disabled',
      scheduledAt: 1_000,
      startedAt: 1_000,
      finishedAt: 1_500,
      status: 'completed',
      runId: 'run_daily'
    });
    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        spawnDetached: () => { throw new Error('not used'); },
        waitForTerminal: () => { throw new Error('not used'); }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 100_000 },
      oneShotRetentionMs: 1_000
    });

    await fixture.scheduler.sweep();

    await expect(fixture.store.get('cron_daily_disabled')).resolves.not.toBeNull();
  });

  test('sweeper skips one-shot jobs that have no finished cron run yet', async () => {
    const fixture = await track(await createFixture('sweeper-no-run', 1_000));
    await fixture.store.upsert({
      ...createJob('cron_pending', 1_000),
      enabled: false,
      schedule: { kind: 'one_shot', atMs: 1_000 }
    });
    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        spawnDetached: () => { throw new Error('not used'); },
        waitForTerminal: () => { throw new Error('not used'); }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 100_000 },
      oneShotRetentionMs: 1_000
    });

    await fixture.scheduler.sweep();

    await expect(fixture.store.get('cron_pending')).resolves.not.toBeNull();
  });

});
