import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteCronJobStore } from '../../../../cron/persistence/sqlite-cron-job-store.js';
import { createCronListTool } from '../tools/cron-list.js';
import { createCronRemoveTool } from '../tools/cron-remove.js';
import { createCronSetTool } from '../tools/cron-set.js';
import { createManageScheduleTool } from '../tools/manage-schedule.js';

describe('cron tools', () => {
  test('cron_set creates an interval job in the owner-wide reminder list', async () => {
    const fixture = await createFixture();

    try {
      const tool = createCronSetTool({
        cronStore: fixture.store,
        now: () => 1_000,
        jobIdFactory: () => 'cron_1'
      });

      const result = await tool.execute({
        query: 'drink water',
        intervalMs: 60_000
      }, createToolContext('conv_1'));
      expect(result.data).toMatchObject({
        job: {
          jobId: 'cron_1',
          schedule: { kind: 'interval', intervalMs: 60_000 },
          nextRunAt: 61_000,
          payload: {
            definitionKey: 'linnsy_main',
            query: 'drink water'
          }
        }
      });
      expect(result.observation).toContain('cron_1');
    } finally {
      await fixture.cleanup();
    }
  });

  test('cron_set accepts one-shot and daily schedules', async () => {
    const fixture = await createFixture();

    try {
      let nextId = 0;
      const tool = createCronSetTool({
        cronStore: fixture.store,
        now: () => Date.UTC(2026, 3, 25, 8, 30),
        jobIdFactory: () => `cron_${(nextId += 1).toString()}`
      });

      await tool.execute({ query: 'stand up', atMs: Date.UTC(2026, 3, 25, 8, 45) }, createToolContext('conv_1'));
      await tool.execute({ query: 'morning', dailyTime: '09:00' }, createToolContext('conv_1'));
      await tool.execute({ query: 'weekly report', weeklyDayOfWeek: 1, weeklyTime: '10:00' }, createToolContext('conv_1'));

      await expect(fixture.store.list()).resolves.toMatchObject([
        {
          jobId: 'cron_3',
          schedule: { kind: 'weekly', dayOfWeek: 1, time: '10:00' },
          nextRunAt: nextLocalWeeklyRunAt(1, '10:00', Date.UTC(2026, 3, 25, 8, 30))
        },
        { jobId: 'cron_2', schedule: { kind: 'daily', time: '09:00' }, nextRunAt: nextLocalDailyRunAt('09:00', Date.UTC(2026, 3, 25, 8, 30)) },
        {
          jobId: 'cron_1',
          schedule: { kind: 'one_shot', atMs: Date.UTC(2026, 3, 25, 8, 45) },
          nextRunAt: Date.UTC(2026, 3, 25, 8, 45)
        }
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  test('cron_set accepts one-shot relative delays without forcing the model to compute timestamps', async () => {
    const fixture = await createFixture();

    try {
      const tool = createCronSetTool({
        cronStore: fixture.store,
        now: () => 1_000,
        jobIdFactory: () => 'cron_delay'
      });

      const result = await tool.execute({
        query: 'wechat reminder',
        delayMs: 60_000
      }, createToolContext('conv_1'));
      expect(result.data).toMatchObject({
        job: {
          jobId: 'cron_delay',
          schedule: { kind: 'one_shot', atMs: 61_000 },
          nextRunAt: 61_000,
          payload: {
            definitionKey: 'linnsy_main',
            query: 'wechat reminder'
          }
        }
      });
      expect(result.observation).toContain('cron_delay');
    } finally {
      await fixture.cleanup();
    }
  });

  test('cron_remove permanently deletes jobs regardless of creating conversation', async () => {
    const fixture = await createFixture();

    try {
      await fixture.store.upsert({
        jobId: 'cron_1',
        enabled: true,
        schedule: { kind: 'interval', intervalMs: 60_000 },
        nextRunAt: 60_000,
        missGraceMs: 120_000,
        payload: {
          definitionKey: 'linnsy_cron_runner',
          query: 'foreign'
        },
        createdAt: 1,
        updatedAt: 1
      });
      const tool = createCronRemoveTool({
        cronStore: fixture.store
      });

      const result = await tool.execute({ jobId: 'cron_1' }, createToolContext('conv_1'));
      expect(result.data).toMatchObject({
        jobId: 'cron_1',
        deleted: true
      });
      expect(result.observation).toContain('cron_1');
      await expect(fixture.store.get('cron_1')).resolves.toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  test('cron_list returns enabled reminders by default', async () => {
    const fixture = await createFixture();

    try {
      await fixture.store.upsert({
        jobId: 'cron_enabled',
        enabled: true,
        schedule: { kind: 'interval', intervalMs: 60_000 },
        nextRunAt: 60_000,
        missGraceMs: 120_000,
        payload: {
          definitionKey: 'linnsy_cron_runner',
          query: 'enabled'
        },
        createdAt: 1,
        updatedAt: 1
      });
      await fixture.store.upsert({
        jobId: 'cron_disabled',
        enabled: false,
        schedule: { kind: 'interval', intervalMs: 60_000 },
        nextRunAt: 60_000,
        missGraceMs: 120_000,
        payload: {
          definitionKey: 'linnsy_cron_runner',
          query: 'disabled'
        },
        createdAt: 2,
        updatedAt: 2
      });
      const tool = createCronListTool({ cronStore: fixture.store });

      const enabledResult = await tool.execute({}, createToolContext('conv_1'));
      expect(enabledResult.data).toMatchObject({
        jobs: [
          {
            jobId: 'cron_enabled',
            schedule: { kind: 'interval', intervalMs: 60_000 },
            query: 'enabled',
            nextRunAt: 60_000,
            enabled: true
          }
        ]
      });
      expect(enabledResult.observation).toContain('1');
      const disabledResult = await tool.execute({ enabled: false }, createToolContext('conv_1'));
      expect(disabledResult.data).toMatchObject({
        jobs: [{ jobId: 'cron_disabled', enabled: false }]
      });
      expect(disabledResult.observation).toContain('enabled=false');
    } finally {
      await fixture.cleanup();
    }
  });

  test('manage_schedule covers set, list, and remove through one reminder entrypoint', async () => {
    const fixture = await createFixture();

    try {
      const tool = createManageScheduleTool({
        cronStore: fixture.store,
        now: () => 1_000,
        jobIdFactory: () => 'cron_managed'
      });

      const created = await tool.execute({
        action: 'set',
        query: 'managed reminder',
        delayMs: 60_000
      }, createToolContext('conv_1'));
      expect(created.data).toMatchObject({
        action: 'set',
        job: {
          jobId: 'cron_managed',
          schedule: { kind: 'one_shot', atMs: 61_000 },
          payload: { query: 'managed reminder' }
        }
      });

      const listed = await tool.execute({ action: 'list' }, createToolContext('conv_1'));
      expect(listed.data).toMatchObject({
        action: 'list',
        jobs: [{ jobId: 'cron_managed', query: 'managed reminder' }]
      });

      const removed = await tool.execute({ action: 'remove', jobId: 'cron_managed' }, createToolContext('conv_1'));
      expect(removed.data).toMatchObject({
        action: 'remove',
        jobId: 'cron_managed',
        deleted: true
      });
      await expect(fixture.store.get('cron_managed')).resolves.toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  test('manage_schedule rejects fields that do not belong to the selected action', async () => {
    const fixture = await createFixture();

    try {
      const tool = createManageScheduleTool({ cronStore: fixture.store });

      await expect(tool.execute({
        action: 'list',
        query: 'do not sneak set payload into list'
      }, createToolContext('conv_1'))).rejects.toThrow('field query is not allowed for action=list');
      await expect(tool.execute({
        action: 'remove',
        jobId: 'cron_missing',
        delayMs: 60_000
      }, createToolContext('conv_1'))).rejects.toThrow('field delayMs is not allowed for action=remove');
    } finally {
      await fixture.cleanup();
    }
  });
});

async function createFixture(): Promise<{
  store: SqliteCronJobStore;
  cleanup(): Promise<void>;
}> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  await conversations.upsert({
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 1,
    updatedAt: 1
  });
  await conversations.upsert({
    conversationId: 'conv_2',
    sessionKey: 'linnsy:main:cli:private:other',
    platform: 'cli',
    chatType: 'private',
    chatId: 'other',
    createdAt: 1,
    updatedAt: 1
  });

  return {
    store: new SqliteCronJobStore(db),
    async cleanup() {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  };
}

function createToolContext(conversationId: string): ToolExecutionContext {
  return {
    runId: 'run_1',
    conversationId,
    turnId: 'turn_1',
    abortSignal: new AbortController().signal,
    user_query: 'set cron',
    modelId: 'openai.gpt5'
  };
}

function nextLocalDailyRunAt(time: string, afterMs: number): number {
  const [hoursText, minutesText] = time.split(':');
  if (hoursText === undefined || minutesText === undefined) {
    throw new Error(`invalid time ${time}`);
  }
  const candidate = new Date(afterMs);
  candidate.setHours(Number(hoursText), Number(minutesText), 0, 0);
  if (candidate.getTime() <= afterMs) {
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(Number(hoursText), Number(minutesText), 0, 0);
  }
  return candidate.getTime();
}

function nextLocalWeeklyRunAt(dayOfWeek: number, time: string, afterMs: number): number {
  const candidate = new Date(nextLocalDailyRunAt(time, afterMs));
  const daysUntilTarget = (dayOfWeek - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + daysUntilTarget);
  if (candidate.getTime() <= afterMs) {
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate.getTime();
}
