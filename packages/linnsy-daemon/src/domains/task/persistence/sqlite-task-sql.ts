import type { TaskListFilter } from '../../../domains/task/definitions/task.js';

const TASK_COLUMNS = `task_id,
         conversation_id,
         parent_run_id,
         parent_task_id,
         kind,
         attempt_count,
         external_ref,
         external_kind,
         locator_json,
         status,
         title,
         due_at,
         last_node,
         reported_at,
         payload_json,
         result_json,
         workspace_path,
         created_at,
         updated_at,
         paused_at,
         completed_at,
         cancelled_at,
         cancel_reason,
         metadata_json`;

// created_at 只属于插入路径，冲突更新故意不覆盖它，避免迟到快照篡改任务历史。
export const UPSERT_TASK_SQL = `INSERT INTO tasks (
         ${TASK_COLUMNS}
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         parent_run_id = COALESCE(excluded.parent_run_id, tasks.parent_run_id),
         parent_task_id = COALESCE(excluded.parent_task_id, tasks.parent_task_id),
         kind = excluded.kind,
         attempt_count = excluded.attempt_count,
         external_ref = COALESCE(excluded.external_ref, tasks.external_ref),
         external_kind = COALESCE(excluded.external_kind, tasks.external_kind),
         locator_json = COALESCE(excluded.locator_json, tasks.locator_json),
         status = excluded.status,
         title = excluded.title,
         due_at = COALESCE(excluded.due_at, tasks.due_at),
         last_node = COALESCE(excluded.last_node, tasks.last_node),
         reported_at = COALESCE(excluded.reported_at, tasks.reported_at),
         payload_json = COALESCE(excluded.payload_json, tasks.payload_json),
         result_json = COALESCE(excluded.result_json, tasks.result_json),
         workspace_path = COALESCE(excluded.workspace_path, tasks.workspace_path),
         updated_at = excluded.updated_at,
         paused_at = COALESCE(excluded.paused_at, tasks.paused_at),
         completed_at = COALESCE(excluded.completed_at, tasks.completed_at),
         cancelled_at = COALESCE(excluded.cancelled_at, tasks.cancelled_at),
         cancel_reason = COALESCE(excluded.cancel_reason, tasks.cancel_reason),
         metadata_json = COALESCE(excluded.metadata_json, tasks.metadata_json)`;

export const UPDATE_TASK_IF_CURRENT_SQL = `UPDATE tasks
         SET conversation_id = ?,
             parent_run_id = ?,
             parent_task_id = ?,
             kind = ?,
             attempt_count = ?,
             external_ref = ?,
             external_kind = ?,
             locator_json = ?,
             status = ?,
             title = ?,
             due_at = ?,
             last_node = ?,
             reported_at = ?,
             payload_json = ?,
             result_json = ?,
             workspace_path = ?,
             updated_at = ?,
             paused_at = ?,
             completed_at = ?,
             cancelled_at = ?,
             cancel_reason = ?,
             metadata_json = ?
       WHERE task_id = ? AND status = ? AND updated_at = ?`;

export const SELECT_TASK_BY_ID_SQL = `SELECT
         ${TASK_COLUMNS}
       FROM tasks
       WHERE task_id = ?`;

export const DELETE_TASK_SQL = `DELETE FROM tasks WHERE task_id = ?`;

export interface TaskListQuery {
  sql: string;
  params: unknown[];
}

export function buildTaskListQuery(filter: TaskListFilter): TaskListQuery {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.conversationId !== undefined) {
    clauses.push('conversation_id = ?');
    params.push(filter.conversationId);
  }
  if (filter.status !== undefined) {
    if (filter.status.length === 0) {
      clauses.push('1 = 0');
    } else {
      clauses.push(`status IN (${filter.status.map(() => '?').join(', ')})`);
      params.push(...filter.status);
    }
  }
  if (filter.kind !== undefined) {
    clauses.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.parentTaskId !== undefined) {
    clauses.push('parent_task_id = ?');
    params.push(filter.parentTaskId);
  }
  if (filter.sinceUpdatedAt !== undefined) {
    clauses.push('updated_at >= ?');
    params.push(filter.sinceUpdatedAt);
  }

  params.push(filter.limit ?? 100);
  const whereClause = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
  return {
    sql: `SELECT
           ${TASK_COLUMNS}
         FROM tasks
         ${whereClause}
         ORDER BY updated_at DESC, task_id DESC
         LIMIT ?`,
    params
  };
}
