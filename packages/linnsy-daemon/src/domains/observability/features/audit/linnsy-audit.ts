import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import type { AiMessage, AuditEnvelope } from '@linnlabs/linnkit/contracts';
import type { AuditPort } from '@linnlabs/linnkit/ports';

import type { LinnsyConfig } from '../../../../config/schema.js';
import {
  resolveDefaultAuditLogPath,
  resolveDefaultRunContextAuditLogPath
} from '../../../../config/path-manager.js';
import type { LoggerPort } from '../../../../shared/ports.js';
import { silentLogger } from '../../../../shared/ports.js';

export interface LinnsyAuditManager {
  readonly decisionAuditPort: AuditPort;
  readonly decisionLogPath: string;
  readonly runContextAudit: RunContextAuditPort;
  readonly runContextLogPath: string;
  cleanupNow(): Promise<void>;
  dispose(): void;
}

export interface RunContextAuditPort {
  recordRunContext(input: RunContextAuditInput): Promise<void>;
}

export interface RunContextAuditInput {
  runId: string;
  conversationId: string;
  turnId: string;
  query: string;
  status: 'completed' | 'failed' | 'cancelled';
  currentNode?: string;
  iterationsUsed?: number;
  finalAnswer?: string;
  error?: { code: string; message: string; recoverable: boolean };
  wakeSource?: string;
  contextFenceCount: number;
  startedAt: number;
  completedAt: number;
  snapshots: RunContextSnapshotInput[];
}

export interface RunContextSnapshotInput {
  sequence: number;
  modelId: string;
  messageCount: number;
  messages: AiMessage[];
}

export interface CreateLinnsyAuditManagerOptions {
  config: LinnsyConfig;
  logger?: LoggerPort;
}

interface ManagedJsonlWriterOptions {
  filePath: string;
  maxFileBytes: number;
  maxFiles: number;
  retentionMs: number;
  logger: LoggerPort;
}

interface AuditCleanupConfig {
  cleanupIntervalMs: number;
  retentionMs: number;
  decisionMaxFileBytes: number;
  decisionMaxFiles: number;
  runContextEnabled: boolean;
  runContextMaxFileBytes: number;
  runContextMaxFiles: number;
}

interface PrunableFile {
  filePath: string;
  mtimeMs: number;
}

interface RunContextAuditRecord {
  kind: 'run_context';
  schemaVersion: 1;
  runId: string;
  conversationId: string;
  turnId: string;
  query: string;
  status: RunContextAuditInput['status'];
  currentNode?: string;
  iterationsUsed?: number;
  finalAnswer?: string;
  error?: RunContextAuditInput['error'];
  wakeSource?: string;
  contextFenceCount: number;
  startedAt: number;
  completedAt: number;
  snapshotCount: number;
  uniqueMessageCount: number;
  snapshots: RunContextAuditSnapshotRecord[];
  uniqueMessages: RunContextAuditMessageRecord[];
}

interface RunContextAuditSnapshotRecord {
  sequence: number;
  modelId: string;
  messageCount: number;
  messageRefs: string[];
}

interface RunContextAuditMessageRecord {
  hash: string;
  message: AiMessage;
}

const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_DECISION_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_DECISION_MAX_FILES = 16;
const DEFAULT_RUN_CONTEXT_MAX_FILE_BYTES = 128 * 1024 * 1024;
const DEFAULT_RUN_CONTEXT_MAX_FILES = 24;

export const noopRunContextAudit: RunContextAuditPort = {
  recordRunContext() {
    return Promise.resolve();
  }
};

