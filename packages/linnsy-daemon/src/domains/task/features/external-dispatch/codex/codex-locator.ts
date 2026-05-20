import { stat } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { TaskLocator } from '../../../definitions/task.js';

const unsafeCodexCwdRoots = new Set([
  '/',
  '/home',
  '/Users',
  '/tmp',
  '/private/tmp',
  '/var',
  '/var/tmp'
]);

export function readCodexCwd(locator: TaskLocator | undefined): string {
  if (locator === undefined) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
      'codex dispatcher requires task.locator',
      false
    );
  }
  if (locator.kind !== 'directory') {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_LOCATOR_KIND_NOT_SUPPORTED,
      `codex dispatcher requires locator.kind=directory, got ${locator.kind}`,
      false
    );
  }
  const cwd = locator.ref;
  if (cwd === undefined || cwd.trim().length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
      'codex dispatcher requires locator.ref',
      false
    );
  }
  if (!isAbsolute(cwd)) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
      'codex dispatcher requires locator.ref to be an absolute directory',
      false
    );
  }
  const normalizedCwd = normalize(cwd);
  if (unsafeCodexCwdRoots.has(normalizedCwd)) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
      `codex dispatcher locator.ref is too broad: ${normalizedCwd}`,
      false
    );
  }
  return normalizedCwd;
}

export async function assertCodexCwdDirectory(cwd: string): Promise<void> {
  try {
    const result = await stat(cwd);
    if (!result.isDirectory()) {
      throw new LinnsyError(
        LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
        `codex dispatcher locator.ref is not a directory: ${cwd}`,
        false
      );
    }
  } catch (error: unknown) {
    if (error instanceof LinnsyError) {
      throw error;
    }
    throw new LinnsyError(
      LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID,
      `codex dispatcher locator.ref directory does not exist: ${cwd}`,
      false
    );
  }
}
