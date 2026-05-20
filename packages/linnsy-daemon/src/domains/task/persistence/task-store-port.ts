import type { TaskListFilter, TaskRecord, TaskStatus } from '../definitions/task.js';

export interface TaskExpectedState {
  status: TaskStatus;
  updatedAt: number;
}

export interface TaskStorePort {
  upsert(record: TaskRecord): Promise<TaskRecord>;
  updateIfCurrent(record: TaskRecord, expected: TaskExpectedState): Promise<TaskRecord | null>;
  get(taskId: string): Promise<TaskRecord | null>;
  list(filter?: TaskListFilter): Promise<TaskRecord[]>;
  delete(taskId: string): Promise<boolean>;
}
