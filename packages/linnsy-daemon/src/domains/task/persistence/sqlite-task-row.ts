import type { TaskKind, TaskRecord, TaskStatus } from '../../../domains/task/definitions/task.js';

export interface TaskRow {
  task_id: string;
  conversation_id: string;
  parent_run_id: string | null;
  parent_task_id: string | null;
  kind: TaskKind;
  attempt_count: number;
  external_ref: string | null;
  external_kind: TaskRecord['externalKind'] | null;
  locator_json: string | null;
  status: TaskStatus;
  title: string;
  due_at: number | null;
  last_node: string | null;
  reported_at: number | null;
  payload_json: string | null;
  result_json: string | null;
  workspace_path: string | null;
  created_at: number;
  updated_at: number;
  paused_at: number | null;
  completed_at: number | null;
  cancelled_at: number | null;
  cancel_reason: string | null;
  metadata_json: string | null;
}

export type TaskUpsertParams = [
  string,
  string,
  string | null,
  string | null,
  TaskKind,
  number,
  string | null,
  TaskRecord['externalKind'] | null,
  string | null,
  TaskStatus,
  string,
  number | null,
  string | null,
  number | null,
  string | null,
  string | null,
  string | null,
  number,
  number,
  number | null,
  number | null,
  number | null,
  string | null,
  string | null
];

export type TaskUpdateParams = [
  string,
  string | null,
  string | null,
  TaskKind,
  number,
  string | null,
  TaskRecord['externalKind'] | null,
  string | null,
  TaskStatus,
  string,
  number | null,
  string | null,
  number | null,
  string | null,
  string | null,
  string | null,
  number,
  number,
  number | null,
  number | null,
  number | null,
  string | null,
  string | null
];

export type TaskMutableUpdateParams = [
  string,
  string | null,
  string | null,
  TaskKind,
  number,
  string | null,
  TaskRecord['externalKind'] | null,
  string | null,
  TaskStatus,
  string,
  number | null,
  string | null,
  number | null,
  string | null,
  string | null,
  string | null,
  number,
  number | null,
  number | null,
  number | null,
  string | null,
  string | null
];

export type TaskConditionalUpdateParams = [
  ...TaskMutableUpdateParams,
  string,
  TaskStatus,
  number
];
