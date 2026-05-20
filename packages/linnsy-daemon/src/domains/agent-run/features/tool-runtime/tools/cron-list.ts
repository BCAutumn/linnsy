import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import type { CronJobStorePort } from '../../../../cron/persistence/cron-job-store-port.js';
import type { CronJobRecord, CronSchedule } from '../../../../cron/definitions/cron.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';

export interface CronListEntry extends Record<string, unknown> {
  jobId: string;
  schedule: CronSchedule;
  query: string;
  nextRunAt: number;
  enabled: boolean;
}

export interface CronListOutput extends Record<string, unknown> {
  jobs: CronListEntry[];
}

export interface CreateCronListToolOptions {
  cronStore: Pick<CronJobStorePort, 'list'>;
}

export interface CronListTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<CronListOutput>>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function createCronListTool(options: CreateCronListToolOptions): CronListTool {
  return {
    name: 'cron_list',
    description: 'List owner-wide cron reminders. Defaults to enabled reminders only.',
    definition: {
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: {
            type: 'boolean',
            description: 'When omitted, only enabled reminders are returned.'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of reminders to return. Defaults to 50 and clamps to 200.'
          }
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
    async execute(args): Promise<StructuredToolResult<CronListOutput>> {
      const enabled = typeof args.enabled === 'boolean' ? args.enabled : true;
      const limit = readLimit(args.limit);
      const jobs = await options.cronStore.list({ enabled, limit });
      const data: CronListOutput = { jobs: jobs.map(toEntry) };
      return {
        data,
        observation: `已列出 ${String(data.jobs.length)} 个定时任务，enabled=${String(enabled)}，limit=${String(limit)}。`
      };
    }
  };
}

function readLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(value, MAX_LIMIT);
}

function toEntry(job: CronJobRecord): CronListEntry {
  return {
    jobId: job.jobId,
    schedule: job.schedule,
    query: job.payload.query,
    nextRunAt: job.nextRunAt,
    enabled: job.enabled
  };
}
