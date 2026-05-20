import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { CronJobRecord } from '../../../../cron/definitions/cron.js';
import type { CronJobStorePort } from '../../../../cron/persistence/cron-job-store-port.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';
import { createCronListTool, type CronListEntry } from './cron-list.js';
import { createCronRemoveTool } from './cron-remove.js';
import { createCronSetTool } from './cron-set.js';

export type ManageScheduleAction = 'set' | 'list' | 'remove';

export interface ManageScheduleOutput extends Record<string, unknown> {
  action: ManageScheduleAction;
  job?: CronJobRecord;
  jobs?: CronListEntry[];
  jobId?: string;
  deleted?: boolean;
}

export interface CreateManageScheduleToolOptions {
  cronStore: CronJobStorePort;
  now?: () => number;
  jobIdFactory?: () => string;
}

export interface ManageScheduleTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<ManageScheduleOutput>>;
}

const setFields = new Set([
  'action',
  'query',
  'definitionKey',
  'delayMs',
  'atMs',
  'dailyTime',
  'weeklyDayOfWeek',
  'weeklyTime',
  'intervalMs',
  'missGraceMs'
]);
const listFields = new Set(['action', 'enabled', 'limit']);
const removeFields = new Set(['action', 'jobId']);

export function createManageScheduleTool(options: CreateManageScheduleToolOptions): ManageScheduleTool {
  const cronSet = createCronSetTool({
    cronStore: options.cronStore,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.jobIdFactory === undefined ? {} : { jobIdFactory: options.jobIdFactory })
  });
  const cronList = createCronListTool({ cronStore: options.cronStore });
  const cronRemove = createCronRemoveTool({ cronStore: options.cronStore });

  return {
    name: 'manage_schedule',
    description: 'Manage the owner-wide reminder schedule: set, list, or remove reminders.',
    definition: {
      parameters: {
        type: 'object',
        required: ['action'],
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['set', 'list', 'remove'],
            description: 'Schedule action: set creates a reminder, list shows reminders, remove deletes one reminder.'
          },
          query: { type: 'string', description: 'Required for action=set. Reminder query to run when the schedule fires.' },
          definitionKey: {
            type: 'string',
            description: 'Optional for action=set. Registered agent definition to run. Defaults to linnsy_main.'
          },
          delayMs: {
            type: 'number',
            description: 'Optional for action=set. One-shot relative delay in milliseconds. Prefer this for reminders like "10 minutes later".'
          },
          atMs: { type: 'number', description: 'Optional for action=set. One-shot unix timestamp in milliseconds.' },
          dailyTime: { type: 'string', description: 'Optional for action=set. Daily time in HH:mm format.' },
          weeklyDayOfWeek: {
            type: 'number',
            description: 'Optional for action=set. Weekly day of week, 0 for Sunday through 6 for Saturday.'
          },
          weeklyTime: { type: 'string', description: 'Optional for action=set. Weekly time in HH:mm format.' },
          intervalMs: { type: 'number', description: 'Optional for action=set. Recurring interval in milliseconds.' },
          missGraceMs: { type: 'number', description: 'Optional for action=set. Miss grace in milliseconds.' },
          enabled: {
            type: 'boolean',
            description: 'Optional for action=list. When omitted, only enabled reminders are returned.'
          },
          limit: {
            type: 'number',
            description: 'Optional for action=list. Maximum number of reminders to return. Defaults to 50 and clamps to 200.'
          },
          jobId: { type: 'string', description: 'Required for action=remove. Reminder job id to delete.' }
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
    async execute(args, context): Promise<StructuredToolResult<ManageScheduleOutput>> {
      const action = readAction(args.action);
      validateActionFields(action, args);
      if (action === 'set') {
        const result = await cronSet.execute(buildSetArgs(args), context);
        return {
          data: { action, job: result.data.job },
          observation: result.observation
        };
      }
      if (action === 'list') {
        const result = await cronList.execute(buildListArgs(args), context);
        return {
          data: { action, jobs: result.data.jobs },
          observation: result.observation
        };
      }
      const result = await cronRemove.execute(buildRemoveArgs(args), context);
      return {
        data: { action, jobId: result.data.jobId, deleted: result.data.deleted },
        observation: result.observation
      };
    }
  };
}

function readAction(value: unknown): ManageScheduleAction {
  if (value === 'set' || value === 'list' || value === 'remove') {
    return value;
  }
  throw invalidArgument('manage_schedule action must be set, list, or remove');
}

function validateActionFields(action: ManageScheduleAction, args: Record<string, unknown>): void {
  const allowed = action === 'set' ? setFields : action === 'list' ? listFields : removeFields;
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      throw invalidArgument(`manage_schedule field ${key} is not allowed for action=${action}`);
    }
  }
}

function buildSetArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of setFields) {
    if (key !== 'action' && args[key] !== undefined) {
      result[key] = args[key];
    }
  }
  return result;
}

function buildListArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (args.enabled !== undefined) {
    result.enabled = args.enabled;
  }
  if (args.limit !== undefined) {
    result.limit = args.limit;
  }
  return result;
}

function buildRemoveArgs(args: Record<string, unknown>): Record<string, unknown> {
  return { jobId: args.jobId };
}

function invalidArgument(message: string): LinnsyError {
  return new LinnsyError(LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED, message, false);
}
