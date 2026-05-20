import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type Database from 'better-sqlite3';

import { isRecord, parseJsonObject, stringifyJsonValue } from '../../json.js';

type LinnkitMemoryRunRegistryStore = InstanceType<typeof runSupervisor.MemoryRunRegistryStore>;
type RunRecord = NonNullable<Awaited<ReturnType<LinnkitMemoryRunRegistryStore['load']>>>;
type ListRunsFilter = NonNullable<Parameters<LinnkitMemoryRunRegistryStore['list']>[0]>;
type RunRegistryStore = Pick<LinnkitMemoryRunRegistryStore, 'save' | 'load' | 'list' | 'delete'>;
type RunStatus = RunRecord['status'];

interface RunRow {
  run_id: string;
  conversation_id: string;
  parent_run_id: string | null;
  status: RunStatus;
  current_node: string | null;
  started_at: number;
  updated_at: number;
  iterations_used: number | null;
  iter_budget_max: number | null;
  iter_budget_refundable: number | null;
  error_code: string | null;
  error_message: string | null;
  error_recoverable: number | null;
  metadata_json: string | null;
}

export class SqliteRunRegistryStore implements RunRegistryStore {
  private readonly saveStatement: Database.Statement<[
    string,
    string,
    string | null,
    RunStatus,
    string | null,
    number,
    number,
    number | null,
    number | null,
    number | null,
    string | null,
    string | null,
    number | null,
    string | null
  ]>;
  private readonly loadStatement: Database.Statement<[string], RunRow>;
  private readonly deleteStatement: Database.Statement<[string]>;

  public constructor(private readonly db: Database.Database) {
    this.saveStatement = db.prepare(
      `INSERT INTO runs (
         run_id,
         conversation_id,
         parent_run_id,
         status,
         current_node,
         started_at,
         updated_at,
         iterations_used,
         iter_budget_max,
         iter_budget_refundable,
         error_code,
         error_message,
         error_recoverable,
         metadata_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         parent_run_id = excluded.parent_run_id,
         status = excluded.status,
         current_node = excluded.current_node,
         started_at = excluded.started_at,
         updated_at = excluded.updated_at,
         iterations_used = excluded.iterations_used,
         iter_budget_max = excluded.iter_budget_max,
         iter_budget_refundable = excluded.iter_budget_refundable,
         error_code = excluded.error_code,
         error_message = excluded.error_message,
         error_recoverable = excluded.error_recoverable,
         metadata_json = excluded.metadata_json`
    );
    this.loadStatement = db.prepare<[string], RunRow>(
      `SELECT
         run_id,
         conversation_id,
         parent_run_id,
         status,
         current_node,
         started_at,
         updated_at,
         iterations_used,
         iter_budget_max,
         iter_budget_refundable,
         error_code,
         error_message,
         error_recoverable,
         metadata_json
       FROM runs
       WHERE run_id = ?`
    );
    this.deleteStatement = db.prepare<[string]>('DELETE FROM runs WHERE run_id = ?');
  }

  public save(record: RunRecord): Promise<void> {
    this.saveStatement.run(
      record.runId,
      record.conversationId,
      record.parentRunId ?? null,
      record.status,
      record.currentNode ?? null,
      record.startedAt,
      record.updatedAt,
      record.iterationsUsed ?? null,
      record.iterationBudget?.max ?? null,
      record.iterationBudget === undefined ? null : booleanToSqlite(record.iterationBudget.refundable),
      record.errorIfAny?.errorCode ?? null,
      record.errorIfAny?.message ?? null,
      record.errorIfAny === undefined ? null : booleanToSqlite(record.errorIfAny.recoverable),
      record.metadata === undefined ? null : stringifyJsonValue(record.metadata)
    );
    return Promise.resolve();
  }

  public load(runId: string): Promise<RunRecord | null> {
    const row = this.loadStatement.get(runId);
    return Promise.resolve(row === undefined ? null : toRunRecord(row));
  }

