import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { TaskRecord } from '../../../../task/definitions/task.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import type { LinnsyTool, StructuredToolResult } from '../types.js';
import {
  readPausedUpdates,
  readTaskId,
  taskControlSchema,
  withoutPausedUpdates,
  type TaskControlOutput
} from './task-control-shared.js';

export interface ResumeTaskOutput extends TaskControlOutput {
  flushedUpdateCount: number;
}

export interface CreateResumeTaskToolOptions {
  taskTracker: TaskTrackerPort;
}

export interface ResumeTaskTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<ResumeTaskOutput>>;
}

export function createResumeTaskTool(options: CreateResumeTaskToolOptions): ResumeTaskTool {
  return {
    name: 'resume_task',
    description: 'Resume a paused delegated task and replay buffered progress updates once.',
    definition: {
      parameters: {
        type: 'object',
        required: ['taskId'],
        additionalProperties: false,
        properties: {
          taskId: {
            type: 'string',
            description: 'Task id to resume.'
          }
        }
      }
    },
    getSchema() {
      return taskControlSchema(this.name, this.description, this.definition.parameters);
    },
    async execute(args): Promise<StructuredToolResult<ResumeTaskOutput>> {
      const taskId = readTaskId(args.taskId, 'resume_task');
      const task = await getTaskOrThrow(options.taskTracker, taskId);
      if (task.status !== 'paused') {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.TASK_TRANSITION_INVALID,
          `resume_task requires a paused task, got ${task.status}`,
          false
        );
      }
      const pausedUpdates = readPausedUpdates(task);

      let current = await options.taskTracker.transition(taskId, 'in_progress', {
        payload: withoutPausedUpdates(task)
      });
      for (const update of pausedUpdates) {
        await options.taskTracker.onExternalUpdate(taskId, update);
      }
      current = await getTaskOrThrow(options.taskTracker, taskId);

      const data: ResumeTaskOutput = {
        task: current,
        flushedUpdateCount: pausedUpdates.length
      };
      return {
        data,
        observation: `已恢复任务 ${current.taskId}，status=${current.status}，flushedUpdateCount=${String(pausedUpdates.length)}。`
      };
    }
  };
}

async function getTaskOrThrow(taskTracker: TaskTrackerPort, taskId: string): Promise<TaskRecord> {
  const task = await taskTracker.get(taskId);
  if (task === null) {
    throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${taskId} was not found`, false);
  }
  return task;
}
