import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import { isRecord } from '../../../../../shared/json.js';

import type { TaskLocator, TaskLocatorKind } from '../../../definitions/task.js';

export function readTaskLocator(value: unknown, label: string): TaskLocator {
  if (!isRecord(value)) {
    throw invalidLocator(`${label} must be an object`);
  }
  const kind = readLocatorKind(value.kind, `${label}.kind`);
  const locatorLabel = readNonEmptyString(value.label, `${label}.label`);
  const result: TaskLocator = { kind, label: locatorLabel };

  if (kind === 'none') {
    if (value.ref !== undefined) {
      throw invalidLocator(`${label}.ref must be omitted when kind is none`);
    }
  } else {
    result.ref = readNonEmptyString(value.ref, `${label}.ref`);
  }

  if (value.meta !== undefined) {
    if (!isRecord(value.meta)) {
      throw invalidLocator(`${label}.meta must be an object`);
    }
    result.meta = value.meta;
  }

  return result;
}

export function formatTaskLocator(locator: TaskLocator | undefined): string {
  if (locator === undefined) {
    return '未知';
  }
  if (locator.ref === undefined) {
    return locator.label;
  }
  return `${locator.label}(${locator.ref})`;
}

function readLocatorKind(value: unknown, label: string): TaskLocatorKind {
  if (typeof value !== 'string' || !isTaskLocatorKind(value)) {
    throw invalidLocator(`${label} must be one of directory, project, remote, none`);
  }
  return value;
}

function isTaskLocatorKind(value: string): value is TaskLocatorKind {
  return value === 'directory' || value === 'project' || value === 'remote' || value === 'none';
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidLocator(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function invalidLocator(message: string): LinnsyError {
  return new LinnsyError(LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID, message, false);
}