  public list(filter: ListRunsFilter = {}): Promise<{ runs: RunRecord[]; nextCursor?: string }> {
    const limit = filter.limit ?? 100;
    const params: unknown[] = [];
    const clauses: string[] = [];

    appendStatusFilter(clauses, params, filter.status);

    if (filter.parentRunId !== undefined) {
      clauses.push('parent_run_id = ?');
      params.push(filter.parentRunId);
    }
    if (filter.startedAfter !== undefined) {
      clauses.push('started_at > ?');
      params.push(filter.startedAfter);
    }
    if (filter.startedBefore !== undefined) {
      clauses.push('started_at < ?');
      params.push(filter.startedBefore);
    }

    const cursorRow = filter.cursor === undefined ? undefined : this.loadStatement.get(filter.cursor);
    if (cursorRow !== undefined) {
      clauses.push('(updated_at < ? OR (updated_at = ? AND run_id < ?))');
      params.push(cursorRow.updated_at, cursorRow.updated_at, cursorRow.run_id);
    }

    params.push(limit + 1);

    const whereClause = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const rows = this.db
      .prepare<unknown[], RunRow>(
        `SELECT
           run_id,
           conversation_id,
           parent_run_id,
           status,
           current_node,
           started_at,
           updated_at,
           iterations_used,
           iter_budget_max,
           iter_budget_refundable,
           error_code,
           error_message,
           error_recoverable,
           metadata_json
         FROM runs
         ${whereClause}
         ORDER BY updated_at DESC, run_id DESC
         LIMIT ?`
      )
      .all(...params);

    const pageRows = rows.slice(0, limit);
    const overflow = rows[limit];
    const result: { runs: RunRecord[]; nextCursor?: string } = {
      runs: pageRows.map(toRunRecord)
    };

    if (overflow !== undefined) {
      const lastPageRow = pageRows.at(-1);
      if (lastPageRow !== undefined) {
        result.nextCursor = lastPageRow.run_id;
      }
    }

    return Promise.resolve(result);
  }

  public delete(runId: string): Promise<void> {
    this.deleteStatement.run(runId);
    return Promise.resolve();
  }
}

function appendStatusFilter(clauses: string[], params: unknown[], status: ListRunsFilter['status']): void {
  if (status === undefined) {
    return;
  }

  if (Array.isArray(status)) {
    if (status.length === 0) {
      clauses.push('1 = 0');
      return;
    }

    clauses.push(`status IN (${status.map(() => '?').join(', ')})`);
    params.push(...status);
    return;
  }

  clauses.push('status = ?');
  params.push(status);
}

function toRunRecord(row: RunRow): RunRecord {
  const record: RunRecord = {
    runId: row.run_id,
    conversationId: row.conversation_id,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at
  };

  if (row.parent_run_id !== null) {
    record.parentRunId = row.parent_run_id;
  }
  if (row.current_node !== null) {
    record.currentNode = row.current_node;
  }
  if (row.iterations_used !== null) {
    record.iterationsUsed = row.iterations_used;
  }
  if (row.iter_budget_max !== null && row.iter_budget_refundable !== null) {
    record.iterationBudget = {
      max: row.iter_budget_max,
      refundable: sqliteBoolean(row.iter_budget_refundable)
    };
  }
  if (row.error_code !== null && row.error_message !== null && row.error_recoverable !== null) {
    record.errorIfAny = {
      errorCode: row.error_code,
      message: row.error_message,
      recoverable: sqliteBoolean(row.error_recoverable)
    };
  }

  const metadata = parseJsonObject(row.metadata_json, 'run metadata');
  if (metadata !== undefined) {
    record.metadata = metadata;
  }

  return record;
}

function sqliteBoolean(value: number): boolean {
  return value !== 0;
}

function booleanToSqlite(value: boolean): number {
  return value ? 1 : 0;
}

export function isRunRecord(value: unknown): value is RunRecord {
  return isRecord(value)
    && typeof value.runId === 'string'
    && typeof value.conversationId === 'string'
    && typeof value.status === 'string'
    && typeof value.startedAt === 'number'
    && typeof value.updatedAt === 'number';
}
