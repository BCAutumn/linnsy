import { describe, expect, test } from 'vitest';

import {
  LINNSY_ERROR_CODES,
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

describe('cron scheduler one-shot jobs', () => {
  test('disables one-shot jobs before spawn so spawn failures are not retried', async () => {
    const fixture = await track(await createFixture('one-shot', 1_000));
    await fixture.store.upsert({
      ...createJob('cron_1', 1_000),
      schedule: { kind: 'one_shot', atMs: 1_000 }
    });
    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        async spawnDetached() {
          await expect(fixture.store.get('cron_1')).resolves.toMatchObject({
            enabled: false
          });
          throw new Error('executor unavailable');
        },
        waitForTerminal(runId) {
          return Promise.resolve(completedTerminal(runId));
        }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_000 },
      cronRunIdFactory: () => 'cron_run_1'
    });

    await fixture.scheduler.tick();
    await fixture.scheduler.tick();

    expect(fixture.spawns).toHaveLength(0);
    await expect(fixture.store.listRuns('cron_1', 10)).resolves.toMatchObject([
      { cronRunId: 'cron_run_1', status: 'failed' }
    ]);
  });

  test('keeps one-shot jobs disabled after successful notification delivery so the desktop "completed" pane can show them', async () => {
    const fixture = await track(await createFixture('one-shot-delivered', 1_000));
    await fixture.messages.insert({
      messageId: 'in_1',
      conversationId: 'conv_1',
      role: 'user',
      source: 'inbound',
      platform: 'cli',
      chatType: 'private',
      chatId: 'one-shot-delivered',
      providerMessageId: 'provider_in_1',
      text: 'set reminder',
      createdAt: 500
    });
    await fixture.store.upsert({
      ...createJob('cron_1', 1_000),
      schedule: { kind: 'one_shot', atMs: 1_000 }
    });
    const channel = createMockChannel();
    const notification = createNotificationLayer({
      channels: [channel],
      messages: fixture.messages,
      clock: { now: () => 1_000 },
      outboundIdFactory: () => 'out_cron_1'
    });
    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        spawnDetached(options) {
          fixture.spawns.push(options);
          return Promise.resolve({ runId: 'run_1', conversationId: options.conversationId });
        },
        waitForTerminal(runId) {
          return Promise.resolve(completedTerminal(runId, 'drink water'));
        }
      },
      notification,
      messages: fixture.messages,
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_000 },
      cronRunIdFactory: () => 'cron_run_1'
    });

    await fixture.scheduler.tick();

    expect(channel.sent).toHaveLength(1);
    const stored = await fixture.store.get('cron_1');
    expect(stored).not.toBeNull();
    expect(stored?.enabled).toBe(false);
    await expect(fixture.store.listRuns('cron_1', 10)).resolves.toMatchObject([
      { cronRunId: 'cron_run_1', status: 'completed', runId: 'run_1' }
    ]);
  });

  test('keeps one-shot jobs disabled when the cron runner completes silently so they show up as completed', async () => {
    const fixture = await track(await createFixture('one-shot-silent', 1_000));
    await fixture.store.upsert({
      ...createJob('cron_1', 1_000),
      schedule: { kind: 'one_shot', atMs: 1_000 }
    });
    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        spawnDetached(options) {
          fixture.spawns.push(options);
          return Promise.resolve({ runId: 'run_1', conversationId: options.conversationId });
        },
        waitForTerminal(runId) {
          return Promise.resolve(completedTerminal(runId, ''));
        }
      },
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_000 },
      cronRunIdFactory: () => 'cron_run_1'
    });

    await fixture.scheduler.tick();

    const stored = await fixture.store.get('cron_1');
    expect(stored).not.toBeNull();
    expect(stored?.enabled).toBe(false);
    await expect(fixture.store.listRuns('cron_1', 10)).resolves.toMatchObject([
      { cronRunId: 'cron_run_1', status: 'completed', runId: 'run_1' }
    ]);
  });

  test('keeps failed one-shot jobs disabled when notification has no target', async () => {
    const fixture = await track(await createFixture('one-shot-no-target', 1_000));
    await fixture.store.upsert({
      ...createJob('cron_1', 1_000),
      schedule: { kind: 'one_shot', atMs: 1_000 }
    });
    fixture.scheduler = createCronScheduler({
      store: fixture.store,
      spawner: {
        spawnDetached(options) {
          fixture.spawns.push(options);
          return Promise.resolve({ runId: 'run_1', conversationId: options.conversationId });
        },
        waitForTerminal(runId) {
          return Promise.resolve(completedTerminal(runId, 'drink water'));
        }
      },
      notification: createNotificationLayer({
        channels: [createMockChannel()],
        messages: fixture.messages,
        clock: { now: () => 1_000 },
        outboundIdFactory: () => 'out_cron_1'
      }),
      messages: fixture.messages,
      terminalBinding: testTerminalBinding(),
      lock: new FileCronTickLock(join(fixture.home, 'cron', '.tick.lock')),
      clock: { now: () => 1_000 },
      cronRunIdFactory: () => 'cron_run_1'
    });

    await fixture.scheduler.tick();

    await expect(fixture.store.get('cron_1')).resolves.toMatchObject({
      enabled: false,
      schedule: { kind: 'one_shot', atMs: 1_000 }
    });
    await expect(fixture.store.listRuns('cron_1', 10)).resolves.toMatchObject([
      {
        cronRunId: 'cron_run_1',
        status: 'failed',
        errorCode: LINNSY_ERROR_CODES.NOTIFICATION_NO_TARGET
      }
    ]);
  });

});
