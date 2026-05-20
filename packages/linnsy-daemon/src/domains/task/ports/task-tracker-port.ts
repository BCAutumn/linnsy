import type {
  ExternalUpdate,
  TaskListFilter,
  TaskRecord,
  TaskStatus,
  TaskTransitionPatch,
  TaskUpsertInput
} from '../definitions/task.js';

export interface TaskWakeHookInput {
  task: TaskRecord;
  fromStatus: TaskStatus;
}

export interface TaskWakeHook {
  (input: TaskWakeHookInput): Promise<void> | void;
}

export interface TaskTrackerPort {
  upsert(record: TaskUpsertInput): Promise<TaskRecord>;
  transition(taskId: string, to: TaskStatus, patch?: TaskTransitionPatch): Promise<TaskRecord>;
  delete(taskId: string, options?: { reason?: string }): Promise<boolean>;
  get(taskId: string): Promise<TaskRecord | null>;
  list(filter?: TaskListFilter): Promise<TaskRecord[]>;
  onExternalUpdate(taskId: string, update: ExternalUpdate): Promise<'should_notify' | 'silent'>;
}
