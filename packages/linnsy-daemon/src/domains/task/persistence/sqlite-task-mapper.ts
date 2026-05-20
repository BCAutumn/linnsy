import { parseJsonObject, stringifyJsonValue } from '../../../persistence/json.js';
import type { TaskRecord } from '../definitions/task.js';
import { readTaskLocator } from '../features/lifecycle/functions/task-locator.js';
import type { TaskMutableUpdateParams, TaskRow, TaskUpdateParams } from './sqlite-task-row.js';

export function toTaskRecord(row: TaskRow): TaskRecord {
  const record: TaskRecord = {
    taskId: row.task_id,
    conversationId: row.conversation_id,
    kind: row.kind,
    attemptCount: row.attempt_count,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  assignIfNotNull(record, 'originRunId', row.parent_run_id);
  assignIfNotNull(record, 'parentTaskId', row.parent_task_id);
  assignIfNotNull(record, 'externalRef', row.external_ref);
  assignIfNotNull(record, 'externalKind', row.external_kind);
  const locator = parseJsonObject(row.locator_json, 'task locator');
  if (locator !== undefined) {
    record.locator = readTaskLocator(locator, 'task locator');
  }
  assignIfNotNull(record, 'dueAt', row.due_at);
  assignIfNotNull(record, 'lastNode', row.last_node);
  assignIfNotNull(record, 'reportedAt', row.reported_at);
  assignIfNotNull(record, 'workspacePath', row.workspace_path);
  assignIfNotNull(record, 'pausedAt', row.paused_at);
  assignIfNotNull(record, 'completedAt', row.completed_at);
  assignIfNotNull(record, 'cancelledAt', row.cancelled_at);
  assignIfNotNull(record, 'cancelReason', row.cancel_reason);

  const payload = parseJsonObject(row.payload_json, 'task payload');
  if (payload !== undefined) {
    record.payload = payload;
  }
  const result = parseJsonObject(row.result_json, 'task result');
  if (result !== undefined) {
    record.result = result;
  }
  const metadata = parseJsonObject(row.metadata_json, 'task metadata');
  if (metadata !== undefined) {
    record.metadata = metadata;
  }

  return record;
}

export function toTaskUpdateParams(record: TaskRecord): TaskUpdateParams {
  return [
    record.conversationId,
    record.originRunId ?? null,
    record.parentTaskId ?? null,
    record.kind,
    record.attemptCount,
    record.externalRef ?? null,
    record.externalKind ?? null,
    record.locator === undefined ? null : stringifyJsonValue(record.locator),
    record.status,
    record.title,
    record.dueAt ?? null,
    record.lastNode ?? null,
    record.reportedAt ?? null,
    record.payload === undefined ? null : stringifyJsonValue(record.payload),
    record.result === undefined ? null : stringifyJsonValue(record.result),
    record.workspacePath ?? null,
    record.createdAt,
    record.updatedAt,
    record.pausedAt ?? null,
    record.completedAt ?? null,
    record.cancelledAt ?? null,
    record.cancelReason ?? null,
    record.metadata === undefined ? null : stringifyJsonValue(record.metadata)
  ];
}

export function toTaskMutableUpdateParams(record: TaskRecord): TaskMutableUpdateParams {
  const [
    conversationId,
    originRunId,
    parentTaskId,
    kind,
    attemptCount,
    externalRef,
    externalKind,
    locator,
    status,
    title,
    dueAt,
    lastNode,
    reportedAt,
    payload,
    result,
    workspacePath,
    ,
    updatedAt,
    pausedAt,
    completedAt,
    cancelledAt,
    cancelReason,
    metadata
  ] = toTaskUpdateParams(record);
  return [
    conversationId,
    originRunId,
    parentTaskId,
    kind,
    attemptCount,
    externalRef,
    externalKind,
    locator,
    status,
    title,
    dueAt,
    lastNode,
    reportedAt,
    payload,
    result,
    workspacePath,
    updatedAt,
    pausedAt,
    completedAt,
    cancelledAt,
    cancelReason,
    metadata
  ];
}

function assignIfNotNull<K extends keyof TaskRecord>(
  record: TaskRecord,
  key: K,
  value: TaskRecord[K] | null
): void {
  if (value !== null) {
    record[key] = value;
  }
}
