import { formatTaskLocator } from '../../../../task/features/lifecycle/functions/task-locator.js';
import type { TaskRecord } from '../../../../task/definitions/task.js';

export function formatTaskSummaryLine(task: TaskRecord): string {
  const parts = [
    `taskId=${task.taskId}`,
    `status=${task.status}`
  ];
  if (task.externalKind !== undefined) {
    parts.push(`vendor=${task.externalKind}`);
  }
  parts.push(`位置=${formatTaskLocator(task.locator)}`);
  if (task.lastNode !== undefined) {
    parts.push(`节点=${task.lastNode}`);
  }
  if (task.externalRef !== undefined) {
    parts.push(`session=${task.externalRef}`);
  }
  const errorMessage = readStringField(task.result, 'errorMessage');
  if (errorMessage !== undefined) {
    parts.push(`error=${errorMessage}`);
  }
  if (readStringField(task.result, 'finalMessage') !== undefined) {
    parts.push('final=已记录');
  }
  return parts.join('；');
}

export function readStringField(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return undefined;
}
