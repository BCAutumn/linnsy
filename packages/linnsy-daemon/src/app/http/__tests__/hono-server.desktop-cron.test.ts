import {
  describe,
  expect,
  test,
  vi
} from 'vitest';

import {
  createTaskWebhookApp,
  cronStore,
  sampleCronJob,
  taskTracker,
  terminalBinding
} from './scenarios/hono-server-support.js';
import type { CronJobStorePort, TerminalBindingServicePort } from './scenarios/hono-server-support.js';

describe('desktop Hono API cron management', () => {
  test('serves and updates the mobile terminal binding with bearer auth', async () => {
    const bindToConversation = vi.fn<TerminalBindingServicePort['bindToConversation']>((conversationId, updatedBy) => Promise.resolve({
      terminalId: 'mobile',
      conversationId,
      updatedAt: 2,
      updatedBy
    }));
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      terminalBinding: terminalBinding({
        getBinding: () => Promise.resolve({
          terminalId: 'mobile',
          conversationId: 'conv_1',
          updatedAt: 1,
          updatedBy: 'system-default'
        }),
        bindToConversation
      })
    });

    const getResponse = await app.request('/api/v1/terminal-binding', {
      headers: { Authorization: 'Bearer secret' }
    });
    await expect(getResponse.json()).resolves.toEqual({
      ok: true,
      binding: {
        terminalId: 'mobile',
        conversationId: 'conv_1',
        updatedAt: 1,
        updatedBy: 'system-default'
      }
    });

    const putResponse = await app.request('/api/v1/terminal-binding', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ conversationId: 'conv_2' })
    });

    expect(putResponse.status).toBe(200);
    await expect(putResponse.json()).resolves.toEqual({
      ok: true,
      binding: {
        terminalId: 'mobile',
        conversationId: 'conv_2',
        updatedAt: 2,
        updatedBy: 'desktop-settings'
      }
    });
    expect(bindToConversation).toHaveBeenCalledWith('conv_2', 'desktop-settings');
  });

  test('serves and toggles cron jobs with bearer auth', async () => {
    const setEnabled = vi.fn<CronJobStorePort['setEnabled']>(() => Promise.resolve(true));
    const remove = vi.fn<CronJobStorePort['remove']>(() => Promise.resolve(true));
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      cronStore: cronStore({
        list: () => Promise.resolve([{
          jobId: 'cron_1',
          enabled: true,
          schedule: { kind: 'interval', intervalMs: 60_000 },
          nextRunAt: 60_000,
          missGraceMs: 120_000,
          payload: {
            definitionKey: 'linnsy_cron_runner',
            query: 'drink water'
          },
          createdAt: 1,
          updatedAt: 1
        }]),
        get: () => Promise.resolve({
          jobId: 'cron_1',
          enabled: true,
          schedule: { kind: 'interval', intervalMs: 60_000 },
          nextRunAt: 60_000,
          missGraceMs: 120_000,
          payload: {
            definitionKey: 'linnsy_cron_runner',
            query: 'drink water'
          },
          createdAt: 1,
          updatedAt: 1
        }),
        setEnabled,
        remove
      }),
      clock: { now: () => 2 }
    });

    const listResponse = await app.request('/api/v1/cron', {
      headers: { Authorization: 'Bearer secret' }
    });
    await expect(listResponse.json()).resolves.toEqual({
      ok: true,
      jobs: [{
        jobId: 'cron_1',
        schedule: { kind: 'interval', intervalMs: 60_000 },
        query: 'drink water',
        nextRunAt: 60_000,
        enabled: true
      }]
    });

    const patchResponse = await app.request('/api/v1/cron/cron_1', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ enabled: false })
    });
    expect(patchResponse.status).toBe(200);
    expect(setEnabled).toHaveBeenCalledWith('cron_1', false, 2);

    const deleteResponse = await app.request('/api/v1/cron/cron_1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer secret' }
    });
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({ ok: true, jobId: 'cron_1', deleted: true });
    expect(remove).toHaveBeenCalledWith('cron_1');
  });

  test('creates scheduled cron jobs through the desktop API', async () => {
    const upsert = vi.fn<CronJobStorePort['upsert']>((record) => Promise.resolve(record));
    const now = Date.UTC(2026, 3, 25, 8, 30);
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      cronStore: cronStore({ upsert }),
      clock: { now: () => now }
    });

    const response = await app.request('/api/v1/cron', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: 'prepare weekly report',
        schedule: { kind: 'weekly', dayOfWeek: 1, time: '10:00' }
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      ok: boolean;
      job: {
        schedule: { kind: 'weekly'; dayOfWeek: number; time: string };
        query: string;
        enabled: boolean;
      };
    };
    expect(body).toMatchObject({
      ok: true,
      job: {
        schedule: { kind: 'weekly', dayOfWeek: 1, time: '10:00' },
        query: 'prepare weekly report',
        enabled: true
      }
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      schedule: { kind: 'weekly', dayOfWeek: 1, time: '10:00' },
      payload: {
        definitionKey: 'linnsy_main',
        query: 'prepare weekly report'
      },
      createdAt: now,
      updatedAt: now
    }));
    const record = upsert.mock.calls[0]?.[0];
    expect(record?.jobId).toMatch(/^cron_/u);
    expect(record?.nextRunAt).toBeGreaterThan(now);
    expect(new Date(record?.nextRunAt ?? 0).getDay()).toBe(1);
    expect(new Date(record?.nextRunAt ?? 0).getHours()).toBe(10);

    for (const schedule of [
      { kind: 'one_shot', atMs: now + 60_000 },
      { kind: 'daily', time: '09:00' },
      { kind: 'interval', intervalMs: 3_600_000 }
    ]) {
      const createResponse = await app.request('/api/v1/cron', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: `create ${schedule.kind}`, schedule })
      });
      expect(createResponse.status).toBe(200);
    }
    expect(upsert).toHaveBeenCalledTimes(4);
  });

  test('rejects invalid weekly scheduled item input', async () => {
    const upsert = vi.fn<CronJobStorePort['upsert']>((record) => Promise.resolve(record));
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      cronStore: cronStore({ upsert })
    });

    const response = await app.request('/api/v1/cron', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: 'bad weekly',
        schedule: { kind: 'weekly', dayOfWeek: 9, time: '25:00' }
      })
    });

    expect(response.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  test('rejects scheduled item creation without bearer auth', async () => {
    const upsert = vi.fn<CronJobStorePort['upsert']>((record) => Promise.resolve(record));
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      cronStore: cronStore({ upsert })
    });

    const response = await app.request('/api/v1/cron', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'no auth',
        schedule: { kind: 'daily', time: '09:00' }
      })
    });

    expect(response.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  test('lists cron runs for a known job sorted by scheduled time', async () => {
    const listRuns = vi.fn<CronJobStorePort['listRuns']>(() => Promise.resolve([
      {
        cronRunId: 'cron_run_2',
        jobId: 'cron_1',
        scheduledAt: 2_000,
        startedAt: 2_000,
        finishedAt: 2_500,
        status: 'completed',
        runId: 'run_2'
      },
      {
        cronRunId: 'cron_run_1',
        jobId: 'cron_1',
        scheduledAt: 1_000,
        startedAt: 1_000,
        finishedAt: 1_100,
        status: 'failed',
        runId: 'run_1',
        errorCode: 'NOTIFICATION_NO_TARGET'
      }
    ]));
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      cronStore: cronStore({
        get: (jobId) => Promise.resolve(jobId === 'cron_1' ? sampleCronJob('cron_1') : null),
        listRuns
      })
    });

    const response = await app.request('/api/v1/cron/cron_1/runs?limit=5', {
      headers: { Authorization: 'Bearer secret' }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      jobId: 'cron_1',
      runs: [
        { cronRunId: 'cron_run_2', status: 'completed', runId: 'run_2', finishedAt: 2_500 },
        { cronRunId: 'cron_run_1', status: 'failed', errorCode: 'NOTIFICATION_NO_TARGET' }
      ]
    });
    expect(listRuns).toHaveBeenCalledWith('cron_1', 5);
  });

});
