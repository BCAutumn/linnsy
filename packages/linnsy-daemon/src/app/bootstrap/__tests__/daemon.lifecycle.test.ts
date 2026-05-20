import { describe, expect, test } from 'vitest';

import {
  CLI_PLATFORM,
  PassThrough,
  LINNSY_ERROR_CODES,
  createCliChannelAdapter,
  createFixture,
  createLinnsyDaemon,
  fixtures,
  readCode
} from './scenarios/daemon-support.js';
import type { CronSchedulerPort, RunExecutorPort, RunOutcome } from './scenarios/daemon-support.js';

describe('Linnsy daemon lifecycle', () => {
  test('starts cron scheduler with channels and stops it before draining runs', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);
    const calls: string[] = [];
    const cronScheduler: CronSchedulerPort = {
      tick() {
        calls.push('tick');
        return Promise.resolve();
      },
      sweep() {
        calls.push('sweep');
        return Promise.resolve();
      },
      start() {
        calls.push('cron.start');
        return Promise.resolve();
      },
      stop() {
        calls.push('cron.stop');
        return Promise.resolve();
      }
    };
    const channel = createCliChannelAdapter({
      stdin: fixture.stdin,
      stdout: fixture.stdout
    });
    const daemon = createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [channel],
      executor: {
        execute() {
          return Promise.resolve({ status: 'completed' });
        }
      },
      cronScheduler,
      spawner: {
        spawnDetached() {
          return Promise.resolve({ runId: 'run_1', conversationId: 'conv_1' });
        },
        peek() {
          return Promise.resolve(null);
        },
        cancel() {
          return Promise.resolve();
        },
        waitForTerminal() {
          return Promise.resolve({
            runId: 'run_1',
            type: 'completed',
            outcome: { status: 'completed' }
          });
        },
        drain() {
          calls.push('spawner.drain');
          return Promise.resolve();
        },
        recoverOnBoot() {
          return Promise.resolve({ recovered: 0, abandoned: 0 });
        }
      }
    });

    await daemon.start();
    await daemon.stop();

    expect(calls).toEqual(['cron.start', 'cron.stop', 'spawner.drain']);
  });

  test('rejects duplicate channel adapters at construction time', async () => {
    const fixture = await createFixture();
    fixtures.push(fixture);
    const channel1 = createCliChannelAdapter({ stdin: fixture.stdin, stdout: fixture.stdout });
    const channel2 = createCliChannelAdapter({ stdin: new PassThrough(), stdout: new PassThrough() });
    let captured: unknown;
    try {
      createLinnsyDaemon({
        foundation: fixture.foundation,
        channels: [channel1, channel2],
        executor: { execute: () => Promise.resolve({ status: 'completed' }) }
      });
    } catch (error) {
      captured = error;
    }
    expect(readCode(captured)).toBe(LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED);
  });

  test('exposes cli identifier consumed by adapters and tests', () => {
    expect(CLI_PLATFORM).toBe('cli');
  });

  test('does not publish channel_status conversation events on daemon start and stop', async () => {
    const { createRuntimeEventHub } = await import(
      '../../../domains/observability/features/event-hub/event-hub.js'
    );
    const fixture = await createFixture();
    fixtures.push(fixture);

    const captured: Array<{ kind: string; payload: unknown; conversationId?: string | undefined }> = [];
    const events = createRuntimeEventHub({ now: () => 9_000 });
    events.subscribe((event) => {
      captured.push({ kind: event.kind, payload: event.payload, conversationId: event.conversationId });
    });

    const executor: RunExecutorPort = {
      execute(): Promise<RunOutcome> { return Promise.resolve({ status: 'completed', finalAnswer: '' }); }
    };
    const channel = createCliChannelAdapter({
      stdin: fixture.stdin,
      stdout: fixture.stdout,
      outboundPrefix: '> '
    });
    const daemon = createLinnsyDaemon({
      foundation: fixture.foundation,
      channels: [channel],
      executor,
      events,
      awaitTurnInHandler: true
    });

    await daemon.start();
    await daemon.stop();

    expect(captured.filter((event) => event.kind === 'system.event')).toHaveLength(0);
  });

});
