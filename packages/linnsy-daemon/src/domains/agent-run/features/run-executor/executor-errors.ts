import { isRecord } from '../../../../shared/json.js';
import type { RunOutcome } from '../run-spawner/types.js';

export function serializeRunContextAuditError(error: unknown, status: RunOutcome['status']): RunOutcome['error'] {
  const serialized = serializeUnknownError(error);
  return {
    code: status === 'cancelled' ? 'RUN_CANCELLED' : (serialized.code ?? 'RUN_FAILED'),
    message: serialized.message,
    recoverable: false
  };
}

export function serializeUnknownError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (isRecord(error) && typeof error.message === 'string') {
    return {
      message: error.message,
      ...(typeof error.code === 'string' ? { code: error.code } : {})
    };
  }
  return { message: String(error) };
}
