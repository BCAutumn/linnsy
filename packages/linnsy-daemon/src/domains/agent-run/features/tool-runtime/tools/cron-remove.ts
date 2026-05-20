import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { CronJobStorePort } from '../../../../cron/persistence/cron-job-store-port.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';

export interface CronRemoveOutput extends Record<string, unknown> {
  jobId: string;
  deleted: boolean;
}

export interface CreateCronRemoveToolOptions {
  cronStore: CronJobStorePort;
}

export interface CronRemoveTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<CronRemoveOutput>>;
}

export function createCronRemoveTool(options: CreateCronRemoveToolOptions): CronRemoveTool {
  return {
    name: 'cron_remove',
    description: 'Permanently delete an owner-wide cron reminder by id. After this, the reminder will not fire again.',
    definition: {
      parameters: {
        type: 'object',
        required: ['jobId'],
        additionalProperties: false,
        properties: {
          jobId: { type: 'string', description: 'Cron job id to delete.' }
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
    async execute(args): Promise<StructuredToolResult<CronRemoveOutput>> {
      const jobId = readJobId(args.jobId);
      const job = await options.cronStore.get(jobId);
      if (job === null) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.CRON_JOB_NOT_FOUND,
          `cron job ${jobId} was not found`,
          false
        );
      }
      const deleted = await options.cronStore.remove(jobId);
      return {
        data: { jobId, deleted },
        observation: `已删除定时任务 ${jobId}，deleted=${String(deleted)}。`
      };
    }
  };
}

function readJobId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.CRON_JOB_NOT_FOUND,
      'cron_remove jobId must be a non-empty string',
      false
    );
  }
  return value.trim();
}
