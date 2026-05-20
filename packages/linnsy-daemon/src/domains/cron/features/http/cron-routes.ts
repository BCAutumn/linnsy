import { randomUUID } from 'node:crypto';

import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { LINNSY_ERROR_CODES } from '../../../../shared/errors.js';
import type { ClockPort } from '../../../../shared/ports.js';
import { systemClock } from '../../../../shared/ports.js';
import type { MessageRecord, MessageStorePort } from '../../../../persistence/stores/message/message-store-port.js';
import type { CronJobStorePort } from '../../persistence/cron-job-store-port.js';
import type {
  CronJobRecord,
  CronRunRecord
} from '../../definitions/cron.js';
import { computeInitialCronRunAt } from '../scheduler/functions/cron-time.js';
import { DEFAULT_CRON_DEFINITION_KEY } from '../../definitions/cron.js';

export interface CreateCronRoutesOptions {
  cronStore: Pick<CronJobStorePort, 'upsert' | 'get' | 'list' | 'setEnabled' | 'remove' | 'listRuns'>;
  messageStore?: Pick<MessageStorePort, 'listByRunId'>;
  clock?: ClockPort;
  jobIdFactory?: () => string;
}

const DEFAULT_RUNS_LIMIT = 10;
const MAX_RUNS_LIMIT = 50;
const SUBAGENT_DELEGATE_TOOLS = new Set(['delegate_to_internal', 'delegate_to_external']);
const SUBAGENT_SUMMARY_FENCE_PATTERN = /<subagent[-_]summary[\s>]/iu;

const createCronSchema = z.object({
  query: z.string().trim().min(1),
  definitionKey: z.string().trim().min(1).optional(),
  schedule: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('one_shot'), atMs: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal('daily'), time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/u) }).strict(),
    z.object({
      kind: z.literal('weekly'),
      dayOfWeek: z.number().int().min(0).max(6),
      time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/u)
    }).strict(),
    z.object({ kind: z.literal('interval'), intervalMs: z.number().int().positive() }).strict()
  ])
}).strict();

const updateCronSchema = z.object({
  enabled: z.boolean()
}).strict();

export function createCronRoutes(options: CreateCronRoutesOptions): Hono {
  const app = new Hono();
  const clock = options.clock ?? systemClock;
  const jobIdFactory = options.jobIdFactory ?? defaultJobIdFactory;

  app.get('/api/v1/cron', async (context) => {
    const enabledQuery = context.req.query('enabled');
    const enabled = enabledQuery === undefined ? undefined : enabledQuery === 'true';
    const limit = parsePositiveInt(context.req.query('limit'));
    const jobs = await options.cronStore.list({
      ...(enabled === undefined ? {} : { enabled }),
      ...(limit === undefined ? {} : { limit })
    });
    return context.json({ ok: true, jobs: jobs.map(toCronListEntry) });
  });

  app.post(
    '/api/v1/cron',
    zValidator('json', createCronSchema),
    async (context) => {
      const input = context.req.valid('json');
      const now = clock.now();
      const schedule = input.schedule;
      if (schedule.kind === 'one_shot' && schedule.atMs < now) {
        return context.json({
          ok: false,
          code: LINNSY_ERROR_CODES.CRON_SCHEDULE_INVALID
        }, 400);
      }
      const nextRunAt = computeInitialCronRunAt(schedule, now);
      const record: CronJobRecord = {
        jobId: jobIdFactory(),
        enabled: true,
        schedule,
        nextRunAt,
        missGraceMs: 7_200_000,
        payload: {
          definitionKey: input.definitionKey ?? DEFAULT_CRON_DEFINITION_KEY,
          query: input.query.trim()
        },
        createdAt: now,
        updatedAt: now
      };
      const job = await options.cronStore.upsert(record);
      return context.json({ ok: true, job: toCronListEntry(job) });
    }
  );

  app.delete('/api/v1/cron/:jobId', async (context) => {
    const jobId = context.req.param('jobId');
    const job = await options.cronStore.get(jobId);
    if (job === null) {
      return notFound(context, jobId);
    }
    const deleted = await options.cronStore.remove(jobId);
    return context.json({ ok: true, jobId, deleted });
  });

  app.patch(
    '/api/v1/cron/:jobId',
    zValidator('json', updateCronSchema),
    async (context) => {
      const jobId = context.req.param('jobId');
      const job = await options.cronStore.get(jobId);
      if (job === null) {
        return notFound(context, jobId);
      }
      const input = context.req.valid('json');
      const updated = await options.cronStore.setEnabled(jobId, input.enabled, clock.now());
      return context.json({ ok: true, jobId, enabled: input.enabled, updated });
    }
  );

  // 2026-05-05 拍板：定时安排升级 X1 自适应展示，前端按行展开拉历史执行
  // 列表（详见 docs/product/scenarios.md §3.3）。
  app.get('/api/v1/cron/:jobId/runs', async (context) => {
    const jobId = context.req.param('jobId');
    const job = await options.cronStore.get(jobId);
    if (job === null) {
      return notFound(context, jobId);
    }
    const limit = clampLimit(parsePositiveInt(context.req.query('limit')));
    const runs = await options.cronStore.listRuns(jobId, limit);
    return context.json({ ok: true, jobId, runs: runs.map(toCronRunEntry) });
  });

  // 2026-05-05 拍板：用 cron run 的 runId 反查本次执行产生的 outbound + 子 agent
  // 摘要，前端据此自适应判定"提醒型 / 任务型"。`hasSubagentSummary` 取自工具
  // 调用记录（delegate_to_internal / delegate_to_external）和 inbound 消息中
  // 出现的 `<subagent-summary>` 围栏文本。
  app.get('/api/v1/cron/:jobId/runs/:cronRunId/output', async (context) => {
    const jobId = context.req.param('jobId');
    const cronRunId = context.req.param('cronRunId');
    const job = await options.cronStore.get(jobId);
    if (job === null) {
      return notFound(context, jobId);
    }
    const runs = await options.cronStore.listRuns(jobId, MAX_RUNS_LIMIT);
    const cronRun = runs.find((entry) => entry.cronRunId === cronRunId);
    if (cronRun === undefined) {
      return cronRunNotFound(context, cronRunId);
    }
    const output = await collectRunOutput(cronRun, options.messageStore);
    return context.json({
      ok: true,
      jobId,
      cronRunId,
      run: toCronRunEntry(cronRun),
      output
    });
  });

  return app;
}

