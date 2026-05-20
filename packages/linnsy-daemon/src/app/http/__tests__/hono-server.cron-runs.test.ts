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
  taskTracker
} from './scenarios/hono-server-support.js';
import type { CronJobStorePort } from './scenarios/hono-server-support.js';

describe('desktop Hono API cron run output', () => {
  test('returns 404 when listing runs for an unknown cron job', async () => {
    const listRuns = vi.fn<CronJobStorePort['listRuns']>();
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      cronStore: cronStore({
        get: () => Promise.resolve(null),
        listRuns
      })
    });

    const response = await app.request('/api/v1/cron/cron_missing/runs', {
      headers: { Authorization: 'Bearer secret' }
    });

    expect(response.status).toBe(404);
    expect(listRuns).not.toHaveBeenCalled();
  });

  test('reports cron run output with subagent summary signal when delegate tools were called', async () => {
    const cronRun = {
      cronRunId: 'cron_run_1',
      jobId: 'cron_1',
      scheduledAt: 1_000,
      startedAt: 1_000,
      finishedAt: 1_500,
      status: 'completed' as const,
      runId: 'run_1'
    };
    const messageStore = {
      listByRunId: vi.fn(() => Promise.resolve([
        {
          messageId: 'msg_1',
          conversationId: 'conv_42',
          role: 'assistant',
          source: 'outbound',
          text: '周报已经整理好了，主要数据……',
          runId: 'run_1',
          createdAt: 1_100,
          toolCalls: [
            {
              id: 'call_1',
              type: 'function' as const,
              function: { name: 'delegate_to_internal', arguments: '{}' }
            }
          ]
        },
        {
          messageId: 'msg_2',
          conversationId: 'conv_42',
          role: 'assistant',
          source: 'outbound',
          text: '附：本周关键事件清单。',
          runId: 'run_1',
          createdAt: 1_400
        }
      ]))
    };
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      cronStore: cronStore({
        get: (jobId) => Promise.resolve(jobId === 'cron_1' ? sampleCronJob('cron_1') : null),
        listRuns: () => Promise.resolve([cronRun])
      }),
      messageStore
    });

    const response = await app.request('/api/v1/cron/cron_1/runs/cron_run_1/output', {
      headers: { Authorization: 'Bearer secret' }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      jobId: 'cron_1',
      cronRunId: 'cron_run_1',
      run: { cronRunId: 'cron_run_1', status: 'completed' },
      output: {
        conversationId: 'conv_42',
        earliestMessageAt: 1_100,
        outboundMessageCount: 2,
        hasSubagentSummary: true
      }
    });
    const followup = await app.request('/api/v1/cron/cron_1/runs/cron_run_1/output', {
      headers: { Authorization: 'Bearer secret' }
    });
    const body = await followup.json() as { output: { summaryText: string; summaryLength: number } };
    expect(body.output.summaryText).toContain('周报已经整理好了');
    expect(body.output.summaryText).toContain('附：本周关键事件清单');
    expect(body.output.summaryLength).toBe(body.output.summaryText.length);
    expect(messageStore.listByRunId).toHaveBeenCalledWith('run_1');
  });

  test('cron run output detects <subagent-summary> fence text from injected messages', async () => {
    const cronRun = {
      cronRunId: 'cron_run_2',
      jobId: 'cron_1',
      scheduledAt: 2_000,
      startedAt: 2_000,
      finishedAt: 2_100,
      status: 'completed' as const,
      runId: 'run_2'
    };
    const messageStore = {
      listByRunId: () => Promise.resolve([
        {
          messageId: 'fence_1',
          conversationId: 'conv_42',
          role: 'user',
          source: 'inbound',
          text: '<subagent-summary>整理报告完成</subagent-summary>',
          runId: 'run_2',
          createdAt: 2_050
        },
        {
          messageId: 'reply_1',
          conversationId: 'conv_42',
          role: 'assistant',
          source: 'outbound',
          text: '已收到子 agent 报告。',
          runId: 'run_2',
          createdAt: 2_080
        }
      ])
    };
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      cronStore: cronStore({
        get: () => Promise.resolve(sampleCronJob('cron_1')),
        listRuns: () => Promise.resolve([cronRun])
      }),
      messageStore
    });

    const response = await app.request('/api/v1/cron/cron_1/runs/cron_run_2/output', {
      headers: { Authorization: 'Bearer secret' }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      output: {
        hasSubagentSummary: true,
        outboundMessageCount: 1
      }
    });
  });

  test('cron run output yields empty payload when run produced no messages or has no runId', async () => {
    const cronRunWithoutRunId = {
      cronRunId: 'cron_run_3',
      jobId: 'cron_1',
      scheduledAt: 3_000,
      finishedAt: 3_100,
      status: 'failed' as const,
      errorCode: 'CRON_SCHEDULE_INVALID'
    };
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      cronStore: cronStore({
        get: () => Promise.resolve(sampleCronJob('cron_1')),
        listRuns: () => Promise.resolve([cronRunWithoutRunId])
      }),
      messageStore: { listByRunId: () => Promise.resolve([]) }
    });

    const response = await app.request('/api/v1/cron/cron_1/runs/cron_run_3/output', {
      headers: { Authorization: 'Bearer secret' }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      output: {
        conversationId: null,
        summaryText: '',
        summaryLength: 0,
        hasSubagentSummary: false,
        outboundMessageCount: 0
      }
    });
  });

  test('returns 404 when reading output for a cron run that does not belong to the job', async () => {
    const app = createTaskWebhookApp({
      bearerToken: 'secret',
      taskTracker: taskTracker({}),
      cronStore: cronStore({
        get: () => Promise.resolve(sampleCronJob('cron_1')),
        listRuns: () => Promise.resolve([])
      })
    });

    const response = await app.request('/api/v1/cron/cron_1/runs/cron_run_missing/output', {
      headers: { Authorization: 'Bearer secret' }
    });

    expect(response.status).toBe(404);
  });

});
