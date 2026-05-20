import type Database from 'better-sqlite3';

import { parseJsonObject, stringifyJsonValue } from '../../../persistence/json.js';
import {
  CRON_MISS_GRACE_MAX_MS,
  CRON_MISS_GRACE_MIN_MS,
  type CronJobListFilter,
  type CronJobPayload,
  type CronJobRecord,
  type CronRunRecord,
  type CronRunStatus,
  type CronSchedule
} from '../definitions/cron.js';
import type { CronJobStorePort } from './cron-job-store-port.js';

interface CronJobRow {
  job_id: string;
  enabled: number;
  schedule_json: string;
  next_run_at: number;
  miss_grace_ms: number;
  payload_json: string;
  created_at: number;
  updated_at: number;
}

interface CronRunRow {
  cron_run_id: string;
  job_id: string;
  scheduled_at: number;
  started_at: number | null;
  finished_at: number | null;
  status: CronRunStatus;
  run_id: string | null;
  error_code: string | null;
}

type CronJobUpsertParams = [
  string,
  number,
  string,
  number,
  number,
  string,
  number,
  number
];

type CronRunUpsertParams = [
  string,
  string,
  number,
  number | null,
  number | null,
  CronRunStatus,
  string | null,
  string | null
];

export class SqliteCronJobStore implements CronJobStorePort {
  private readonly upsertStatement: Database.Statement<CronJobUpsertParams>;
  private readonly getStatement: Database.Statement<[string], CronJobRow>;
  private readonly setEnabledStatement: Database.Statement<[number, number, string]>;
  private readonly removeTransaction: (jobId: string) => boolean;
  private readonly recordRunStatement: Database.Statement<CronRunUpsertParams>;

  public constructor(private readonly db: Database.Database) {
    this.upsertStatement = db.prepare(
      `INSERT INTO cron_jobs (
         job_id,
         enabled,
         schedule_json,
         next_run_at,
         miss_grace_ms,
         payload_json,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(job_id) DO UPDATE SET
         enabled = excluded.enabled,
         schedule_json = excluded.schedule_json,
         next_run_at = excluded.next_run_at,
         miss_grace_ms = excluded.miss_grace_ms,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`
    );
    this.getStatement = db.prepare<[string], CronJobRow>(
      `SELECT
         job_id,
         enabled,
         schedule_json,
         next_run_at,
         miss_grace_ms,
         payload_json,
         created_at,
         updated_at
       FROM cron_jobs
       WHERE job_id = ?`
    );
    this.setEnabledStatement = db.prepare(
      `UPDATE cron_jobs
         SET enabled = ?, updated_at = ?
       WHERE job_id = ?`
    );
    this.removeTransaction = db.transaction((jobId: string) => {
      // schema 里 cron_runs 没有 ON DELETE CASCADE，真删提醒时必须先清理运行历史。
      db.prepare<[string]>(`DELETE FROM cron_runs WHERE job_id = ?`).run(jobId);
      const result = db.prepare<[string]>(`DELETE FROM cron_jobs WHERE job_id = ?`).run(jobId);
      return result.changes > 0;
    });
    this.recordRunStatement = db.prepare(
      `INSERT INTO cron_runs (
         cron_run_id,
         job_id,
         scheduled_at,
         started_at,
         finished_at,
         status,
         run_id,
         error_code
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cron_run_id) DO UPDATE SET
         job_id = excluded.job_id,
         scheduled_at = excluded.scheduled_at,
         started_at = excluded.started_at,
         finished_at = excluded.finished_at,
         status = excluded.status,
         run_id = excluded.run_id,
         error_code = excluded.error_code`
    );
  }

  public upsert(record: CronJobRecord): Promise<CronJobRecord> {
    this.upsertStatement.run(
      record.jobId,
      record.enabled ? 1 : 0,
      stringifyJsonValue(record.schedule),
      record.nextRunAt,
      clampMissGrace(record.missGraceMs),
      stringifyJsonValue(record.payload),
      record.createdAt,
      record.updatedAt
    );
    const stored = this.getStatement.get(record.jobId);
    if (stored === undefined) {
      throw new Error(`cron job ${record.jobId} was not persisted`);
    }
    return Promise.resolve(toCronJobRecord(stored));
  }

  public get(jobId: string): Promise<CronJobRecord | null> {
    const row = this.getStatement.get(jobId);
    return Promise.resolve(row === undefined ? null : toCronJobRecord(row));
  }

