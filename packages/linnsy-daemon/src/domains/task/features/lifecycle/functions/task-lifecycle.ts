import type {
  TaskRecord,
  TaskStatus,
  TaskTransitionPatch,
  TaskUpsertInput
} from '../../../definitions/task.js';

const allowedTransitions = new Set<string>([
  transitionKey('received', 'dispatched'),
  transitionKey('received', 'failed'),
  transitionKey('dispatched', 'in_progress'),
  transitionKey('dispatched', 'failed'),
  transitionKey('in_progress', 'completed'),
  transitionKey('in_progress', 'failed'),
  transitionKey('completed', 'in_progress'),
  transitionKey('completed', 'reported'),
  transitionKey('reported', 'archived'),
  transitionKey('dispatched', 'cancelled'),
  transitionKey('in_progress', 'cancelled'),
  transitionKey('paused', 'cancelled'),
  transitionKey('dispatched', 'paused'),
  transitionKey('in_progress', 'paused'),
  transitionKey('paused', 'in_progress'),
  transitionKey('failed', 'dispatched')
]);

const activeDeleteStatuses = new Set<TaskStatus>(['dispatched', 'in_progress', 'paused']);

export function isTaskTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  return allowedTransitions.has(transitionKey(from, to));
}

export function shouldWakeOnTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from !== to && (to === 'completed' || to === 'failed' || to === 'cancelled');
}

export function shouldCancelBeforeDelete(status: TaskStatus): boolean {
  return activeDeleteStatuses.has(status);
}

export function buildTaskUpsertRecord(
  input: TaskUpsertInput,
  existing: TaskRecord | null,
  now: number
): TaskRecord {
  const createdAt = input.createdAt ?? existing?.createdAt ?? now;
  const updatedAt = input.updatedAt ?? now;
  // upsert 是“新建或更新任务资料”入口：更新时先继承旧记录，
  // 再只覆盖调用方明确传入的字段，避免 payload/result/metadata 被静默清空。
  const record: TaskRecord = existing === null
    ? {
        taskId: input.taskId,
        conversationId: input.conversationId,
        title: input.title,
        status: input.status,
        kind: input.kind ?? 'external',
        attemptCount: input.attemptCount ?? 1,
        createdAt,
        updatedAt
      }
    : {
        ...existing,
        conversationId: input.conversationId,
        title: input.title,
        status: input.status,
        kind: input.kind ?? existing.kind,
        attemptCount: input.attemptCount ?? existing.attemptCount,
        createdAt,
        updatedAt
      };
  copyOptionalTaskFields(record, input);
  return record;
}

export function buildTaskTransitionRecord(
  existing: TaskRecord,
  to: TaskStatus,
  patch: TaskTransitionPatch,
  updatedAt: number
): TaskRecord {
  const normalizedPatch = withoutClearedFields(patch);
  const next: TaskRecord = {
    ...existing,
    ...normalizedPatch,
    taskId: existing.taskId,
    conversationId: existing.conversationId,
    status: to,
    updatedAt
  };
  if (patch.completedAt === null) {
    delete next.completedAt;
  }
  return next;
}

function transitionKey(from: TaskStatus, to: TaskStatus): string {
  return `${from}->${to}`;
}

function withoutClearedFields(patch: TaskTransitionPatch): Partial<TaskRecord> {
  const { completedAt, ...rest } = patch;
  const normalized: Partial<TaskRecord> = rest;
  if (completedAt !== undefined && completedAt !== null) {
    normalized.completedAt = completedAt;
  }
  return normalized;
}

function copyOptionalTaskFields(record: TaskRecord, input: Partial<TaskRecord>): void {
  if (input.originRunId !== undefined) record.originRunId = input.originRunId;
  if (input.parentTaskId !== undefined) record.parentTaskId = input.parentTaskId;
  if (input.externalRef !== undefined) record.externalRef = input.externalRef;
  if (input.externalKind !== undefined) record.externalKind = input.externalKind;
  if (input.locator !== undefined) record.locator = input.locator;
  if (input.dueAt !== undefined) record.dueAt = input.dueAt;
  if (input.lastNode !== undefined) record.lastNode = input.lastNode;
  if (input.reportedAt !== undefined) record.reportedAt = input.reportedAt;
  if (input.payload !== undefined) record.payload = input.payload;
  if (input.result !== undefined) record.result = input.result;
  if (input.metadata !== undefined) record.metadata = input.metadata;
  if (input.workspacePath !== undefined) record.workspacePath = input.workspacePath;
  if (input.pausedAt !== undefined) record.pausedAt = input.pausedAt;
  if (input.completedAt !== undefined) record.completedAt = input.completedAt;
  if (input.cancelledAt !== undefined) record.cancelledAt = input.cancelledAt;
  if (input.cancelReason !== undefined) record.cancelReason = input.cancelReason;
}
