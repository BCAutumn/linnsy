import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { ExternalAgentDispatcherPort } from '../../../../task/features/external-dispatch/types.js';
import type { TaskRecord } from '../../../../task/definitions/task.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import type { LinnsyTool, StructuredToolResult } from '../types.js';
import {
  readOptionalReason,
  readTaskId,
  taskControlSchema,
  type TaskControlOutput
} from './task-control-shared.js';

export type CancelTaskOutput = TaskControlOutput;

export interface CreateCancelTaskToolOptions {
  taskTracker: TaskTrackerPort;
  dispatcher?: ExternalAgentDispatcherPort;
  now?: () => number;
}

export interface CancelTaskTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<CancelTaskOutput>>;
}

export function createCancelTaskTool(options: CreateCancelTaskToolOptions): CancelTaskTool {
  const now = options.now ?? (() => Date.now());
  return {
    name: 'cancel_task',
    description: 'Cancel an active delegated task and notify the external dispatcher when the task is external.',
    definition: {
      parameters: {
        type: 'object',
        required: ['taskId'],
        additionalProperties: false,
        properties: {
          taskId: {
            type: 'string',
            description: 'Task id to cancel.'
          },
          reason: {
            type: 'string',
            description: 'Optional owner-facing reason for cancellation.'
          }
        }
      }
    },
    getSchema() {
      return taskControlSchema(this.name, this.description, this.definition.parameters);
    },
    async execute(args): Promise<StructuredToolResult<CancelTaskOutput>> {
      const taskId = readTaskId(args.taskId, 'cancel_task');
      const reason = readOptionalReason(args.reason, 'cancel_task');
      const existing = await readTask(options.taskTracker, taskId);
      if (existing.kind === 'external' && options.dispatcher !== undefined) {
        await options.dispatcher.cancel(reason === undefined ? { taskId } : { taskId, reason });
      }
      const patch = reason === undefined
        ? { cancelledAt: now() }
        : { cancelledAt: now(), cancelReason: reason };
      const task = await options.taskTracker.transition(taskId, 'cancelled', patch);
      return {
        data: { task },
        observation: `已取消任务 ${task.taskId}，status=${task.status}。`
      };
    }
  };
}

async function readTask(taskTracker: TaskTrackerPort, taskId: string): Promise<TaskRecord> {
  const task = await taskTracker.get(taskId);
  if (task === null) {
    throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${taskId} was not found`, false);
  }
  return task;
}