interface CronRunEntry {
  cronRunId: string;
  jobId: string;
  scheduledAt: number;
  startedAt?: number;
  finishedAt?: number;
  status: CronRunRecord['status'];
  runId?: string;
  errorCode?: string;
}

function toCronRunEntry(record: CronRunRecord): CronRunEntry {
  const entry: CronRunEntry = {
    cronRunId: record.cronRunId,
    jobId: record.jobId,
    scheduledAt: record.scheduledAt,
    status: record.status
  };
  if (record.startedAt !== undefined) entry.startedAt = record.startedAt;
  if (record.finishedAt !== undefined) entry.finishedAt = record.finishedAt;
  if (record.runId !== undefined) entry.runId = record.runId;
  if (record.errorCode !== undefined) entry.errorCode = record.errorCode;
  return entry;
}

interface CronRunOutput {
  conversationId: string | null;
  earliestMessageAt: number | null;
  summaryText: string;
  summaryLength: number;
  hasSubagentSummary: boolean;
  outboundMessageCount: number;
}

async function collectRunOutput(
  cronRun: CronRunRecord,
  messageStore: Pick<MessageStorePort, 'listByRunId'> | undefined
): Promise<CronRunOutput> {
  if (cronRun.runId === undefined || messageStore === undefined) {
    return {
      conversationId: null,
      earliestMessageAt: null,
      summaryText: '',
      summaryLength: 0,
      hasSubagentSummary: false,
      outboundMessageCount: 0
    };
  }
  const messages = await messageStore.listByRunId(cronRun.runId);
  if (messages.length === 0) {
    return {
      conversationId: null,
      earliestMessageAt: null,
      summaryText: '',
      summaryLength: 0,
      hasSubagentSummary: false,
      outboundMessageCount: 0
    };
  }
  const outboundTexts: string[] = [];
  let hasSubagentSummary = false;
  for (const message of messages) {
    if (message.source === 'outbound' && typeof message.text === 'string' && message.text.length > 0) {
      outboundTexts.push(message.text);
    }
    if (message.toolCalls !== undefined) {
      for (const toolCall of message.toolCalls) {
        if (SUBAGENT_DELEGATE_TOOLS.has(toolCall.function.name)) {
          hasSubagentSummary = true;
        }
      }
    }
    if (
      typeof message.text === 'string'
      && SUBAGENT_SUMMARY_FENCE_PATTERN.test(message.text)
    ) {
      hasSubagentSummary = true;
    }
  }
  const summaryText = outboundTexts.join('\n\n');
  const earliest = earliestMessageCreatedAt(messages);
  return {
    conversationId: messages[0]?.conversationId ?? null,
    earliestMessageAt: earliest,
    summaryText,
    summaryLength: summaryText.length,
    hasSubagentSummary,
    outboundMessageCount: outboundTexts.length
  };
}

function earliestMessageCreatedAt(messages: MessageRecord[]): number | null {
  let earliest: number | null = null;
  for (const message of messages) {
    if (earliest === null || message.createdAt < earliest) {
      earliest = message.createdAt;
    }
  }
  return earliest;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RUNS_LIMIT;
  return Math.min(Math.max(1, value), MAX_RUNS_LIMIT);
}

function cronRunNotFound(context: Context, cronRunId: string) {
  return context.json({
    ok: false,
    code: LINNSY_ERROR_CODES.CRON_JOB_NOT_FOUND,
    message: `cron run ${cronRunId} was not found`
  }, 404);
}

function toCronListEntry(job: CronJobRecord): Record<string, unknown> {
  return {
    jobId: job.jobId,
    schedule: job.schedule,
    query: job.payload.query,
    nextRunAt: job.nextRunAt,
    enabled: job.enabled
  };
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function defaultJobIdFactory(): string {
  return `cron_${randomUUID()}`;
}

function notFound(context: Context, jobId: string) {
  return context.json({
    ok: false,
    code: LINNSY_ERROR_CODES.CRON_JOB_NOT_FOUND,
    message: `cron job ${jobId} was not found`
  }, 404);
}