export function createLinnsyAuditManager(options: CreateLinnsyAuditManagerOptions): LinnsyAuditManager {
  const logger = options.logger ?? silentLogger;
  const cleanup = readAuditCleanupConfig(options.config);
  const decisionLogPath = resolveDefaultAuditLogPath(options.config.home);
  const runContextLogPath = resolveDefaultRunContextAuditLogPath(options.config.home);
  const decisionWriter = new ManagedJsonlWriter({
    filePath: decisionLogPath,
    maxFileBytes: cleanup.decisionMaxFileBytes,
    maxFiles: cleanup.decisionMaxFiles,
    retentionMs: cleanup.retentionMs,
    logger
  });
  const runContextWriter = new ManagedJsonlWriter({
    filePath: runContextLogPath,
    maxFileBytes: cleanup.runContextMaxFileBytes,
    maxFiles: cleanup.runContextMaxFiles,
    retentionMs: cleanup.retentionMs,
    logger
  });
  const runContextAudit = cleanup.runContextEnabled
    ? createFileRunContextAudit(runContextWriter)
    : noopRunContextAudit;
  const timer = setInterval(() => {
    Promise.all([decisionWriter.cleanup(), runContextWriter.cleanup()]).catch((error: unknown) => {
      logger.warn('audit cleanup failed', { error: serializeError(error) });
    });
  }, cleanup.cleanupIntervalMs);
  timer.unref();
  Promise.all([decisionWriter.cleanup(), runContextWriter.cleanup()]).catch((error: unknown) => {
    logger.warn('initial audit cleanup failed', { error: serializeError(error) });
  });

  return {
    decisionAuditPort: {
      emit(envelope) {
        return decisionWriter.write(envelope);
      }
    },
    decisionLogPath,
    runContextAudit,
    runContextLogPath,
    async cleanupNow(): Promise<void> {
      await Promise.all([decisionWriter.cleanup(), runContextWriter.cleanup()]);
    },
    dispose(): void {
      clearInterval(timer);
    }
  };
}

function createFileRunContextAudit(writer: ManagedJsonlWriter): RunContextAuditPort {
  return {
    recordRunContext(input): Promise<void> {
      return writer.write(createRunContextAuditRecord(input));
    }
  };
}

function createRunContextAuditRecord(input: RunContextAuditInput): RunContextAuditRecord {
  const uniqueMessages = new Map<string, AiMessage>();
  const snapshots = input.snapshots.map((snapshot): RunContextAuditSnapshotRecord => {
    const auditMessages = snapshot.messages
      .map(sanitizeRunContextAuditMessage)
      .filter((message): message is AiMessage => message !== undefined);
    const messageRefs = auditMessages.map((message) => {
      const hash = hashJson(message);
      if (!uniqueMessages.has(hash)) {
        uniqueMessages.set(hash, message);
      }
      return hash;
    });
    return {
      sequence: snapshot.sequence,
      modelId: snapshot.modelId,
      messageCount: auditMessages.length,
      messageRefs
    };
  });

  return {
    kind: 'run_context',
    schemaVersion: 1,
    runId: input.runId,
    conversationId: input.conversationId,
    turnId: input.turnId,
    query: input.query,
    status: input.status,
    ...(input.currentNode === undefined ? {} : { currentNode: input.currentNode }),
    ...(input.iterationsUsed === undefined ? {} : { iterationsUsed: input.iterationsUsed }),
    ...(input.finalAnswer === undefined ? {} : { finalAnswer: input.finalAnswer }),
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.wakeSource === undefined ? {} : { wakeSource: input.wakeSource }),
    contextFenceCount: input.contextFenceCount,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    snapshotCount: snapshots.length,
    uniqueMessageCount: uniqueMessages.size,
    snapshots,
    uniqueMessages: Array.from(uniqueMessages.entries()).map(([hash, message]) => ({ hash, message }))
  };
}

function sanitizeRunContextAuditMessage(message: AiMessage): AiMessage | undefined {
  // 审计只保存可回放上下文；可读思考链和 provider reasoning sidecar 不属于排障必需事实。
  if (message.role === 'assistant' && message.type === 'thought') {
    return undefined;
  }

  const cloned = structuredClone(message);
  if (cloned.metadata === undefined || !('reasoning_details' in cloned.metadata)) {
    return cloned;
  }

  const { reasoning_details: reasoningDetails, ...metadata } = cloned.metadata;
  void reasoningDetails;
  if (Object.keys(metadata).length === 0) {
    return withoutMetadata(cloned);
  }
  return { ...cloned, metadata };
}

function withoutMetadata(message: AiMessage): AiMessage {
  const { metadata, ...rest } = message;
  void metadata;
  return rest;
}

class ManagedJsonlWriter {
  private readonly filePath: string;
  private readonly maxFileBytes: number;
  private readonly maxFiles: number;
  private readonly retentionMs: number;
  private readonly logger: LoggerPort;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(options: ManagedJsonlWriterOptions) {
    this.filePath = options.filePath;
    this.maxFileBytes = options.maxFileBytes;
    this.maxFiles = options.maxFiles;
    this.retentionMs = options.retentionMs;
    this.logger = options.logger;
  }

