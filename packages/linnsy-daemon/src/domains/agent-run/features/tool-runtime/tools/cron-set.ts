import { randomUUID } from 'node:crypto';

import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { CronJobStorePort } from '../../../../cron/persistence/cron-job-store-port.js';
import { DEFAULT_CRON_DEFINITION_KEY, type CronJobRecord, type CronSchedule } from '../../../../cron/definitions/cron.js';
import { computeInitialCronRunAt } from '../../../../cron/features/scheduler/functions/cron-time.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';

export interface CronSetOutput extends Record<string, unknown> {
  job: CronJobRecord;
}

export interface CreateCronSetToolOptions {
  cronStore: CronJobStorePort;
  now?: () => number;
  jobIdFactory?: () => string;
}

export interface CronSetTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<CronSetOutput>>;
}

export function createCronSetTool(options: CreateCronSetToolOptions): CronSetTool {
  const now = options.now ?? (() => Date.now());
  const jobIdFactory = options.jobIdFactory ?? defaultJobIdFactory;

  return {
    name: 'cron_set',
    description: 'Create a one-shot, daily, weekly, or interval scheduled item in the owner-wide schedule list.',
    definition: {
      parameters: {
        type: 'object',
        required: ['query'],
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'Reminder query to run when the schedule fires.' },
          definitionKey: {
            type: 'string',
            description: 'Registered agent definition to run. Defaults to linnsy_main.'
          },
          delayMs: {
            type: 'number',
            description: 'One-shot relative delay in milliseconds. Prefer this for reminders like "10 minutes later".'
          },
          atMs: { type: 'number', description: 'One-shot unix timestamp in milliseconds.' },
          dailyTime: { type: 'string', description: 'Daily time in HH:mm format.' },
          weeklyDayOfWeek: {
            type: 'number',
            description: 'Weekly day of week, 0 for Sunday through 6 for Saturday.'
          },
          weeklyTime: { type: 'string', description: 'Weekly time in HH:mm format.' },
          intervalMs: { type: 'number', description: 'Recurring interval in milliseconds.' },
          missGraceMs: { type: 'number', description: 'Optional miss grace in milliseconds.' }
        }
      }
    },
    getSchema(): OpenAIToolSchema {
      return {
        type: 'function',
        function: {
          name: this.name,
          description: this.description,
          parameters: toJsonObjectSchema(this.definition.parameters)
        }
      };
    },
    async execute(args): Promise<StructuredToolResult<CronSetOutput>> {
      const current = now();
      const schedule = readSchedule(args, current);
      const query = readNonEmptyString(args.query, 'cron_set query must be a non-empty string');
      const definitionKey = args.definitionKey === undefined
        ? DEFAULT_CRON_DEFINITION_KEY
        : readNonEmptyString(args.definitionKey, 'cron_set definitionKey must be a non-empty string');
      const record: CronJobRecord = {
        jobId: jobIdFactory(),
        enabled: true,
        schedule,
        nextRunAt: computeInitialCronRunAt(schedule, current),
        missGraceMs: readOptionalPositiveInteger(args.missGraceMs) ?? 7_200_000,
        payload: {
          definitionKey,
          query
        },
        createdAt: current,
        updatedAt: current
      };

      const job = await options.cronStore.upsert(record);
      return {
        data: { job },
        observation: `已创建定时任务 ${job.jobId}，schedule=${job.schedule.kind}，nextRunAt=${String(job.nextRunAt)}，enabled=${String(job.enabled)}。`
      };
    }
  };
}

function readSchedule(args: Record<string, unknown>, now: number): CronSchedule {
  const weeklyProvided = args.weeklyDayOfWeek !== undefined || args.weeklyTime !== undefined;
  const provided = [args.delayMs, args.atMs, args.dailyTime, weeklyProvided ? true : undefined, args.intervalMs]
    .filter((value) => value !== undefined);
  if (provided.length !== 1) {
    throw invalidSchedule('cron_set requires exactly one of delayMs, atMs, dailyTime, weeklyDayOfWeek+weeklyTime, or intervalMs');
  }
  if (args.delayMs !== undefined) {
    const delayMs = readPositiveInteger(args.delayMs, 'cron_set delayMs must be a positive integer');
    return { kind: 'one_shot', atMs: now + delayMs };
  }
  if (args.atMs !== undefined) {
    const atMs = readPositiveInteger(args.atMs, 'cron_set atMs must be a positive integer');
    if (atMs < now) {
      throw invalidSchedule('cron_set atMs must not be in the past');
    }
    return { kind: 'one_shot', atMs };
  }
  if (args.dailyTime !== undefined) {
    return { kind: 'daily', time: readDailyTime(args.dailyTime) };
  }
  if (weeklyProvided) {
    return {
      kind: 'weekly',
      dayOfWeek: readDayOfWeek(args.weeklyDayOfWeek),
      time: readDailyTime(args.weeklyTime)
    };
  }
  return {
    kind: 'interval',
    intervalMs: readPositiveInteger(args.intervalMs, 'cron_set intervalMs must be a positive integer')
  };
}

function readDailyTime(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidSchedule('cron_set dailyTime must be HH:mm');
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(value);
  if (match === null) {
    throw invalidSchedule('cron_set dailyTime must be HH:mm');
  }
  return value;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readPositiveInteger(value, 'cron_set missGraceMs must be a positive integer');
}

function readDayOfWeek(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 6) {
    throw invalidSchedule('cron_set weeklyDayOfWeek must be an integer from 0 to 6');
  }
  return value;
}

function readPositiveInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw invalidSchedule(message);
  }
  return value;
}

function readNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidSchedule(message);
  }
  return value.trim();
}

function invalidSchedule(message: string): LinnsyError {
  return new LinnsyError(LINNSY_ERROR_CODES.CRON_SCHEDULE_INVALID, message, false);
}

function defaultJobIdFactory(): string {
  return `cron_${randomUUID()}`;
}
