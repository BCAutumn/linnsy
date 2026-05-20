import type {
  CheckpointListFilter,
  CheckpointMeta,
  CheckpointSummary,
  Checkpointer,
  EngineState
} from '@linnlabs/linnkit/runtime-kernel';
import type Database from 'better-sqlite3';

import type { ClockPort } from '../../../shared/ports.js';
import { systemClock } from '../../../shared/ports.js';
import { isRecord, parseJsonValue, stringifyJsonValue } from '../../json.js';

interface CheckpointRow {
  conversation_id: string;
  state_json: string;
  schema_version: number;
  updated_at: number;
}

export class SqliteCheckpointer implements Checkpointer {
  private readonly loadStatement: Database.Statement<[string], CheckpointRow>;
  private readonly saveStatement: Database.Statement<[string, string, number, number]>;
  private readonly clearStatement: Database.Statement<[string]>;

  public constructor(private readonly db: Database.Database, private readonly clock: ClockPort = systemClock) {
    this.loadStatement = db.prepare<[string], CheckpointRow>(
      'SELECT conversation_id, state_json, schema_version, updated_at FROM checkpoints WHERE conversation_id = ?'
    );
    this.saveStatement = db.prepare<[string, string, number, number]>(
      `INSERT INTO checkpoints (conversation_id, state_json, schema_version, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         state_json = excluded.state_json,
         schema_version = excluded.schema_version,
         updated_at = excluded.updated_at`
    );
    this.clearStatement = db.prepare<[string]>('DELETE FROM checkpoints WHERE conversation_id = ?');
  }

  public load(conversationId: string): Promise<EngineState | null> {
    const row = this.loadStatement.get(conversationId);
    if (row === undefined) {
      return Promise.resolve(null);
    }

    return Promise.resolve().then(() => readEngineState(row.state_json));
  }

  public save(conversationId: string, state: EngineState): Promise<void> {
    const savedAt = this.clock.now();
    const schemaVersion = state.schemaVersion ?? 1;
    this.saveStatement.run(conversationId, stringifyJsonValue(state), schemaVersion, savedAt);
    return Promise.resolve();
  }

  public clear(conversationId: string): Promise<void> {
    this.clearStatement.run(conversationId);
    return Promise.resolve();
  }

  public peekMeta(conversationId: string): Promise<CheckpointMeta | null> {
    const row = this.loadStatement.get(conversationId);
    return Promise.resolve(row === undefined ? null : toCheckpointMeta(row));
  }

  public list(filter: CheckpointListFilter = {}): Promise<CheckpointSummary[]> {
    const limit = filter.limit ?? 100;
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (filter.savedAfter !== undefined) {
      clauses.push('updated_at > ?');
      params.push(filter.savedAfter);
    }

    const cursorUpdatedAt = filter.cursor === undefined ? undefined : this.readCursorUpdatedAt(filter.cursor);
    if (cursorUpdatedAt !== undefined) {
      clauses.push('(updated_at < ? OR (updated_at = ? AND conversation_id < ?))');
      params.push(cursorUpdatedAt, cursorUpdatedAt, filter.cursor);
    }

    params.push(limit);

    const whereClause = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const rows = this.db
      .prepare<unknown[], CheckpointRow>(
        `SELECT conversation_id, state_json, schema_version, updated_at
         FROM checkpoints
         ${whereClause}
         ORDER BY updated_at DESC, conversation_id DESC
         LIMIT ?`
      )
      .all(...params);

    return Promise.resolve(rows.map(toCheckpointMeta));
  }

  private readCursorUpdatedAt(conversationId: string): number | undefined {
    return this.loadStatement.get(conversationId)?.updated_at;
  }
}

function readEngineState(rawState: string): EngineState {
  const parsed = parseJsonValue(rawState, 'checkpoint state');
  if (!isEngineState(parsed)) {
    throw new Error('checkpoint state must contain string nodeId');
  }

  return parsed;
}

function isEngineState(value: unknown): value is EngineState & Record<string, unknown> {
  return isRecord(value)
    && typeof value.nodeId === 'string'
    && (value.schemaVersion === undefined || typeof value.schemaVersion === 'number')
    && (value.local === undefined || isRecord(value.local));
}

function toCheckpointMeta(row: CheckpointRow): CheckpointMeta {
  const state = readEngineState(row.state_json);
  const meta: CheckpointMeta = {
    conversationId: row.conversation_id,
    schemaVersion: row.schema_version,
    savedAt: row.updated_at,
    currentNode: state.nodeId,
    hasPendingToolCalls: (state.local?.pendingToolCalls?.length ?? 0) > 0
  };

  if (state.local?.executorLocal?.stepCount !== undefined) {
    meta.iterations = state.local.executorLocal.stepCount;
  }

  return meta;
}