  public list(filter: CronJobListFilter = {}): Promise<CronJobRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.enabled !== undefined) {
      clauses.push('enabled = ?');
      params.push(filter.enabled ? 1 : 0);
    }
    params.push(filter.limit ?? 100);
    const whereClause = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const rows = this.db
      .prepare<unknown[], CronJobRow>(
        `SELECT
           job_id,
           enabled,
           schedule_json,
           next_run_at,
           miss_grace_ms,
           payload_json,
           created_at,
           updated_at
         FROM cron_jobs
         ${whereClause}
         ORDER BY updated_at DESC, job_id DESC
         LIMIT ?`
      )
      .all(...params);
    return Promise.resolve(rows.map(toCronJobRecord));
  }

  public listDue(now: number, limit: number): Promise<CronJobRecord[]> {
    const rows = this.db
      .prepare<[number, number], CronJobRow>(
        `SELECT
           job_id,
           enabled,
           schedule_json,
           next_run_at,
           miss_grace_ms,
           payload_json,
           created_at,
           updated_at
         FROM cron_jobs
         WHERE enabled = 1 AND next_run_at <= ?
         ORDER BY next_run_at ASC, job_id ASC
         LIMIT ?`
      )
      .all(now, limit);
    return Promise.resolve(rows.map(toCronJobRecord));
  }

  public setEnabled(jobId: string, enabled: boolean, updatedAt: number): Promise<boolean> {
    const result = this.setEnabledStatement.run(enabled ? 1 : 0, updatedAt, jobId);
    return Promise.resolve(result.changes > 0);
  }

  public remove(jobId: string): Promise<boolean> {
    return Promise.resolve(this.removeTransaction(jobId));
  }

  public recordRun(record: CronRunRecord): Promise<CronRunRecord> {
    this.recordRunStatement.run(
      record.cronRunId,
      record.jobId,
      record.scheduledAt,
      record.startedAt ?? null,
      record.finishedAt ?? null,
      record.status,
      record.runId ?? null,
      record.errorCode ?? null
    );
    const stored = this.db
      .prepare<[string], CronRunRow>(
        `SELECT
           cron_run_id,
           job_id,
           scheduled_at,
           started_at,
           finished_at,
           status,
           run_id,
           error_code
         FROM cron_runs
         WHERE cron_run_id = ?`
      )
      .get(record.cronRunId);
    if (stored === undefined) {
      throw new Error(`cron run ${record.cronRunId} was not persisted`);
    }
    return Promise.resolve(toCronRunRecord(stored));
  }

  public listRuns(jobId: string, limit: number): Promise<CronRunRecord[]> {
    const rows = this.db
      .prepare<[string, number], CronRunRow>(
        `SELECT
           cron_run_id,
           job_id,
           scheduled_at,
           started_at,
           finished_at,
           status,
           run_id,
           error_code
         FROM cron_runs
         WHERE job_id = ?
         ORDER BY scheduled_at DESC, cron_run_id DESC
         LIMIT ?`
      )
      .all(jobId, limit);
    return Promise.resolve(rows.map(toCronRunRecord));
  }
}

function clampMissGrace(value: number): number {
  if (value < CRON_MISS_GRACE_MIN_MS) {
    return CRON_MISS_GRACE_MIN_MS;
  }
  if (value > CRON_MISS_GRACE_MAX_MS) {
    return CRON_MISS_GRACE_MAX_MS;
  }
  return value;
}

function toCronJobRecord(row: CronJobRow): CronJobRecord {
  const schedule = toCronSchedule(parseJsonObject(row.schedule_json, 'cron schedule'));
  const payload = toCronJobPayload(parseJsonObject(row.payload_json, 'cron payload'));
  return {
    jobId: row.job_id,
    enabled: row.enabled === 1,
    schedule,
    nextRunAt: row.next_run_at,
    missGraceMs: row.miss_grace_ms,
    payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toCronRunRecord(row: CronRunRow): CronRunRecord {
  const record: CronRunRecord = {
    cronRunId: row.cron_run_id,
    jobId: row.job_id,
    scheduledAt: row.scheduled_at,
    status: row.status
  };
  assignIfNotNull(record, 'startedAt', row.started_at);
  assignIfNotNull(record, 'finishedAt', row.finished_at);
  assignIfNotNull(record, 'runId', row.run_id);
  assignIfNotNull(record, 'errorCode', row.error_code);
  return record;
}

function toCronSchedule(value: Record<string, unknown> | undefined): CronSchedule {
  if (value === undefined) {
    throw new Error('cron schedule is required');
  }
  if (value.kind === 'one_shot' && typeof value.atMs === 'number') {
    return { kind: 'one_shot', atMs: value.atMs };
  }
  if (value.kind === 'daily' && typeof value.time === 'string') {
    return { kind: 'daily', time: value.time };
  }
  if (
    value.kind === 'weekly' &&
    typeof value.dayOfWeek === 'number' &&
    typeof value.time === 'string'
  ) {
    return { kind: 'weekly', dayOfWeek: value.dayOfWeek, time: value.time };
  }
  if (value.kind === 'interval' && typeof value.intervalMs === 'number') {
    return { kind: 'interval', intervalMs: value.intervalMs };
  }
  throw new Error('cron schedule contains invalid shape');
}

function toCronJobPayload(value: Record<string, unknown> | undefined): CronJobPayload {
  if (value === undefined) {
    throw new Error('cron payload is required');
  }
  if (typeof value.definitionKey !== 'string' || typeof value.query !== 'string') {
    throw new Error('cron payload contains invalid shape');
  }

  const payload: CronJobPayload = {
    definitionKey: value.definitionKey,
    query: value.query
  };
  return payload;
}

function assignIfNotNull<K extends keyof CronRunRecord>(
  record: CronRunRecord,
  key: K,
  value: CronRunRecord[K] | null
): void {
  if (value !== null) {
    record[key] = value;
  }
}
