import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { ExternalAgentDispatcherPort } from '../../../../task/features/external-dispatch/types.js';
import type { TaskRecord, TaskStatus } from '../../../../task/definitions/task.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import type { LinnsyTool, StructuredToolResult } from '../types.js';
import {
  readTaskId,
  taskControlSchema,
  type TaskControlOutput
} from './task-control-shared.js';
import { resolveTaskByInput } from './task-id-resolver.js';

export interface ContinueTaskOutput extends TaskControlOutput {
  message: string;
}

export interface CreateContinueTaskToolOptions {
  taskTracker: TaskTrackerPort;
  dispatcher: ExternalAgentDispatcherPort;
}

export interface ContinueTaskTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<ContinueTaskOutput>>;
}

const continuableStatuses = new Set<TaskStatus>(['dispatched', 'in_progress', 'completed']);

export function createContinueTaskTool(options: CreateContinueTaskToolOptions): ContinueTaskTool {
  return {
    name: 'continue_task',
    description: 'Send an additional owner message to the same external task session.',
    definition: {
      parameters: {
        type: 'object',
        required: ['taskId', 'message'],
        additionalProperties: false,
        properties: {
          taskId: {
            type: 'string',
            description: 'External task id to continue.'
          },
          message: {
            type: 'string',
            description: 'Owner approval or follow-up instruction to send to the same external session.'
          }
        }
      }
    },
    getSchema() {
      return taskControlSchema(this.name, this.description, this.definition.parameters);
    },
    async execute(args, context): Promise<StructuredToolResult<ContinueTaskOutput>> {
      const taskId = readTaskId(args.taskId, 'continue_task');
      const message = readMessage(args.message);
      const { task, resolvedByPrefix } = await readContinuableExternalTask(
        options.taskTracker,
        taskId,
        context.conversationId
      );
      const resolvedTaskId = task.taskId;

      const current = task.status === 'completed'
        ? await options.taskTracker.transition(resolvedTaskId, 'in_progress', {
          payload: {
            ...(task.payload ?? {}),
            lastContinueMessage: message
          },
          completedAt: null
        })
        : task;

      try {
        await options.dispatcher.continue({ taskId: resolvedTaskId, message });
      } catch (error: unknown) {
        await options.taskTracker.transition(resolvedTaskId, 'failed', {
          result: { errorMessage: error instanceof Error ? error.message : String(error) }
        });
        throw error;
      }

      const next = await options.taskTracker.get(current.taskId) ?? current;
      return {
        data: { task: next, message },
        observation: [
          `已继续任务 ${next.taskId}，status=${next.status}。`,
          resolvedByPrefix ? `输入 taskId=${taskId}，已按前缀匹配到 ${next.taskId}。` : ''
        ].filter((line) => line.length > 0).join('\n')
      };
    }
  };
}

function readMessage(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED,
      'continue_task message must be a non-empty string',
      false
    );
  }
  return value;
}

async function readContinuableExternalTask(
  taskTracker: TaskTrackerPort,
  taskId: string,
  conversationId: string | undefined
): Promise<{ task: TaskRecord; resolvedByPrefix: boolean }> {
  const { task, resolvedByPrefix } = await resolveTaskByInput(taskId, conversationId, taskTracker);
  if (task.kind !== 'external' || !continuableStatuses.has(task.status)) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_CANNOT_CONTINUE,
      `continue_task requires an external task in dispatched, in_progress, or completed status, got ${task.kind}/${task.status}`,
      false
    );
  }
  return { task, resolvedByPrefix };
}