  public write(record: AuditEnvelope | RunContextAuditRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    this.writeChain = this.writeChain.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      await this.rotateIfNeeded(byteLength(line));
      await appendFile(this.filePath, line, { mode: 0o600 });
      await this.cleanupFiles();
    });
    return this.writeChain;
  }

  public cleanup(): Promise<void> {
    this.writeChain = this.writeChain.catch(() => undefined).then(() => this.cleanupFiles());
    return this.writeChain;
  }

  private async cleanupFiles(): Promise<void> {
    try {
      const files = await this.listPrunableFiles();
      const now = Date.now();
      const staleByAge = files.filter((file) => now - file.mtimeMs > this.retentionMs);
      const staleByCount = files
        .filter((file) => !staleByAge.some((stale) => stale.filePath === file.filePath))
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .slice(this.maxFiles);
      await Promise.all([...staleByAge, ...staleByCount].map((file) => unlink(file.filePath)));
    } catch (error: unknown) {
      this.logger.warn('audit retention cleanup failed', {
        filePath: this.filePath,
        error: serializeError(error)
      });
    }
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    try {
      const info = await stat(this.filePath);
      if (info.size + incomingBytes <= this.maxFileBytes) {
        return;
      }
      await rename(this.filePath, await this.createArchivePath());
    } catch (error: unknown) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  private async createArchivePath(): Promise<string> {
    const dir = dirname(this.filePath);
    const base = basenameWithoutExtension(this.filePath);
    const extension = extname(this.filePath) || '.jsonl';
    for (let index = 0; index < 100; index += 1) {
      const suffix = index === 0 ? '' : `-${index.toString()}`;
      const filePath = join(dir, `${base}-${Date.now().toString()}${suffix}${extension}`);
      try {
        await stat(filePath);
      } catch (error: unknown) {
        if (isMissingFileError(error)) {
          return filePath;
        }
        throw error;
      }
    }
    throw new Error(`failed to allocate audit archive path for ${this.filePath}`);
  }

  private async listPrunableFiles(): Promise<PrunableFile[]> {
    const dir = dirname(this.filePath);
    const activeName = basename(this.filePath);
    const activeBase = basenameWithoutExtension(this.filePath);
    const activeExtension = extname(this.filePath) || '.jsonl';
    const entries = await readdir(dir).catch((error: unknown) => {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    });
    const candidates = entries.filter((entry) => {
      return entry === activeName || (entry.startsWith(`${activeBase}-`) && entry.endsWith(activeExtension));
    });
    return Promise.all(candidates.map(async (entry) => {
      const filePath = join(dir, entry);
      const info = await stat(filePath);
      return { filePath, mtimeMs: info.mtimeMs };
    }));
  }
}

function readAuditCleanupConfig(config: LinnsyConfig): AuditCleanupConfig {
  const audit = config.observability?.audit;
  return {
    cleanupIntervalMs: audit?.cleanup_interval_ms ?? DEFAULT_CLEANUP_INTERVAL_MS,
    retentionMs: audit?.retention_ms ?? DEFAULT_RETENTION_MS,
    decisionMaxFileBytes: audit?.decision_max_file_bytes ?? DEFAULT_DECISION_MAX_FILE_BYTES,
    decisionMaxFiles: audit?.decision_max_files ?? DEFAULT_DECISION_MAX_FILES,
    runContextEnabled: audit?.run_context_enabled ?? true,
    runContextMaxFileBytes: audit?.run_context_max_file_bytes ?? DEFAULT_RUN_CONTEXT_MAX_FILE_BYTES,
    runContextMaxFiles: audit?.run_context_max_files ?? DEFAULT_RUN_CONTEXT_MAX_FILES
  };
}

function basenameWithoutExtension(filePath: string): string {
  const extension = extname(filePath);
  const name = basename(filePath);
  return extension.length === 0 ? name : name.slice(0, -extension.length);
}

function hashJson(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function isMissingFileError(error: unknown): boolean {
  return isObjectWithCode(error) && error.code === 'ENOENT';
}

function isObjectWithCode(value: unknown): value is { code: unknown } {
  return typeof value === 'object' && value !== null && 'code' in value;
}

function serializeError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (isObjectWithMessage(error)) {
    return {
      message: error.message,
      ...(typeof error.code === 'string' ? { code: error.code } : {})
    };
  }
  return { message: String(error) };
}

function isObjectWithMessage(value: unknown): value is { message: string; code?: unknown } {
  return typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string';
}
