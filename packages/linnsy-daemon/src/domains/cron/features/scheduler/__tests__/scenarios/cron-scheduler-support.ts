import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteCronJobStore } from '../../../../persistence/sqlite-cron-job-store.js';
import { SqliteMessageStore } from '../../../../../../persistence/stores/message/sqlite-message-store.js';
import { LINNSY_ERROR_CODES } from '../../../../../../shared/errors.js';
import type { ChannelAdapterPort } from '../../../../../channel/definitions/types.js';
import { LINNSY_FENCE_KINDS } from '../../../../../agent-run/features/context-engineering/fences.js';
import { createNotificationLayer } from '../../../../../conversation/features/notification/notification-layer.js';
import type { RunTerminalEvent, SpawnOptions, SpawnResult } from '../../../../../agent-run/features/run-spawner/types.js';

import { FileCronTickLock } from '../../file-lock.js';
import { createCronScheduler } from '../../scheduler.js';
import { DEFAULT_CRON_DEFINITION_KEY, type CronJobRecord, type CronSchedulerPort } from '../../definitions/types.js';

export interface Fixture {
  home: string;
  db: Database.Database;
  store: SqliteCronJobStore;
  messages: SqliteMessageStore;
  spawns: SpawnOptions[];
  scheduler: CronSchedulerPort;
  setNow(value: number): void;
  cleanup(): Promise<void>;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) {
      await fixture.cleanup();
    }
  }
});


export async function createFixture(name: string, now: number, existingHome?: string): Promise<Fixture> {
  const home = existingHome ?? await createTempLinnsyHome();
  const db = new Database(join(home, `${name}.db`));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  await conversations.upsert({
    conversationId: 'conv_1',
    sessionKey: `linnsy:main:cli:private:${name}`,
    platform: 'cli',
    chatType: 'private',
    chatId: name,
    createdAt: 10,
    updatedAt: 10
  });

  const store = new SqliteCronJobStore(db);
  const messages = new SqliteMessageStore(db);
  let currentNow = now;
  const spawns: SpawnOptions[] = [];
  const scheduler = createCronScheduler({
    store,
    spawner: {
      spawnDetached(options) {
        spawns.push(options);
        return Promise.resolve({ runId: `run_${spawns.length.toString()}`, conversationId: options.conversationId });
      },
      waitForTerminal(runId) {
        return Promise.resolve(completedTerminal(runId));
      }
    },
    terminalBinding: testTerminalBinding(),
    lock: new FileCronTickLock(join(home, 'cron', '.tick.lock')),
    clock: { now: () => currentNow },
    cronRunIdFactory: () => `cron_run_${(spawns.length + 1).toString()}`
  });

  return {
    home,
    db,
    store,
    messages,
    spawns,
    scheduler,
    setNow(value: number) {
      currentNow = value;
    },
    async cleanup() {
      db.close();
      if (existingHome === undefined) {
        await rm(home, { recursive: true, force: true });
      }
    }
  };
}

export function completedTerminal(runId: string, finalAnswer?: string): RunTerminalEvent {
  return {
    runId,
    type: 'completed',
    outcome: {
      status: 'completed',
      ...(finalAnswer === undefined ? {} : { finalAnswer })
    }
  };
}

export function createMockChannel(): ChannelAdapterPort & {
  sent: Array<{ target: unknown; payload: unknown }>;
} {
  const sent: Array<{ target: unknown; payload: unknown }> = [];
  return {
    platform: 'cli',
    start() {
      return Promise.resolve();
    },
    stop() {
      return Promise.resolve();
    },
    send(target, payload) {
      sent.push({ target, payload });
      return Promise.resolve({
        delivery: 'sent',
        providerMessageId: `provider_out_${sent.length.toString()}`
      });
    },
    healthcheck() {
      return Promise.resolve({ ok: true });
    },
    sent
  };
}

export function createJob(jobId: string, nextRunAt: number): CronJobRecord {
  return {
    jobId,
    enabled: true,
    schedule: { kind: 'interval', intervalMs: 60_000 },
    nextRunAt,
    missGraceMs: 120_000,
    payload: {
      definitionKey: DEFAULT_CRON_DEFINITION_KEY,
      query: 'remind me'
    },
    createdAt: 10,
    updatedAt: 10
  };
}

export function testTerminalBinding(conversationId = 'conv_1') {
  return {
    getBinding() {
      return Promise.resolve({
        terminalId: 'mobile',
        conversationId,
        updatedAt: 10,
        updatedBy: 'test'
      });
    }
  };
}

export function track(fixture: Fixture): Promise<Fixture> {
  fixtures.push(fixture);
  return Promise.resolve(fixture);
}

export { join, LINNSY_ERROR_CODES, LINNSY_FENCE_KINDS, createNotificationLayer, FileCronTickLock, createCronScheduler };
export type { RunTerminalEvent, SpawnOptions, SpawnResult };
