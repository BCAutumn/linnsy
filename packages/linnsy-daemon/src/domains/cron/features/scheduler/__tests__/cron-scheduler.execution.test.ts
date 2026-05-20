import { describe, expect, test } from 'vitest';

import {
  LINNSY_FENCE_KINDS,
  FileCronTickLock,
  createCronScheduler,
  createJob,
  completedTerminal,
  join,
  testTerminalBinding,
  track,
  createFixture
} from './scenarios/cron-scheduler-support.js';
import type { SpawnOptions, SpawnResult } from './scenarios/cron-scheduler-support.js';
import {
  createRuntimeEventHub,
  type RuntimeEvent
} from '../../../../observability/features/event-hub/event-hub.js';

describe('cron scheduler execution', () => {
  test('two schedulers sharing the file lock do not execute the same tick twice', async () => {
    const first = await track(await createFixture('lock_1', 1_000));
    const secondSpawns: SpawnOptions[] = [];
    const secondScheduler = createCronScheduler({
      store: first.store,
      spawner: {
        spawnDetached(options) {
          secondSpawns.push(options);
          return Promise.resolve({ runId: 'run_2', conversationId: options.conversationId });
        },
        waitForTerminal(runId) {
          return Promise.resolve(completedTerminal(runId));
        }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(first.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_000 },
      cronRunIdFactory: () => 'cron_run_2'
    });
    let releaseSpawn: (() => void) | undefined;
    const spawnStarted = new Promise<void>((resolve) => {
      first.scheduler = createCronScheduler({
        store: first.store,
        spawner: {
          spawnDetached(options) {
            first.spawns.push(options);
            resolve();
            return new Promise<SpawnResult>((spawnResolve) => {
              releaseSpawn = () => {
                spawnResolve({ runId: 'run_1', conversationId: options.conversationId });
              };
            });
          },
          waitForTerminal(runId) {
            return Promise.resolve(completedTerminal(runId));
          }
        },
        terminalBinding: testTerminalBinding(),
        lock: new FileCronTickLock(join(first.home, 'cron', '.tick.lock')),
        clock: { now: () => 1_000 },
        cronRunIdFactory: () => 'cron_run_1'
      });
    });

    await first.store.upsert(createJob('cron_1', 1_000));

    const firstTick = first.scheduler.tick();
    await spawnStarted;
    await secondScheduler.tick();
    releaseSpawn?.();
    await firstTick;

    expect(first.spawns).toHaveLength(1);
    expect(secondSpawns).toHaveLength(0);
    await expect(first.store.listRuns('cron_1', 10)).resolves.toHaveLength(1);
  });

  test('advances recurring jobs and records running before spawn', async () => {
    const fixture = await track(await createFixture('advance', 1_500));
    await fixture.store.upsert(createJob('cron_1', 1_000));

    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        async spawnDetached(options) {
          fixture.spawns.push(options);
          await expect(fixture.store.get('cron_1')).resolves.toMatchObject({
            nextRunAt: 61_000,
            enabled: true
          });
          await expect(fixture.store.listRuns('cron_1', 10)).resolves.toMatchObject([
            { cronRunId: 'cron_run_1', scheduledAt: 1_000, status: 'running' }
          ]);
          return { runId: 'run_1', conversationId: options.conversationId };
        },
        waitForTerminal(runId) {
          return Promise.resolve(completedTerminal(runId));
        }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_500 },
      cronRunIdFactory: () => 'cron_run_1'
    });

    await fixture.scheduler.tick();

    expect(fixture.spawns).toHaveLength(1);
    expect(fixture.spawns[0]).toMatchObject({
      definitionKey: 'linnsy_main',
      conversationId: 'conv_1',
      query: 'remind me',
      contextFences: [
        {
          kind: LINNSY_FENCE_KINDS.systemEvent,
          content: 'remind me',
          attrs: {
            kind: 'cron-fire',
            jobId: 'cron_1',
            firedAt: 1_500
          }
        }
      ],
      wakeSource: 'system-event',
      ephemeral: { skipMemory: true, skipContextFiles: true },
      blocking: false
    });
  });

  test('publishes cron system.event and wakes main Linnsy with a system-event fence', async () => {
    const fixture = await track(await createFixture('system-event-wake', 1_500));
    const published: RuntimeEvent[] = [];
    const events = createRuntimeEventHub({
      now: () => 1_500,
      idFactory: () => `evt_${(published.length + 1).toString()}`
    });
    events.subscribe((event) => {
      published.push(event);
    });
    await fixture.store.upsert(createJob('cron_1', 1_000));

    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        spawnDetached(options) {
          fixture.spawns.push(options);
          return Promise.resolve({ runId: 'run_1', conversationId: options.conversationId });
        },
        waitForTerminal(runId) {
          return Promise.resolve(completedTerminal(runId));
        }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_500 },
      cronRunIdFactory: () => 'cron_run_1',
      events
    });

    await fixture.scheduler.tick();

    expect(published).toMatchObject([{
      kind: 'system.event',
      conversationId: 'conv_1',
      payload: {
        sourceKind: 'cron',
        detail: 'remind me',
        refId: 'cron_1',
        occurredAt: 1_500
      }
    }]);
    expect(fixture.spawns[0]).toMatchObject({
      definitionKey: 'linnsy_main',
      wakeSource: 'system-event',
      contextFences: [
        {
          kind: LINNSY_FENCE_KINDS.systemEvent,
          content: 'remind me',
          attrs: {
            kind: 'cron-fire',
            jobId: 'cron_1',
            firedAt: 1_500
          }
        }
      ]
    });
  });

  test('continues waking Linnsy when publishing the observable system.event fails', async () => {
    const fixture = await track(await createFixture('system-event-publish-fails', 1_500));
    await fixture.store.upsert(createJob('cron_1', 1_000));

    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        spawnDetached(options) {
          fixture.spawns.push(options);
          return Promise.resolve({ runId: 'run_1', conversationId: options.conversationId });
        },
        waitForTerminal(runId) {
          return Promise.resolve(completedTerminal(runId, 'done'));
        }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_500 },
      cronRunIdFactory: () => 'cron_run_1',
      events: {
        publish() {
          throw new Error('event store unavailable');
        },
        subscribe() {
          return () => undefined;
        },
        poll() {
          return { events: [] };
        }
      }
    });

    await fixture.scheduler.tick();

    expect(fixture.spawns).toHaveLength(1);
    expect(fixture.spawns[0]).toMatchObject({
      definitionKey: 'linnsy_main',
      wakeSource: 'system-event'
    });
    await expect(fixture.store.listRuns('cron_1', 10)).resolves.toMatchObject([
      { cronRunId: 'cron_run_1', status: 'completed', runId: 'run_1' }
    ]);
  });

  test('uses the current mobile binding when a reminder job has no conversation hint', async () => {
    const fixture = await track(await createFixture('binding-target', 1_500));
    await fixture.store.upsert({
      ...createJob('cron_1', 1_000),
      payload: {
        definitionKey: 'linnsy_main',
        query: 'bound reminder'
      }
    });

    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        spawnDetached(options) {
          fixture.spawns.push(options);
          return Promise.resolve({ runId: 'run_1', conversationId: options.conversationId });
        },
        waitForTerminal(runId) {
          return Promise.resolve(completedTerminal(runId));
        }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_500 },
      cronRunIdFactory: () => 'cron_run_1'
    });

    await fixture.scheduler.tick();

    expect(fixture.spawns).toHaveLength(1);
    expect(fixture.spawns[0]?.conversationId).toBe('conv_1');
  });

  test('skips jobs that are past miss grace without spawning', async () => {
    const fixture = await track(await createFixture('grace', 130_000));
    await fixture.store.upsert({
      ...createJob('cron_1', 1_000),
      missGraceMs: 2_000
    });

    await fixture.scheduler.tick();

    expect(fixture.spawns).toHaveLength(0);
    await expect(fixture.store.get('cron_1')).resolves.toMatchObject({
      nextRunAt: 181_000
    });
    await expect(fixture.store.listRuns('cron_1', 10)).resolves.toMatchObject([
      { status: 'skipped_grace', scheduledAt: 1_000 }
    ]);
  });

});
