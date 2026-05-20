import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import type {
  CodexTaskSessionSnapshot,
  CodexThreadMetadata,
  CodexThreadProject
} from '../../../../../shared/dto/codex-session.js';
import { isRecord } from '../../../../../shared/json.js';
import type { TaskLocator, TaskRecord } from '../../../definitions/task.js';

export interface CodexSessionBridgePort {
  summarizeTask(task: TaskRecord): CodexTaskSessionSnapshot;
  listProjects(options?: { limit?: number }): Promise<CodexThreadProject[]>;
  listRecentThreads(options?: {
    limit?: number;
    cwd?: string;
    includeChildDirectories?: boolean;
  }): Promise<CodexThreadMetadata[]>;
  getThread(sessionId: string): Promise<CodexThreadMetadata | null>;
}

export interface CreateCodexSessionBridgeOptions {
  codexHome?: string;
  maxPromptPreviewChars?: number;
  maxFinalMessagePreviewChars?: number;
}

interface CodexIndexEntry {
  id: string;
  updatedAt: number;
  threadName?: string;
}

interface CodexSessionMeta {
  id: string;
  cwd?: string;
  source?: string;
  originator?: string;
}

type CodexThreadRecord = CodexThreadMetadata;

const defaultPreviewChars = 240;
const defaultRecentLimit = 20;
const maxRecentLimit = 100;

export function createCodexSessionBridge(
  options: CreateCodexSessionBridgeOptions = {}
): CodexSessionBridgePort {
  const codexHome = options.codexHome ?? join(homedir(), '.codex');
  const maxPromptPreviewChars = options.maxPromptPreviewChars ?? defaultPreviewChars;
  const maxFinalMessagePreviewChars = options.maxFinalMessagePreviewChars ?? defaultPreviewChars;

  return {
    summarizeTask(task): CodexTaskSessionSnapshot {
      const sessionId = readNonEmptyString(task.externalRef);
      return {
        taskId: task.taskId,
        title: task.title,
        status: task.status,
        ...(task.locator === undefined ? {} : { locator: toDtoLocator(task.locator) }),
        ...(task.workspacePath === undefined ? {} : { workspacePath: task.workspacePath }),
        ...(sessionId === undefined ? {} : { sessionId }),
        ...withOptionalPreview('promptPreview', task.payload?.prompt, maxPromptPreviewChars),
        ...withOptionalPreview('finalMessagePreview', task.result?.finalMessage, maxFinalMessagePreviewChars),
        canOpen: sessionId !== undefined
      };
    },

    async listProjects(input = {}): Promise<CodexThreadProject[]> {
      const limit = clampLimit(input.limit ?? defaultRecentLimit);
      const projectsByCwd = new Map<string, CodexThreadProject>();
      for (const thread of await readThreadRecords(codexHome)) {
        if (thread.cwd === undefined) {
          continue;
        }
        const current = projectsByCwd.get(thread.cwd);
        if (current === undefined) {
          projectsByCwd.set(thread.cwd, {
            cwd: thread.cwd,
            label: basename(thread.cwd) || thread.cwd,
            threadCount: 1,
            latestUpdatedAt: thread.updatedAt
          });
        } else {
          projectsByCwd.set(thread.cwd, {
            ...current,
            threadCount: current.threadCount + 1,
            latestUpdatedAt: Math.max(current.latestUpdatedAt, thread.updatedAt)
          });
        }
      }
      return [...projectsByCwd.values()]
        .sort((left, right) => right.latestUpdatedAt - left.latestUpdatedAt)
        .slice(0, limit);
    },

    async listRecentThreads(input = {}): Promise<CodexThreadMetadata[]> {
      const limit = clampLimit(input.limit ?? defaultRecentLimit);
      return (await readThreadRecords(codexHome))
        .filter((thread) => matchesRequestedCwd(thread.cwd, input.cwd, input.includeChildDirectories ?? false))
        .slice(0, limit)
        .map((thread) => toThreadMetadata(thread, input.cwd));
    },

    async getThread(sessionId): Promise<CodexThreadMetadata | null> {
      const thread = (await readThreadRecords(codexHome))
        .find((entry) => entry.id === sessionId.trim());
      return thread === undefined ? null : toThreadMetadata(thread);
    }
  };
}

async function readThreadRecords(codexHome: string): Promise<CodexThreadRecord[]> {
  const indexEntries = await readSessionIndex(join(codexHome, 'session_index.jsonl'));
  if (indexEntries.length === 0) {
    return [];
  }
  const metaById = await readSessionMetaById(join(codexHome, 'sessions'), new Set(indexEntries.map((entry) => entry.id)));
  return indexEntries.map((entry) => {
    const meta = metaById.get(entry.id);
    return {
      id: entry.id,
      updatedAt: entry.updatedAt,
      ...(entry.threadName === undefined ? {} : { threadName: entry.threadName }),
      ...(meta?.cwd === undefined ? {} : { cwd: meta.cwd }),
      ...(meta?.source === undefined ? {} : { source: meta.source }),
      ...(meta?.originator === undefined ? {} : { originator: meta.originator })
    };
  });
}

