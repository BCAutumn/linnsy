import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import { isRecord } from '../../../../shared/json.js';

export interface ToolResultGuardPort {
  guard(input: ToolResultGuardInput): Promise<string>;
}

export interface ToolResultGuardInput {
  toolName: string;
  observation: string;
  data: Record<string, unknown>;
  context: ToolExecutionContext;
}

export interface ToolResultStorePort {
  write(input: ToolResultWriteInput): Promise<ToolResultWriteOutput>;
}

export interface ToolResultWriteInput {
  workspacePath: string;
  toolCallId: string;
  payload: string;
}

export interface ToolResultWriteOutput {
  absolutePath: string;
  ref: string;
}

export interface CreateToolResultGuardOptions {
  store: ToolResultStorePort;
  maxChars?: number;
  summaryChars?: number;
}

export function createToolResultGuard(options: CreateToolResultGuardOptions): ToolResultGuardPort {
  const maxChars = options.maxChars ?? 16_000;
  const summaryChars = options.summaryChars ?? 1_000;

  return {
    async guard(input): Promise<string> {
      if (input.observation.length <= maxChars) {
        return input.observation;
      }
      const workspacePath = readWorkspacePath(input.data);
      const toolCallId = readToolCallId(input.context);
      const stored = await options.store.write({
        workspacePath,
        toolCallId,
        payload: input.observation
      });
      return JSON.stringify({
        truncated: true,
        code: LINNSY_ERROR_CODES.TOOL_RESULT_OVERSIZE,
        toolName: input.toolName,
        ref: stored.ref,
        summary: input.observation.slice(0, summaryChars)
      });
    }
  };
}

function readWorkspacePath(data: Record<string, unknown>): string {
  const value = data.workspacePath;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  throw new LinnsyError(
    LINNSY_ERROR_CODES.TOOL_RESULT_OVERSIZE,
    'oversized tool observation requires workspacePath in data for persistence',
    true
  );
}

function readToolCallId(context: ToolExecutionContext): string {
  if (typeof context.parentToolCallId === 'string' && context.parentToolCallId.trim().length > 0) {
    return context.parentToolCallId;
  }
  if (isRecord(context) && typeof context.runId === 'string') {
    return context.runId;
  }
  return 'unknown';
}
