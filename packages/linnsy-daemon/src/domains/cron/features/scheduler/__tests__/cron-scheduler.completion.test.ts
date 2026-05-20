import { describe, expect, test } from 'vitest';

import {
  FileCronTickLock,
  createCronScheduler,
  createJob,
  createMockChannel,
  createNotificationLayer,
  completedTerminal,
  join,
  testTerminalBinding,
  track,
  createFixture
} from './scenarios/cron-scheduler-support.js';
import type { RunTerminalEvent, SpawnOptions, SpawnResult } from './scenarios/cron-scheduler-support.js';

describe('cron scheduler completion handling', () => {
  test('keeps daily jobs enabled after successful completion', async () => {
    const fixture = await track(await createFixture('daily-completed', 90_000));
    await fixture.store.upsert({
      ...createJob('cron_1', 60_000),
      schedule: { kind: 'daily', time: '00:01' },
      nextRunAt: 60_000
    });

    await fixture.scheduler.tick();

    await expect(fixture.store.get('cron_1')).resolves.toMatchObject({
      enabled: true,
      schedule: { kind: 'daily', time: '00:01' }
    });
    const job = await fixture.store.get('cron_1');
    expect(job?.nextRunAt).toBeGreaterThan(90_000);
    await expect(fixture.store.listRuns('cron_1', 10)).resolves.toMatchObject([
      { cronRunId: 'cron_run_1', status: 'completed' }
    ]);
  });

  test('keeps weekly jobs enabled and advances to the next matching weekday', async () => {
    const fixture = await track(await createFixture('weekly-completed', Date.UTC(2026, 3, 27, 9, 1)));
    await fixture.store.upsert({
      ...createJob('cron_1', Date.UTC(2026, 3, 27, 9, 0)),
      schedule: { kind: 'weekly', dayOfWeek: 1, time: '09:00' },
      nextRunAt: Date.UTC(2026, 3, 27, 9, 0)
    });

    await fixture.scheduler.tick();

    const job = await fixture.store.get('cron_1');
    expect(job).toMatchObject({
      enabled: true,
      schedule: { kind: 'weekly', dayOfWeek: 1, time: '09:00' }
    });
    expect(job?.nextRunAt).toBeGreaterThan(Date.UTC(2026, 3, 27, 9, 1));
    expect(new Date(job?.nextRunAt ?? 0).getDay()).toBe(1);
    expect(new Date(job?.nextRunAt ?? 0).getHours()).toBe(9);
    expect(new Date(job?.nextRunAt ?? 0).getMinutes()).toBe(0);
    await expect(fixture.store.listRuns('cron_1', 10)).resolves.toMatchObject([
      { cronRunId: 'cron_run_1', status: 'completed' }
    ]);
  });

  test('records completed cron runs from spawner terminal events', async () => {
    const fixture = await track(await createFixture('terminal', 1_000));
    await fixture.store.upsert(createJob('cron_1', 1_000));
    const spawner = {
      spawnDetached(options: SpawnOptions): Promise<SpawnResult> {
        fixture.spawns.push(options);
        return Promise.resolve({ runId: 'run_1', conversationId: options.conversationId });
      },
      waitForTerminal(runId: string): Promise<RunTerminalEvent> {
        return Promise.resolve(completedTerminal(runId, 'drink water'));
      }
    };
    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner,
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_000 },
      cronRunIdFactory: () => 'cron_run_1'
    });

    await fixture.scheduler.tick();

    await expect(fixture.store.listRuns('cron_1', 10)).resolves.toMatchObject([
      { cronRunId: 'cron_run_1', status: 'completed', runId: 'run_1', finishedAt: 1_000 }
    ]);
  });

  test('sends completed cron final answers to the latest inbound target', async () => {
    const fixture = await track(await createFixture('notify', 1_000));
    await fixture.messages.insert({
      messageId: 'in_1',
      conversationId: 'conv_1',
      role: 'user',
      source: 'inbound',
      platform: 'cli',
      chatType: 'private',
      chatId: 'notify',
      providerMessageId: 'provider_in_1',
      text: 'set reminder',
      createdAt: 500
    });
    await fixture.store.upsert(createJob('cron_1', 1_000));
    const channel = createMockChannel();
    const notification = createNotificationLayer({
      channels: [channel],
      messages: fixture.messages,
      clock: { now: () => 1_000 },
      outboundIdFactory: () => 'out_cron_1'
    });
    const spawner = {
      spawnDetached(options: SpawnOptions): Promise<SpawnResult> {
        fixture.spawns.push(options);
        return Promise.resolve({ runId: 'run_1', conversationId: options.conversationId });
      },
      waitForTerminal(runId: string): Promise<RunTerminalEvent> {
        return Promise.resolve(completedTerminal(runId, 'drink water'));
      }
    };
    const schedulerOptions = {
      store: fixture.store,
      spawner,
      notification,
      messages: fixture.messages,
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_000 },
      cronRunIdFactory: () => 'cron_run_1'
    };
    fixture.scheduler = createCronScheduler(schedulerOptions);

    await fixture.scheduler.tick();

    expect(channel.sent).toEqual([
      {
        target: {
          platform: 'cli',
          chatType: 'private',
          chatId: 'notify',
          replyToProviderMessageId: 'provider_in_1'
        },
        payload: { text: 'drink water' }
      }
    ]);
    await expect(fixture.messages.get('out_cron_1')).resolves.toMatchObject({
      conversationId: 'conv_1',
      runId: 'run_1',
      text: 'drink water',
      source: 'outbound'
    });
  });

});
