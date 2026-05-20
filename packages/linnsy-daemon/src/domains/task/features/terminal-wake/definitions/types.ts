import type { TaskRecord } from '../../../definitions/task.js';

export interface TaskTerminalWakeEntry {
  task: TaskRecord;
  fromStatus: TaskRecord['status'];
}
