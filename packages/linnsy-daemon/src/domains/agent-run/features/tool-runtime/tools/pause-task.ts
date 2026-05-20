import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import type { LinnsyTool, StructuredToolResult } from '../types.js';
import { readTaskId, taskControlSchema, type TaskControlOutput } from './task-control-shared.js';

export type PauseTaskOutput = TaskControlOutput;

export interface CreatePauseTaskToolOptions {
  taskTracker: TaskTrackerPort;
  now?: () => number;
}

export interface PauseTaskTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<PauseTaskOutput>>;
}

export function createPauseTaskTool(options: CreatePauseTaskToolOptions): PauseTaskTool {
  const now = options.now ?? (() => Date.now());
  return {
    name: 'pause_task',
    description: 'Pause an active delegated task in Linnsy and buffer later progress updates.',
    definition: {
      parameters: {
        type: 'object',
        required: ['taskId'],
        additionalProperties: false,
        properties: {
          taskId: {
            type: 'string',
            description: 'Task id to pause.'
          }
        }
      }
    },
    getSchema() {
      return taskControlSchema(this.name, this.description, this.definition.parameters);
    },
    async execute(args): Promise<StructuredToolResult<PauseTaskOutput>> {
      const taskId = readTaskId(args.taskId, 'pause_task');
      const task = await options.taskTracker.transition(taskId, 'paused', { pausedAt: now() });
      return {
        data: { task },
        observation: `已暂停任务 ${task.taskId}，status=${task.status}。`
      };
    }
  };
}
