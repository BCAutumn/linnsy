import type { TaskRecord } from '../../../definitions/task.js';
import type { TaskTerminalWakeEntry } from '../definitions/types.js';

export function buildTaskTransitionWakeQuery(task: TaskRecord): string {
  return [
    `Task ${task.title} reached terminal status: ${task.status}.`,
    'If the latest assistant reply already clearly reported this exact task status, stay silent.',
    'Otherwise, report the update to the owner in concise natural Chinese.'
  ].join(' ');
}

export function buildTaskTransitionWakeQueryForEntries(entries: TaskTerminalWakeEntry[]): string {
  const firstEntry = entries[0];
  if (firstEntry === undefined) {
    return 'Task status changed.';
  }
  if (entries.length === 1) {
    return buildTaskTransitionWakeQuery(firstEntry.task);
  }
  const lines = entries.map((entry) => `- ${entry.task.title}: ${entry.task.status}`);
  return [
    `${entries.length.toString()} delegated tasks reached terminal status:`,
    ...lines,
    'If the latest assistant reply already clearly reported these exact task statuses, stay silent.',
    'Otherwise, report the updates to the owner in concise natural Chinese.'
  ].join('\n');
}

export function buildTaskTerminalWakeMetadata(entries: TaskTerminalWakeEntry[]): Record<string, unknown> {
  const firstEntry = entries[0];
  if (firstEntry !== undefined && entries.length === 1) {
    return {
      taskId: firstEntry.task.taskId,
      fromStatus: firstEntry.fromStatus,
      toStatus: firstEntry.task.status
    };
  }
  return {
    taskIds: entries.map((entry) => entry.task.taskId),
    taskCount: entries.length,
    statuses: entries.map((entry) => ({
      taskId: entry.task.taskId,
      fromStatus: entry.fromStatus,
      toStatus: entry.task.status
    }))
  };
}
