import { isRecord } from '../../../../../shared/json.js';

export interface CodexNormalizedEvent {
  node: string;
  sessionId?: string;
  partialResult?: Record<string, unknown>;
  finalMessage?: string;
  errorMessage?: string;
}

export function parseCodexJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed: unknown = JSON.parse(trimmed);
  return isRecord(parsed) ? parsed : null;
}

export function normalizeCodexEvent(raw: Record<string, unknown>): CodexNormalizedEvent {
  const node = readFirstString(raw, ['type', 'event', 'node']) ?? 'codex.event';
  const text = readFirstString(raw, ['message', 'text', 'output', 'content']);
  const error = readErrorMessage(raw);
  const sessionId = readSessionId(raw);
  return {
    node,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(error === undefined ? {} : { errorMessage: error }),
    ...(isFinalNode(node) && text !== undefined ? { finalMessage: text } : {}),
    partialResult: {
      raw
    }
  };
}

function readSessionId(raw: Record<string, unknown>): string | undefined {
  return readFirstString(raw, ['session_id', 'sessionId', 'thread_id', 'threadId']);
}

function readErrorMessage(raw: Record<string, unknown>): string | undefined {
  const error = raw.error;
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  if (isRecord(error)) {
    const message = error.message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  const node = readFirstString(raw, ['type', 'event', 'node']);
  const message = readFirstString(raw, ['message', 'text']);
  if (node !== undefined && node.toLowerCase().includes('error') && message !== undefined) {
    return message;
  }
  return undefined;
}

function readFirstString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function isFinalNode(node: string): boolean {
  const lower = node.toLowerCase();
  return lower.includes('final') || lower.includes('completed') || lower.includes('complete');
}
