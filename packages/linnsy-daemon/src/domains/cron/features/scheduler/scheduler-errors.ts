import { LINNSY_ERROR_CODES } from '../../../../shared/errors.js';

export function errorCodeFrom(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED;
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { value: String(error) };
}
