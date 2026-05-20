import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { TaskListFilter, TaskRecord } from '../../../../task/definitions/task.js';
import type { TaskTrackerPort } from '../../../../task/ports/task-tracker-port.js';

export async function resolveTaskByInput(
  inputTaskId: string,
  conversationId: string | undefined,
  taskTracker: TaskTrackerPort
): Promise<{ task: TaskRecord; resolvedByPrefix: boolean }> {
  const exactTask = await taskTracker.get(inputTaskId);
  if (exactTask !== null) {
    return { task: exactTask, resolvedByPrefix: false };
  }

  const prefixMatches = await listPrefixMatches(inputTaskId, conversationId, taskTracker);
  if (prefixMatches.length === 1) {
    const matchedTask = prefixMatches[0];
    if (matchedTask === undefined) {
      throw new LinnsyError(LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED, 'task prefix lookup returned empty result', false);
    }
    return { task: matchedTask, resolvedByPrefix: true };
  }
  if (prefixMatches.length > 1) {
    const candidates = prefixMatches.slice(0, 5).map((item) => item.taskId).join(', ');
    throw new LinnsyError(
      LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED,
      `taskId 前缀匹配到多个任务（${inputTaskId}）：${candidates}，请使用完整 taskId`,
      false
    );
  }

  throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${inputTaskId} was not found`, false);
}

async function listPrefixMatches(
  taskIdPrefix: string,
  conversationId: string | undefined,
  taskTracker: TaskTrackerPort
): Promise<TaskRecord[]> {
  const filter: TaskListFilter = { limit: 500 };
  if (conversationId !== undefined) {
    filter.conversationId = conversationId;
  }
  const candidates = await taskTracker.list(filter);
  return candidates
    .filter((task) => task.taskId.startsWith(taskIdPrefix))
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }
      return right.taskId.localeCompare(left.taskId);
    });
}
