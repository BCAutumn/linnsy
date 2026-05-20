import type { OpenAIToolSchema } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { ExternalUpdate, TaskRecord } from '../../../../task/definitions/task.js';
import { toJsonObjectSchema, type LinnsyTool } from '../types.js';

export interface TaskControlOutput extends Record<string, unknown> {
  task: TaskRecord;
}

export function taskControlSchema(
  name: string,
  description: string,
  parameters: LinnsyTool['definition']['parameters']
): OpenAIToolSchema {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: toJsonObjectSchema(parameters)
    }
  };
}

export function readTaskId(value: unknown, toolName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidArgument(`${toolName} taskId must be a non-empty string`);
  }
  return value;
}

export function readOptionalReason(value: unknown, toolName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidArgument(`${toolName} reason must be a non-empty string when provided`);
  }
  return value;
}

export function readPausedUpdates(task: TaskRecord): ExternalUpdate[] {
  const value = task.payload?.pausedUpdates;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isExternalUpdate);
}

export function withoutPausedUpdates(task: TaskRecord): Record<string, unknown> {
  const payload = { ...(task.payload ?? {}) };
  delete payload.pausedUpdates;
  return payload;
}

function isExternalUpdate(value: unknown): value is ExternalUpdate {
  return typeof value === 'object' && value !== null;
}

function invalidArgument(message: string): LinnsyError {
  return new LinnsyError(LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED, message, false);
}
