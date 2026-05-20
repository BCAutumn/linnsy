import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import { LinnsyError } from '../../../shared/errors.js';
import { parseJsonObject, stringifyJsonValue } from '../../../persistence/json.js';
import {
  MEMORY_ERROR_CODES,
  type MemoryItem,
  type MemoryListOptions,
  type MemoryProviderPort,
  type MemoryUpsertInput
} from './memory-store-port.js';

interface SqliteMemoryStoreOptions {
  now?: () => number;
  idFactory?: () => string;
}

interface MemoryRow {
  memory_id: string;
  scope: string;
  content: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  metadata_json: string | null;
}

type MemoryUpsertParams = [
  string,
  string,
  string,
  number,
  number,
  number | null,
  string | null
];

export class SqliteMemoryStore implements MemoryProviderPort {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly getStatement: Database.Statement<[string], MemoryRow>;
  private readonly upsertStatement: Database.Statement<MemoryUpsertParams>;
  private readonly archiveStatement: Database.Statement<[number, number, string]>;

  public constructor(private readonly db: Database.Database, options: SqliteMemoryStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? randomUUID;
    this.getStatement = db.prepare<[string], MemoryRow>(
      `SELECT
         memory_id,
         scope,
         content,
         created_at,
         updated_at,
         archived_at,
         metadata_json
       FROM memory_items
       WHERE memory_id = ?`
    );
    this.upsertStatement = db.prepare(
      `INSERT INTO memory_items (
         memory_id,
         scope,
         content,
         importance,
         created_at,
         updated_at,
         archived_at,
         metadata_json
       )
       VALUES (?, ?, ?, 5, ?, ?, ?, ?)
       ON CONFLICT(memory_id) DO UPDATE SET
         scope = excluded.scope,
         content = excluded.content,
         updated_at = excluded.updated_at,
         archived_at = excluded.archived_at,
         metadata_json = excluded.metadata_json`
    );
    this.archiveStatement = db.prepare(
      `UPDATE memory_items
         SET archived_at = ?, updated_at = ?
       WHERE memory_id = ? AND archived_at IS NULL`
    );
  }

  public list(options: MemoryListOptions = {}): Promise<MemoryItem[]> {
    return Promise.resolve().then(() => this.query(options));
  }

  public recall(options: MemoryListOptions = {}): Promise<MemoryItem[]> {
    return Promise.resolve().then(() => this.query(options));
  }

  public upsert(input: MemoryUpsertInput): Promise<MemoryItem> {
    return Promise.resolve().then(() => {
      const existing = input.memoryId === undefined ? undefined : this.getStatement.get(input.memoryId);
      const memoryId = input.memoryId ?? this.idFactory();
      const now = this.now();
      const createdAt = existing?.created_at ?? now;
      const metadata = createStoredMetadata(input);

      this.upsertStatement.run(
        memoryId,
        normalizeText(input.scope, 'scope'),
        normalizeText(input.body, 'body'),
        createdAt,
        now,
        null,
        stringifyJsonValue(metadata)
      );

      const row = this.getStatement.get(memoryId);
      if (row === undefined) {
        throw new LinnsyError(MEMORY_ERROR_CODES.ITEM_NOT_FOUND, `memory item ${memoryId} was not persisted`, false);
      }
      return toMemoryItem(row);
    });
  }

  public remove(memoryId: string): Promise<boolean> {
    return Promise.resolve().then(() => {
      const now = this.now();
      const result = this.archiveStatement.run(now, now, memoryId);
      return result.changes > 0;
    });
  }

  private query(options: MemoryListOptions): MemoryItem[] {
    const limit = clampLimit(options.limit);
    const params: unknown[] = [];
    const clauses = options.includeArchived === true ? [] : ['memory_items.archived_at IS NULL'];
    let joinClause = '';

    if (options.scope !== undefined && options.scope.trim().length > 0) {
      clauses.push('memory_items.scope = ?');
      params.push(options.scope.trim());
    }

    const textQuery = toTextQuery(options.query);
    if (textQuery?.kind === 'fts') {
      joinClause = 'JOIN memory_items_fts ON memory_items_fts.rowid = memory_items.rowid';
      clauses.push('memory_items_fts MATCH ?');
      params.push(textQuery.value);
    } else if (textQuery?.kind === 'like') {
      clauses.push(`(${textQuery.tokens.map(() => "memory_items.content LIKE ? ESCAPE '\\'").join(' OR ')})`);
      params.push(...textQuery.tokens.map((token) => `%${escapeLikeToken(token)}%`));
    }

    const whereClause = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    params.push(limit);

    const rows = this.db
      .prepare<unknown[], MemoryRow>(
        `SELECT
           memory_items.memory_id,
           memory_items.scope,
           memory_items.content,
           memory_items.created_at,
           memory_items.updated_at,
           memory_items.archived_at,
           memory_items.metadata_json
         FROM memory_items
         ${joinClause}
         ${whereClause}
         ORDER BY memory_items.updated_at DESC, memory_items.memory_id ASC
         LIMIT ?`
      )
      .all(...params);

    return rows.map(toMemoryItem);
  }
}

function createStoredMetadata(input: MemoryUpsertInput): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(input.metadata ?? {})
  };
  if (input.conversationId !== undefined) {
    metadata.conversationId = input.conversationId;
  }
  if (input.expiresAt !== undefined) {
    metadata.expiresAt = input.expiresAt;
  }
  return metadata;
}

function toMemoryItem(row: MemoryRow): MemoryItem {
  const metadata = parseJsonObject(row.metadata_json, 'memory metadata') ?? {};
  const item: MemoryItem = {
    memoryId: row.memory_id,
    scope: row.scope,
    body: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (row.archived_at !== null) {
    item.archivedAt = row.archived_at;
  }
  if (typeof metadata.conversationId === 'string') {
    item.conversationId = metadata.conversationId;
  }
  if (typeof metadata.expiresAt === 'number') {
    item.expiresAt = metadata.expiresAt;
  }
  const publicMetadata = omitKnownMetadata(metadata);
  if (Object.keys(publicMetadata).length > 0) {
    item.metadata = publicMetadata;
  }
  return item;
}

function omitKnownMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key !== 'title' && key !== 'conversationId' && key !== 'expiresAt') {
      result[key] = value;
    }
  }
  return result;
}

function normalizeText(value: string, label: 'body' | 'scope'): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new LinnsyError(MEMORY_ERROR_CODES.ITEM_INVALID, `memory ${label} must not be empty`, false);
  }
  return normalized;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 50;
  }
  return Math.max(1, Math.min(200, Math.round(value)));
}

type TextQuery =
  | { kind: 'fts'; value: string }
  | { kind: 'like'; tokens: string[] };

function toTextQuery(query: string | undefined): TextQuery | null {
  if (query === undefined || query.trim().length === 0) {
    return null;
  }
  const tokens = query
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap(expandSearchToken)
    .map((token) => token.replace(/"/g, '""'))
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  // SQLite unicode61 没有中文分词；中文查询用 LIKE，避免“记得但搜不到”。
  if (tokens.some(hasCjkCharacter)) {
    return { kind: 'like', tokens };
  }
  return { kind: 'fts', value: tokens.map((token) => `"${token}"`).join(' OR ') };
}

function hasCjkCharacter(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function expandSearchToken(token: string): string[] {
  if (!hasCjkCharacter(token) || token.length <= 2) {
    return [token];
  }
  const grams: string[] = [token];
  for (let index = 0; index < token.length - 1; index += 1) {
    grams.push(token.slice(index, index + 2));
  }
  return grams;
}

function escapeLikeToken(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}