async function readSessionIndex(filePath: string): Promise<CodexIndexEntry[]> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(readIndexEntry)
    .filter((entry): entry is CodexIndexEntry => entry !== null);

  return entries
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function readIndexEntry(line: string): CodexIndexEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const id = readNonEmptyString(parsed.id);
  const updatedAt = readTimeMs(parsed.updated_at);
  if (id === undefined || updatedAt === undefined) {
    return null;
  }
  return {
    id,
    updatedAt,
    ...withOptionalString('threadName', parsed.thread_name)
  };
}

async function readSessionMetaById(
  sessionsDir: string,
  ids: ReadonlySet<string>
): Promise<ReadonlyMap<string, CodexSessionMeta>> {
  if (ids.size === 0) {
    return new Map();
  }
  const files = await listJsonlFiles(sessionsDir);
  const result = new Map<string, CodexSessionMeta>();
  for (const file of files) {
    if (result.size >= ids.size) {
      break;
    }
    const meta = await readSessionMeta(file);
    if (meta !== null && ids.has(meta.id) && !result.has(meta.id)) {
      result.set(meta.id, meta);
    }
  }
  return result;
}

async function listJsonlFiles(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsonlFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path);
    }
  }

  const withMtime = await Promise.all(files.map(async (file) => {
    try {
      return { file, mtimeMs: (await stat(file)).mtimeMs };
    } catch {
      return { file, mtimeMs: 0 };
    }
  }));
  return withMtime
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map((entry) => entry.file);
}

async function readSessionMeta(filePath: string): Promise<CodexSessionMeta | null> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (firstLine === undefined) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.type !== 'session_meta' || !isRecord(parsed.payload)) {
    return null;
  }
  const payload = parsed.payload;
  const id = readNonEmptyString(payload.id);
  if (id === undefined) {
    return null;
  }
  return {
    id,
    ...withOptionalString('cwd', payload.cwd),
    ...withOptionalString('source', payload.source),
    ...withOptionalString('originator', payload.originator)
  };
}

function toDtoLocator(locator: TaskLocator): CodexTaskSessionSnapshot['locator'] {
  return {
    kind: locator.kind,
    label: locator.label,
    ...(locator.ref === undefined ? {} : { ref: locator.ref })
  };
}

function toThreadMetadata(thread: CodexThreadRecord, requestedCwd?: string): CodexThreadMetadata {
  const isChildOfRequestedCwd = readChildMatch(thread.cwd, requestedCwd);
  return {
    id: thread.id,
    updatedAt: thread.updatedAt,
    ...(thread.threadName === undefined ? {} : { threadName: thread.threadName }),
    ...(thread.cwd === undefined ? {} : { cwd: thread.cwd }),
    ...(isChildOfRequestedCwd === undefined ? {} : { isChildOfRequestedCwd }),
    ...(thread.source === undefined ? {} : { source: thread.source }),
    ...(thread.originator === undefined ? {} : { originator: thread.originator })
  };
}

function matchesRequestedCwd(candidate: string | undefined, requested: string | undefined, includeChildDirectories: boolean): boolean {
  if (requested === undefined || requested.trim().length === 0) {
    return true;
  }
  if (candidate === undefined || candidate.trim().length === 0) {
    return false;
  }
  if (pathsAreSame(candidate, requested)) {
    return true;
  }
  return includeChildDirectories && pathIsInside(candidate, requested);
}

function readChildMatch(candidate: string | undefined, requested: string | undefined): boolean | undefined {
  if (requested === undefined || candidate === undefined) {
    return undefined;
  }
  if (pathsAreSame(candidate, requested)) {
    return false;
  }
  return pathIsInside(candidate, requested) ? true : undefined;
}

function pathsAreSame(left: string, right: string): boolean {
  return normalizeComparablePath(left) === normalizeComparablePath(right);
}

function pathIsInside(candidate: string, root: string): boolean {
  const normalizedRoot = normalizeComparablePath(root);
  const normalizedCandidate = normalizeComparablePath(candidate);
  const pathFromRoot = relative(normalizedRoot, normalizedCandidate);
  return pathFromRoot.length > 0 && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot);
}

function normalizeComparablePath(path: string): string {
  return resolve(path.trim());
}

function withOptionalPreview(
  key: 'promptPreview' | 'finalMessagePreview',
  value: unknown,
  maxChars: number
): { promptPreview?: string; finalMessagePreview?: string } {
  const text = readNonEmptyString(value);
  if (text === undefined) {
    return {};
  }
  return { [key]: truncatePreview(text, maxChars) };
}

function withOptionalString<K extends string>(key: K, value: unknown): { [P in K]?: string } {
  const text = readNonEmptyString(value);
  return text === undefined ? {} : { [key]: text } as { [P in K]?: string };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readTimeMs(value: unknown): number | undefined {
  const text = readNonEmptyString(value);
  if (text === undefined) {
    return undefined;
  }
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : undefined;
}

function truncatePreview(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function clampLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    return defaultRecentLimit;
  }
  return Math.min(limit, maxRecentLimit);
}
