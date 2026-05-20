import type { ClockPort, LoggerPort } from '../../../../shared/ports.js';
import { systemClock } from '../../../../shared/ports.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { TaskStorePort } from '../../persistence/task-store-port.js';
import {
  buildTaskTransitionRecord,
  buildTaskUpsertRecord,
  isTaskTransitionAllowed,
  shouldCancelBeforeDelete,
  shouldWakeOnTransition
} from '../lifecycle/functions/task-lifecycle.js';
import {
  buildExternalProgressUpdateRecord,
  buildPausedExternalUpdateRecord
} from '../lifecycle/functions/task-external-update.js';

import type {
  ExternalUpdate,
  TaskListFilter,
  TaskRecord,
  TaskStatus,
  TaskWakeHook,
  TaskTrackerPort,
  TaskTransitionPatch,
  TaskUpsertInput
} from './definitions/types.js';

export interface CreateTaskTrackerOptions {
  tasks: TaskStorePort;
  clock?: ClockPort;
  // 任务终态唤醒主对话是 TaskTracker 的状态机副作用，但真正 spawn 由 run-spawner 层负责。
  // 这里也用 getter，daemon 创建 spawner 后再挂回 hook，避免 foundation 初始化顺序互相卡住。
  wakeMainOnTransition?: () => TaskWakeHook | undefined;
  logger?: Pick<LoggerPort, 'error'> & Partial<Pick<LoggerPort, 'warn'>>;
}

export { shouldWakeOnTransition } from '../lifecycle/functions/task-lifecycle.js';

const EXTERNAL_UPDATE_MAX_ATTEMPTS = 3;

export function createTaskTracker(options: CreateTaskTrackerOptions): TaskTrackerPort {
  const clock = options.clock ?? systemClock;

  return {
    async upsert(input: TaskUpsertInput): Promise<TaskRecord> {
      const now = clock.now();
      const existing = await options.tasks.get(input.taskId);
      const record = buildTaskUpsertRecord(input, existing, now);
      return options.tasks.upsert(record);
    },

    async transition(taskId: string, to: TaskStatus, patch: TaskTransitionPatch = {}): Promise<TaskRecord> {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const existing = await options.tasks.get(taskId);
        if (existing === null) {
          throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${taskId} was not found`, false);
        }
        if (existing.status === to) {
          return existing;
        }
        if (!isTaskTransitionAllowed(existing.status, to)) {
          throw new LinnsyError(
            LINNSY_ERROR_CODES.TASK_TRANSITION_INVALID,
            `invalid task transition ${existing.status} -> ${to}`,
            false
          );
        }

        const next = buildTaskTransitionRecord(existing, to, patch, patch.updatedAt ?? clock.now());
        const saved = await options.tasks.updateIfCurrent(next, {
          status: existing.status,
          updatedAt: existing.updatedAt
        });
        if (saved !== null) {
          await wakeMainOnTerminalTransition(options, existing.status, saved);
          return saved;
        }
      }
      throw new LinnsyError(
        LINNSY_ERROR_CODES.TASK_TRANSITION_INVALID,
        `task ${taskId} changed while transitioning to ${to}`,
        false
      );
    },

    async delete(taskId: string, deleteOptions: { reason?: string } = {}): Promise<boolean> {
      const existing = await options.tasks.get(taskId);
      if (existing === null) {
        throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${taskId} was not found`, false);
      }

      if (shouldCancelBeforeDelete(existing.status)) {
        await this.transition(taskId, 'cancelled', {
          cancelReason: deleteOptions.reason ?? 'user_deleted',
          cancelledAt: clock.now(),
          updatedAt: clock.now()
        });
      }

      return options.tasks.delete(taskId);
    },

    get(taskId: string): Promise<TaskRecord | null> {
      return options.tasks.get(taskId);
    },

    list(filter: TaskListFilter = {}): Promise<TaskRecord[]> {
      return options.tasks.list(filter);
    },

    async onExternalUpdate(taskId: string, update: ExternalUpdate): Promise<'should_notify' | 'silent'> {
      for (let attempt = 0; attempt < EXTERNAL_UPDATE_MAX_ATTEMPTS; attempt += 1) {
        const task = await options.tasks.get(taskId);
        if (task === null) {
          throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${taskId} was not found`, false);
        }
        if (task.status === 'cancelled') {
          return 'silent';
        }
        if (task.status !== 'paused') {
          if (update.errorMessage !== undefined) {
            await this.transition(taskId, 'failed', withOptionalLastNode({
              result: { errorMessage: update.errorMessage },
              updatedAt: clock.now()
            }, update.node));
            return 'should_notify';
          }
          if (update.finalResult !== undefined) {
            await this.transition(taskId, 'completed', withOptionalLastNode({
              result: update.finalResult,
              completedAt: clock.now(),
              updatedAt: clock.now()
            }, update.node));
            return 'should_notify';
          }
          if (task.status !== 'dispatched' && task.status !== 'in_progress') {
            return update.meta?.notify === true ? 'should_notify' : 'silent';
          }
        }

        const next = task.status === 'paused'
          ? buildPausedExternalUpdateRecord(task, update, clock.now())
          : buildExternalProgressUpdateRecord(task, update, clock.now());
        const saved = await options.tasks.updateIfCurrent(next, {
          status: task.status,
          updatedAt: task.updatedAt
        });
        if (saved !== null) {
          return task.status === 'paused'
            ? 'silent'
            : update.meta?.notify === true ? 'should_notify' : 'silent';
        }
        options.logger?.warn?.('task external update conflicted; retrying with latest task record', {
          taskId,
          attempt: attempt + 1,
          status: task.status,
          updatedAt: task.updatedAt,
          node: update.node
        });
      }

      throw new LinnsyError(
        LINNSY_ERROR_CODES.TASK_TRANSITION_INVALID,
        `task ${taskId} changed while applying external update`,
        false
      );
    }
  };
}

async function wakeMainOnTerminalTransition(
  options: CreateTaskTrackerOptions,
  fromStatus: TaskStatus,
  task: TaskRecord
): Promise<void> {
  if (!shouldWakeOnTransition(fromStatus, task.status)) {
    return;
  }
  const hook = options.wakeMainOnTransition?.();
  if (hook === undefined) {
    return;
  }
  try {
    await hook({ task, fromStatus });
  } catch (error: unknown) {
    options.logger?.error('task terminal wake hook failed', {
      taskId: task.taskId,
      fromStatus,
      toStatus: task.status,
      error: serializeWakeHookError(error)
    });
  }
}

function withOptionalLastNode<T extends Partial<TaskRecord>>(patch: T, node: string | undefined): T {
  if (node !== undefined) {
    patch.lastNode = node;
  }
  return patch;
}

function serializeWakeHookError(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }
  return { message: String(error) };
}
