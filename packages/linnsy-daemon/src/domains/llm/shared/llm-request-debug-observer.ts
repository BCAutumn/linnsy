import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { AiMessage } from '@linnlabs/linnkit/contracts';

import type { LoggerPort } from '../../../shared/ports.js';
import { silentLogger } from '../../../shared/ports.js';

export interface LlmRequestDebugScope {
  runId: string;
  conversationId: string;
  turnId: string;
}

export interface LlmRequestDebugObserverPort {
  observeCanonical(input: {
    scope?: LlmRequestDebugScope;
    modelId: string;
    messages: AiMessage[];
  }): Promise<void>;
  observeWireRequest(input: {
    scope?: LlmRequestDebugScope;
    modelId: string;
    provider: string;
    apiProtocol: string;
    stream: boolean;
    request: unknown;
  }): Promise<void>;
}

export interface CreateFileLlmRequestDebugObserverOptions {
  enabled: boolean;
  home: string;
  dir?: string;
  logger?: LoggerPort;
  maxMessageChars?: number;
  maxRecordsPerRun?: number;
  maxFileBytes?: number;
  maxFiles?: number;
}

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 8;

export const noopLlmRequestDebugObserver: LlmRequestDebugObserverPort = {
  observeCanonical() {
    return Promise.resolve();
  },
  observeWireRequest() {
    return Promise.resolve();
  }
};

export function createFileLlmRequestDebugObserver(
  options: CreateFileLlmRequestDebugObserverOptions
): LlmRequestDebugObserverPort {
  if (!options.enabled) {
    return noopLlmRequestDebugObserver;
  }
  const logger = options.logger ?? silentLogger;
  const maxMessageChars = options.maxMessageChars ?? 4000;
  const maxRecordsPerRun = options.maxRecordsPerRun ?? 64;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const dir = options.dir ?? join(options.home, 'debug', 'llm-requests');
  const counts = new Map<string, number>();

  async function writeRecord(record: Record<string, unknown>, scope: LlmRequestDebugScope | undefined): Promise<void> {
    const runId = scope?.runId ?? 'unknown-run';
    const count = counts.get(runId) ?? 0;
    if (count >= maxRecordsPerRun) {
      return;
    }
    counts.set(runId, count + 1);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const preparedRecord = prepareRecordForDisk(record, maxFileBytes);
    const line = `${JSON.stringify(preparedRecord)}\n`;
    const filePath = await resolveWritablePath(dir, runId, maxFileBytes, byteLength(line));
    await appendFile(filePath, line, { mode: 0o600 });
    await pruneOldDebugFiles(dir, maxFiles);
    logger.info('llm request debug snapshot written', {
      runId,
      modelId: String(record.modelId),
      kind: String(record.kind),
      messageCount: readMessageCount(record),
      path: filePath
    });
  }

  return {
    async observeCanonical(input): Promise<void> {
      const record = {
        kind: 'canonical',
        ...scopeFields(input.scope),
        modelId: input.modelId,
        messageCount: input.messages.length,
        messageSummary: input.messages.map((message) => summarizeMessage(message, maxMessageChars)),
        payloadHash: hashJson(input.messages),
        messages: input.messages
      };
      await writeRecord(record, input.scope);
    },
    async observeWireRequest(input): Promise<void> {
      const record = {
        kind: 'wire',
        ...scopeFields(input.scope),
        modelId: input.modelId,
        provider: input.provider,
        apiProtocol: input.apiProtocol,
        stream: input.stream,
        messageCount: countWireMessages(input.request),
        payloadHash: hashJson(input.request),
        request: input.request
      };
      await writeRecord(record, input.scope);
    }
  };
}

function prepareRecordForDisk(record: Record<string, unknown>, maxFileBytes: number): Record<string, unknown> {
  const redacted = redactSensitive(record);
  if (!isRecord(redacted)) {
    return {
      kind: 'invalid',
      payloadTruncated: true
    };
  }
  if (byteLength(JSON.stringify(redacted)) <= maxFileBytes) {
    return redacted;
  }
  const compact: Record<string, unknown> = {
    ...redacted,
    payloadTruncated: true,
    payloadTruncatedReason: `record exceeded ${maxFileBytes.toString()} bytes`
  };
  delete compact.messages;
  delete compact.request;
  return compact;
}

async function resolveWritablePath(
  dir: string,
  runId: string,
  maxFileBytes: number,
  incomingBytes: number
): Promise<string> {
  const safeRunId = runId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = join(dir, `${safeRunId}.jsonl`);
  try {
    const info = await stat(filePath);
    if (info.size + incomingBytes > maxFileBytes) {
      return join(dir, `${safeRunId}.${Date.now().toString()}.jsonl`);
    }
  } catch {
    return filePath;
  }
  return filePath;
}

async function pruneOldDebugFiles(dir: string, maxFiles: number): Promise<void> {
  const entries = await readdir(dir);
  const files = await Promise.all(entries
    .filter((entry) => entry.endsWith('.jsonl'))
    .map(async (entry) => {
      const filePath = join(dir, entry);
      const info = await stat(filePath);
      return { filePath, mtimeMs: info.mtimeMs };
    }));
  const stale = files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(maxFiles);
  await Promise.all(stale.map((file) => unlink(file.filePath)));
}

function redactSensitive(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') {
    return redactSecretText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, seen));
  }
  if (!isRecord(value)) {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? '[REDACTED]' : redactSensitive(child, seen);
  }
  seen.delete(value);
  return output;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, '');
  return normalized.includes('authorization')
    || normalized.includes('apikey')
    || normalized.includes('token')
    || normalized.includes('bearer')
    || normalized.includes('password')
    || normalized.includes('secret')
    || normalized === 'cookie'
    || normalized === 'setcookie';
}

function redactSecretText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_SECRET]');
}

function scopeFields(scope: LlmRequestDebugScope | undefined): Record<string, unknown> {
  if (scope === undefined) {
    return {};
  }
  return {
    runId: scope.runId,
    conversationId: scope.conversationId,
    turnId: scope.turnId
  };
}

function summarizeMessage(message: AiMessage, maxChars: number): Record<string, unknown> {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  return {
    role: message.role,
    type: message.type,
    chars: content.length,
    preview: content.slice(0, maxChars)
  };
}

function countWireMessages(request: unknown): number | undefined {
  if (!isRecord(request)) {
    return undefined;
  }
  if (Array.isArray(request.messages)) {
    return request.messages.length;
  }
  if (Array.isArray(request.input)) {
    return request.input.length;
  }
  return undefined;
}

function readMessageCount(record: Record<string, unknown>): number | undefined {
  return typeof record.messageCount === 'number' ? record.messageCount : undefined;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
