import type Database from 'better-sqlite3';

import type { TaskExpectedState, TaskStorePort } from './task-store-port.js';
import type { TaskListFilter, TaskRecord } from '../definitions/task.js';
import { toTaskMutableUpdateParams, toTaskRecord, toTaskUpdateParams } from './sqlite-task-mapper.js';
import type { TaskConditionalUpdateParams, TaskRow, TaskUpsertParams } from './sqlite-task-row.js';
import {
  buildTaskListQuery,
  DELETE_TASK_SQL,
  SELECT_TASK_BY_ID_SQL,
  UPDATE_TASK_IF_CURRENT_SQL,
  UPSERT_TASK_SQL
} from './sqlite-task-sql.js';

export class SqliteTaskStore implements TaskStorePort {
  private readonly upsertStatement: Database.Statement<TaskUpsertParams>;
  private readonly updateIfCurrentStatement: Database.Statement<TaskConditionalUpdateParams>;
  private readonly getStatement: Database.Statement<[string], TaskRow>;
  private readonly deleteStatement: Database.Statement<[string]>;

  public constructor(private readonly db: Database.Database) {
    this.upsertStatement = db.prepare(UPSERT_TASK_SQL);
    this.updateIfCurrentStatement = db.prepare(UPDATE_TASK_IF_CURRENT_SQL);
    this.getStatement = db.prepare<[string], TaskRow>(SELECT_TASK_BY_ID_SQL);
    this.deleteStatement = db.prepare<[string]>(DELETE_TASK_SQL);
  }

  public upsert(record: TaskRecord): Promise<TaskRecord> {
    this.upsertStatement.run(
      record.taskId,
      ...toTaskUpdateParams(record)
    );
    const stored = this.getStatement.get(record.taskId);
    if (stored === undefined) {
      throw new Error(`task ${record.taskId} was not persisted`);
    }
    return Promise.resolve(toTaskRecord(stored));
  }

  public updateIfCurrent(
    record: TaskRecord,
    expected: TaskExpectedState
  ): Promise<TaskRecord | null> {
    const result = this.updateIfCurrentStatement.run(
      ...toTaskMutableUpdateParams(record),
      record.taskId,
      expected.status,
      expected.updatedAt
    );
    if (result.changes === 0) {
      return Promise.resolve(null);
    }
    const stored = this.getStatement.get(record.taskId);
    if (stored === undefined) {
      throw new Error(`task ${record.taskId} was not persisted`);
    }
    return Promise.resolve(toTaskRecord(stored));
  }

  public get(taskId: string): Promise<TaskRecord | null> {
    const row = this.getStatement.get(taskId);
    return Promise.resolve(row === undefined ? null : toTaskRecord(row));
  }

  public delete(taskId: string): Promise<boolean> {
    const result = this.deleteStatement.run(taskId);
    return Promise.resolve(result.changes > 0);
  }

  public list(filter: TaskListFilter = {}): Promise<TaskRecord[]> {
    const query = buildTaskListQuery(filter);
    const rows = this.db
      .prepare<unknown[], TaskRow>(query.sql)
      .all(...query.params);
    return Promise.resolve(rows.map(toTaskRecord));
  }
}
