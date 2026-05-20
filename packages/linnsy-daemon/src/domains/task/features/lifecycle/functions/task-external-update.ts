import type { ExternalUpdate, TaskRecord } from '../../../definitions/task.js';
import { isRecord } from '../../../../../shared/json.js';

export const MAX_PAUSED_EXTERNAL_UPDATES = 64;

export function buildPausedExternalUpdateRecord(
  task: TaskRecord,
  update: ExternalUpdate,
  updatedAt: number
): TaskRecord {
  const pausedUpdates = readPausedUpdates(task);
  return {
    ...task,
    payload: {
      ...(task.payload ?? {}),
      pausedUpdates: [...pausedUpdates, update].slice(-MAX_PAUSED_EXTERNAL_UPDATES)
    },
    updatedAt
  };
}

export function buildExternalProgressUpdateRecord(
  task: TaskRecord,
  update: ExternalUpdate,
  updatedAt: number
): TaskRecord {
  const next: TaskRecord = {
    ...task,
    status: task.status === 'dispatched' ? 'in_progress' : task.status,
    updatedAt
  };
  if (update.node !== undefined) {
    next.lastNode = update.node;
  }
  if (update.partialResult !== undefined) {
    next.result = mergeExternalPartialResult(task.result, update.partialResult);
  }
  return next;
}

export function mergeExternalPartialResult(
  current: Record<string, unknown> | undefined,
  partial: Record<string, unknown>
): Record<string, unknown> {
  return mergeRecords(current ?? {}, partial);
}

function readPausedUpdates(task: TaskRecord): ExternalUpdate[] {
  const value = task.payload?.pausedUpdates;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isExternalUpdate);
}

function isExternalUpdate(value: unknown): value is ExternalUpdate {
  return isRecord(value);
}

function mergeRecords(
  current: Record<string, unknown>,
  partial: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(partial)) {
    const currentValue = merged[key];
    merged[key] = isRecord(currentValue) && isRecord(value)
      ? mergeRecords(currentValue, value)
      : value;
  }
  return merged;
}
