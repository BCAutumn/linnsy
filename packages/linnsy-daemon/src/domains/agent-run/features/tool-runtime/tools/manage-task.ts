import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { TaskRecord } from '../../../../task/definitions/task.js';
import type { ExternalAgentDispatcherPort } from '../../../../task/features/external-dispatch/types.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';
import { toJsonObjectSchema, type LinnsyTool, type StructuredToolResult } from '../types.js';
import { createCancelTaskTool } from './cancel-task.js';
import { createContinueTaskTool } from './continue-task.js';
import { createPauseTaskTool } from './pause-task.js';
import { createResumeTaskTool } from './resume-task.js';

export type ManageTaskAction = 'cancel' | 'pause' | 'resume' | 'continue';

export interface ManageTaskOutput extends Record<string, unknown> {
  action: ManageTaskAction;
  task: TaskRecord;
  message?: string;
  flushedUpdateCount?: number;
}

export interface CreateManageTaskToolOptions {
  taskTracker: TaskTrackerPort;
  dispatcher: ExternalAgentDispatcherPort;
  now?: () => number;
}

export interface ManageTaskTool extends Omit<LinnsyTool, 'execute'> {
  execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<StructuredToolResult<ManageTaskOutput>>;
}

export function createManageTaskTool(options: CreateManageTaskToolOptions): ManageTaskTool {
  const cancelTask = createCancelTaskTool({
    taskTracker: options.taskTracker,
    dispatcher: options.dispatcher,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const pauseTask = createPauseTaskTool({
    taskTracker: options.taskTracker,
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const resumeTask = createResumeTaskTool({ taskTracker: options.taskTracker });
  const continueTask = createContinueTaskTool({
    taskTracker: options.taskTracker,
    dispatcher: options.dispatcher
  });

  return {
    name: 'manage_task',
    description: 'Control an existing task: cancel, pause, resume, or continue it with an owner message.',
    definition: {
      parameters: {
        type: 'object',
        required: ['action', 'taskId'],
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['cancel', 'pause', 'resume', 'continue'],
            description: 'Task control action to perform.'
          },
          taskId: {
            type: 'string',
            description: 'Task id to control. action=continue also supports unique short prefixes in the current conversation.'
          },
          message: {
            type: 'string',
            description: 'Required for action=continue. Owner approval or follow-up instruction to send to the same external session.'
          },
          reason: {
            type: 'string',
            description: 'Optional for action=cancel. Owner-facing reason for cancellation.'
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
    async execute(args, context): Promise<StructuredToolResult<ManageTaskOutput>> {
      const action = readAction(args.action);
      validateActionInput(action, args);
      if (action === 'cancel') {
        return withAction(action, await cancelTask.execute(args, context));
      }
      if (action === 'pause') {
        return withAction(action, await pauseTask.execute(args, context));
      }
      if (action === 'resume') {
        return withAction(action, await resumeTask.execute(args, context));
      }
      return withAction(action, await continueTask.execute(args, context));
    }
  };
}

function withAction(
  action: ManageTaskAction,
  result: StructuredToolResult<Record<string, unknown> & { task: TaskRecord }>
): StructuredToolResult<ManageTaskOutput> {
  return {
    data: {
      action,
      task: result.data.task,
      ...withOptionalString('message', result.data.message),
      ...withOptionalNumber('flushedUpdateCount', result.data.flushedUpdateCount)
    },
    observation: result.observation
  };
}

function readAction(value: unknown): ManageTaskAction {
  if (value === 'cancel' || value === 'pause' || value === 'resume' || value === 'continue') {
    return value;
  }
  throw invalidArgument('manage_task action must be cancel, pause, resume, or continue');
}

function validateActionInput(action: ManageTaskAction, args: Record<string, unknown>): void {
  if (action === 'continue') {
    if (typeof args.message !== 'string' || args.message.trim().length === 0) {
      throw invalidArgument('manage_task action=continue requires message');
    }
    return;
  }
  if (args.message !== undefined) {
    throw invalidArgument('manage_task message is only allowed for action=continue');
  }
}

function withOptionalString<K extends string>(key: K, value: unknown): { [P in K]?: string } {
  return typeof value === 'string' ? { [key]: value } as { [P in K]?: string } : {};
}

function withOptionalNumber<K extends string>(key: K, value: unknown): { [P in K]?: number } {
  return typeof value === 'number' ? { [key]: value } as { [P in K]?: number } : {};
}

function invalidArgument(message: string): LinnsyError {
  return new LinnsyError(LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED, message, false);
}
