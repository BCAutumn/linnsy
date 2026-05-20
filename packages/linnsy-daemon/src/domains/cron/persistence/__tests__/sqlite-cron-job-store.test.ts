import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteCronJobStore } from '../sqlite-cron-job-store.js';

describe('sqlite cron job store', () => {
  test('upserts jobs and preserves schedule and payload JSON', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = new SqliteCronJobStore(db);
      await store.upsert({
        jobId: 'cron_1',
        enabled: true,
        schedule: { kind: 'one_shot', atMs: 1_000 },
        nextRunAt: 1_000,
        missGraceMs: 1,
        payload: {
          definitionKey: 'linnsy_cron_runner',
          query: 'remind me to drink water'
        },
        createdAt: 10,
        updatedAt: 10
      });

      await expect(store.get('cron_1')).resolves.toMatchObject({
        jobId: 'cron_1',
        enabled: true,
        schedule: { kind: 'one_shot', atMs: 1_000 },
        missGraceMs: 120_000,
        payload: {
          definitionKey: 'linnsy_cron_runner',
          query: 'remind me to drink water'
        }
      });

      await store.upsert({
        jobId: 'cron_weekly',
        enabled: true,
        schedule: { kind: 'weekly', dayOfWeek: 1, time: '09:00' },
        nextRunAt: 100_000,
        missGraceMs: 120_000,
        payload: {
          definitionKey: 'linnsy_cron_runner',
          query: 'weekly report'
        },
        createdAt: 20,
        updatedAt: 20
      });
      await expect(store.get('cron_weekly')).resolves.toMatchObject({
        schedule: { kind: 'weekly', dayOfWeek: 1, time: '09:00' }
      });
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('lists by enabled state', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = new SqliteCronJobStore(db);
      await store.upsert(createCronJob('cron_1', true, 1_000));
      await store.upsert(createCronJob('cron_2', false, 2_000));
      await store.upsert(createCronJob('cron_3', true, 3_000));

      await expect(store.list({ enabled: true })).resolves.toMatchObject([
        { jobId: 'cron_3' },
        { jobId: 'cron_1' }
      ]);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('enables and disables a job without rewriting the schedule', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = new SqliteCronJobStore(db);
      await store.upsert(createCronJob('cron_1', true, 1_000));

      await store.setEnabled('cron_1', false, 2_000);
      await expect(store.get('cron_1')).resolves.toMatchObject({
        enabled: false,
        nextRunAt: 1_000,
        updatedAt: 2_000
      });

      await store.setEnabled('cron_1', true, 3_000);
      await expect(store.get('cron_1')).resolves.toMatchObject({
        enabled: true,
        nextRunAt: 1_000,
        updatedAt: 3_000
      });
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('returns only enabled due jobs in next-run order', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = new SqliteCronJobStore(db);
      await store.upsert(createCronJob('cron_late', true, 1_500));
      await store.upsert(createCronJob('cron_early', true, 1_000));
      await store.upsert(createCronJob('cron_disabled', false, 500));
      await store.upsert(createCronJob('cron_future', true, 3_000));

      await expect(store.listDue(2_000, 10)).resolves.toMatchObject([
        { jobId: 'cron_early' },
        { jobId: 'cron_late' }
      ]);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('records cron run attempts', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = new SqliteCronJobStore(db);
      await store.upsert(createCronJob('cron_1', true, 1_000));

      await store.recordRun({
        cronRunId: 'cron_run_1',
        jobId: 'cron_1',
        scheduledAt: 1_000,
        startedAt: 1_100,
        status: 'running',
        runId: 'run_1'
      });
      await store.recordRun({
        cronRunId: 'cron_run_2',
        jobId: 'cron_1',
        scheduledAt: 2_000,
        finishedAt: 2_100,
        status: 'skipped_grace',
        errorCode: 'LINNSY_CRON_SCHEDULE_INVALID'
      });

      await expect(store.listRuns('cron_1', 10)).resolves.toMatchObject([
        { cronRunId: 'cron_run_2', status: 'skipped_grace', errorCode: 'LINNSY_CRON_SCHEDULE_INVALID' },
        { cronRunId: 'cron_run_1', status: 'running', runId: 'run_1' }
      ]);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('removes jobs and their run history', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = new SqliteCronJobStore(db);
      await store.upsert(createCronJob('cron_1', true, 1_000));
      await store.recordRun({
        cronRunId: 'cron_run_1',
        jobId: 'cron_1',
        scheduledAt: 1_000,
        status: 'completed'
      });

      await expect(store.remove('cron_1')).resolves.toBe(true);
      await expect(store.get('cron_1')).resolves.toBeNull();
      await expect(store.listRuns('cron_1', 10)).resolves.toEqual([]);
      await expect(store.remove('cron_missing')).resolves.toBe(false);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});

async function createStoreFixture(): Promise<{ db: Database.Database; home: string }> {
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
    createdAt: 10,
    updatedAt: 10
  });
  await conversations.upsert({
    conversationId: 'conv_2',
    sessionKey: 'linnsy:main:telegram:private:chat_2',
    platform: 'telegram',
    chatType: 'private',
    chatId: 'chat_2',
    createdAt: 10,
    updatedAt: 10
  });

  return { db, home };
}

function createCronJob(jobId: string, enabled: boolean, nextRunAt: number) {
  return {
    jobId,
    enabled,
    schedule: { kind: 'interval', intervalMs: 60_000 },
    nextRunAt,
    missGraceMs: 7_200_001,
    payload: {
      definitionKey: 'linnsy_cron_runner',
      query: `run ${jobId}`
    },
    createdAt: nextRunAt,
    updatedAt: nextRunAt
  } as const;
}
