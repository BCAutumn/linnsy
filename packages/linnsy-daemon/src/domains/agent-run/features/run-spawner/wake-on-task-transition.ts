import type { LoggerPort } from '../../../../shared/ports.js';
import type { LinnsyNotificationLayer } from '../../../conversation/features/notification/types.js';
import { LINNSY_MAIN_AGENT_ID } from '../agents/index.js';
import type { TaskWakeHook } from '../../../task/ports/task-tracker-port.js';
import { buildTaskExecutionNoticePayload } from '../../../task/features/terminal-wake/functions/task-execution-notice.js';

import { findActiveMainRun, type RunRegistryStore } from './active-run-safe-point.js';
import {
  createPendingWakeQueue,
  enqueuePendingWake,
  watchActiveRun
} from './pending-wake-queue.js';
import type { RunSpawnerEventPort, RunSpawnerPort } from './types.js';
import { spawnWakeAndNotify } from './wake-spawner.js';

export interface CreateWakeOnTaskTransitionOptions {
  spawner: Pick<RunSpawnerPort, 'spawnDetached' | 'waitForTerminal'>;
  runRegistry: Pick<RunRegistryStore, 'list'>;
  notification?: Pick<LinnsyNotificationLayer, 'replyForTaskRun'>;
  events?: RunSpawnerEventPort;
  logger?: Pick<LoggerPort, 'error'>;
  agentId?: string;
  activeRunReplyGraceMs?: number;
}

const DEFAULT_ACTIVE_RUN_REPLY_GRACE_MS = 250;

export function createWakeOnTaskTransition(options: CreateWakeOnTaskTransitionOptions): TaskWakeHook {
  const agentId = options.agentId ?? LINNSY_MAIN_AGENT_ID;
  const activeRunReplyGraceMs = options.activeRunReplyGraceMs ?? DEFAULT_ACTIVE_RUN_REPLY_GRACE_MS;
  const pendingByConversation = createPendingWakeQueue();
  const watchedActiveRunIds = new Set<string>();

  return async ({ task, fromStatus }) => {
    const executionNoticePayload = buildTaskExecutionNoticePayload(task);
    if (options.events !== undefined && executionNoticePayload !== null) {
      options.events.publish({
        kind: 'system.event',
        conversationId: task.conversationId,
        payload: executionNoticePayload
      });
    }
    const activeRun = await findActiveMainRun(options.runRegistry, task.conversationId);
    if (activeRun !== null) {
      enqueuePendingWake(pendingByConversation, { task, fromStatus });
      watchActiveRun({
        activeRun,
        conversationId: task.conversationId,
        watchedActiveRunIds,
        pendingByConversation,
        spawner: options.spawner,
        runRegistry: options.runRegistry,
        agentId,
        activeRunReplyGraceMs,
        ...(options.notification === undefined ? {} : { notification: options.notification }),
        ...(options.events === undefined ? {} : { events: options.events }),
        ...(options.logger === undefined ? {} : { logger: options.logger })
      });
      return;
    }

    void spawnWakeAndNotify({
      entries: [{ task, fromStatus }],
      spawner: options.spawner,
      agentId,
      ...(options.notification === undefined ? {} : { notification: options.notification })
    }).catch((error: unknown) => {
      options.logger?.error('task terminal wake delivery failed', {
        taskId: task.taskId,
        error: serializeError(error)
      });
    });
  };
}

function serializeError(error: unknown): { message: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}
