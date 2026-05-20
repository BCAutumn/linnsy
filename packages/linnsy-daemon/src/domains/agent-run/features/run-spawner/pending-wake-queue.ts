import type { LoggerPort } from '../../../../shared/ports.js';
import type { LinnsyNotificationLayer } from '../../../conversation/features/notification/types.js';
import type { TaskTerminalWakeEntry } from '../../../task/features/terminal-wake/definitions/types.js';

import {
  findActiveMainRun,
  waitForActiveRunSafePoint,
  type RunRecord,
  type RunRegistryStore
} from './active-run-safe-point.js';
import type { RunSpawnerEventPort, RunSpawnerPort } from './types.js';
import { spawnWakeAndNotify } from './wake-spawner.js';

export type PendingWakeQueue = Map<string, Map<string, TaskTerminalWakeEntry>>;

export function createPendingWakeQueue(): PendingWakeQueue {
  return new Map<string, Map<string, TaskTerminalWakeEntry>>();
}

export function enqueuePendingWake(
  pendingByConversation: PendingWakeQueue,
  input: TaskTerminalWakeEntry
): void {
  const pending = pendingByConversation.get(input.task.conversationId) ?? new Map<string, TaskTerminalWakeEntry>();
  pending.set(input.task.taskId, input);
  pendingByConversation.set(input.task.conversationId, pending);
}

export function watchActiveRun(input: {
  activeRun: RunRecord;
  conversationId: string;
  watchedActiveRunIds: Set<string>;
  pendingByConversation: PendingWakeQueue;
  spawner: Pick<RunSpawnerPort, 'spawnDetached' | 'waitForTerminal'>;
  runRegistry: Pick<RunRegistryStore, 'list'>;
  agentId: string;
  notification?: Pick<LinnsyNotificationLayer, 'replyForTaskRun'>;
  events?: Pick<RunSpawnerEventPort, 'subscribe'>;
  logger?: Pick<LoggerPort, 'error'>;
  activeRunReplyGraceMs: number;
}): void {
  if (input.watchedActiveRunIds.has(input.activeRun.runId)) {
    return;
  }
  input.watchedActiveRunIds.add(input.activeRun.runId);

  // 活跃主 run 还在生成回复时，任务终态不能直接丢掉。
  // 这里先守住当前 run 的“可补发”安全点，再统一排空该会话的终态唤醒队列。
  void waitForActiveRunSafePoint({
    runId: input.activeRun.runId,
    spawner: input.spawner,
    ...(input.events === undefined ? {} : { events: input.events }),
    activeRunReplyGraceMs: input.activeRunReplyGraceMs
  }).then(async () => {
    input.watchedActiveRunIds.delete(input.activeRun.runId);
    await drainConversation(input);
  }).catch((error: unknown) => {
    input.watchedActiveRunIds.delete(input.activeRun.runId);
    input.logger?.error('deferred task terminal wake failed', {
      runId: input.activeRun.runId,
      conversationId: input.conversationId,
      error: serializeError(error)
    });
  });
}

async function drainConversation(input: {
  conversationId: string;
  pendingByConversation: PendingWakeQueue;
  watchedActiveRunIds: Set<string>;
  spawner: Pick<RunSpawnerPort, 'spawnDetached' | 'waitForTerminal'>;
  runRegistry: Pick<RunRegistryStore, 'list'>;
  agentId: string;
  notification?: Pick<LinnsyNotificationLayer, 'replyForTaskRun'>;
  events?: Pick<RunSpawnerEventPort, 'subscribe'>;
  logger?: Pick<LoggerPort, 'error'>;
  activeRunReplyGraceMs: number;
}): Promise<void> {
  // 多个任务可能在同一轮主回复期间一起结束：合并成一个 wake run，
  // 避免给用户刷屏，同时保留每个任务的 terminal fence。
  const activeRun = await findActiveMainRun(input.runRegistry, input.conversationId);
  if (activeRun !== null) {
    watchActiveRun({ ...input, activeRun });
    return;
  }

  const pending = input.pendingByConversation.get(input.conversationId);
  if (pending === undefined) {
    return;
  }
  input.pendingByConversation.delete(input.conversationId);
  await spawnWakeAndNotify({
    entries: [...pending.values()],
    spawner: input.spawner,
    agentId: input.agentId,
    ...(input.notification === undefined ? {} : { notification: input.notification })
  });
}

function serializeError(error: unknown): { message: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: String(error) };
}
