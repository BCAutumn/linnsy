import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import type { ClockPort, LoggerPort } from '../../../../../shared/ports.js';
import type { MessageStorePort } from '../../../../../persistence/stores/message/message-store-port.js';
import type { CronJobStorePort } from '../../../persistence/cron-job-store-port.js';
import type { LinnsyNotificationLayer } from '../../../../conversation/features/notification/types.js';
import type { RunSpawnerPort, RunTerminalEvent } from '../../../../agent-run/features/run-spawner/types.js';
import { createLinnsySystemEventFence } from '../../../../agent-run/features/context-engineering/fences.js';
import type { TerminalBindingServicePort } from '../../../../desktop-integration/features/terminal-binding/terminal-binding-service.js';
import type { RuntimeEventHubPort } from '../../../../observability/features/event-hub/event-hub.js';

import type { CronJobRecord } from '../definitions/types.js';
import type { ClaimedCronRun } from './claim-due-runs.js';
import { errorCodeFrom, serializeError } from '../scheduler-errors.js';

export interface ExecuteClaimedCronRunOptions {
  store: CronJobStorePort;
  spawner: Pick<RunSpawnerPort, 'spawnDetached' | 'waitForTerminal'>;
  notification?: Pick<LinnsyNotificationLayer, 'replyForRun'>;
  messages?: Pick<MessageStorePort, 'findLatestInboundTarget'>;
  terminalBinding?: Pick<TerminalBindingServicePort, 'getBinding'>;
  clock: ClockPort;
  logger: LoggerPort;
  events?: RuntimeEventHubPort;
}

export async function executeClaimedCronRun(
  claim: ClaimedCronRun,
  options: ExecuteClaimedCronRunOptions
): Promise<void> {
  try {
    const conversationId = await resolveTargetConversationId(options);
    publishCronSystemEvent({ claim, conversationId, options });
    const spawn = await options.spawner.spawnDetached({
      definitionKey: claim.job.payload.definitionKey,
      conversationId,
      query: claim.job.payload.query,
      metadata: {
        cronJobId: claim.job.jobId,
        cronRunId: claim.cronRunId,
        scheduledAt: claim.scheduledAt
      },
      contextFences: [
        createLinnsySystemEventFence(claim.job.payload.query, {
          kind: 'cron-fire',
          jobId: claim.job.jobId,
          firedAt: claim.startedAt
        })
      ],
      wakeSource: 'system-event',
      ephemeral: { skipMemory: true, skipContextFiles: true },
      blocking: false
    });
    await options.store.recordRun({
      cronRunId: claim.cronRunId,
      jobId: claim.job.jobId,
      scheduledAt: claim.scheduledAt,
      startedAt: claim.startedAt,
      status: 'running',
      runId: spawn.runId
    });
    const terminal = await options.spawner.waitForTerminal(spawn.runId);
    await handleTerminalEvent({
      event: terminal,
      job: claim.job,
      conversationId,
      cronRunId: claim.cronRunId,
      jobId: claim.job.jobId,
      scheduledAt: claim.scheduledAt,
      startedAt: claim.startedAt,
      options
    });
  } catch (error: unknown) {
    options.logger.warn('cron scheduler failed to spawn run', {
      jobId: claim.job.jobId,
      scheduledAt: claim.scheduledAt,
      error: serializeError(error)
    });
    await options.store.recordRun({
      cronRunId: claim.cronRunId,
      jobId: claim.job.jobId,
      scheduledAt: claim.scheduledAt,
      startedAt: claim.startedAt,
      finishedAt: options.clock.now(),
      status: 'failed',
      errorCode: errorCodeFrom(error)
    });
  }
}

function publishCronSystemEvent(input: {
  claim: ClaimedCronRun;
  conversationId: string;
  options: ExecuteClaimedCronRunOptions;
}): void {
  if (input.options.events === undefined) {
    return;
  }

  try {
    input.options.events.publish({
      kind: 'system.event',
      conversationId: input.conversationId,
      createdAt: input.claim.startedAt,
      payload: {
        sourceKind: 'cron',
        detail: input.claim.job.payload.query,
        refId: input.claim.job.jobId,
        occurredAt: input.claim.startedAt
      }
    });
  } catch (error: unknown) {
    // system.event 是给主人看的观察事件；真正唤醒 Linnsy 的 run 不能被 UI/事件落库失败阻断。
    input.options.logger.warn('cron scheduler failed to publish system event; continuing run spawn', {
      jobId: input.claim.job.jobId,
      scheduledAt: input.claim.scheduledAt,
      error: serializeError(error)
    });
  }
}

async function resolveTargetConversationId(options: ExecuteClaimedCronRunOptions): Promise<string> {
  const binding = await options.terminalBinding?.getBinding();
  if (binding === undefined) {
    throw new Error('cron scheduler requires terminalBinding');
  }
  return binding.conversationId;
}

async function handleTerminalEvent(input: {
  event: RunTerminalEvent;
  job: CronJobRecord;
  conversationId: string;
  cronRunId: string;
  jobId: string;
  scheduledAt: number;
  startedAt: number;
  options: ExecuteClaimedCronRunOptions;
}): Promise<void> {
  if (input.event.type === 'completed') {
    await input.options.store.recordRun({
      cronRunId: input.cronRunId,
      jobId: input.jobId,
      scheduledAt: input.scheduledAt,
      startedAt: input.startedAt,
      finishedAt: input.options.clock.now(),
      status: 'completed',
      runId: input.event.runId
    });
    await notifyForCompletedRun(input);
    return;
  }
  await input.options.store.recordRun({
    cronRunId: input.cronRunId,
    jobId: input.jobId,
    scheduledAt: input.scheduledAt,
    startedAt: input.startedAt,
    finishedAt: input.options.clock.now(),
    status: 'failed',
    runId: input.event.runId,
    errorCode: input.event.outcome.error?.code ?? LINNSY_ERROR_CODES.RUN_EXECUTOR_FAILED
  });
}

async function notifyForCompletedRun(input: {
  event: RunTerminalEvent;
  job: CronJobRecord;
  conversationId: string;
  cronRunId: string;
  scheduledAt: number;
  startedAt: number;
  options: ExecuteClaimedCronRunOptions;
}): Promise<void> {
  const finalAnswer = input.event.outcome.finalAnswer;
  if (finalAnswer === undefined || finalAnswer.length === 0 || input.options.notification === undefined) {
    await maybeRetainCompletedOneShot(input.job, input.options);
    return;
  }

  const target = await input.options.messages?.findLatestInboundTarget(input.conversationId);
  if (target === undefined || target === null) {
    await input.options.store.recordRun({
      cronRunId: input.cronRunId,
      jobId: input.job.jobId,
      scheduledAt: input.scheduledAt,
      startedAt: input.startedAt,
      finishedAt: input.options.clock.now(),
      status: 'failed',
      runId: input.event.runId,
      errorCode: LINNSY_ERROR_CODES.NOTIFICATION_NO_TARGET
    });
    return;
  }

  try {
    await input.options.notification.replyForRun({
      runId: input.event.runId,
      conversationId: input.conversationId,
      target,
      payload: { text: finalAnswer }
    });
    await maybeRetainCompletedOneShot(input.job, input.options);
  } catch (error: unknown) {
    input.options.logger.warn('cron scheduler failed to notify completed run', {
      jobId: input.job.jobId,
      cronRunId: input.cronRunId,
      error: serializeError(error)
    });
    await input.options.store.recordRun({
      cronRunId: input.cronRunId,
      jobId: input.job.jobId,
      scheduledAt: input.scheduledAt,
      startedAt: input.startedAt,
      finishedAt: input.options.clock.now(),
      status: 'failed',
      runId: input.event.runId,
      errorCode: errorCodeFrom(error)
    });
  }
}

async function maybeRetainCompletedOneShot(
  job: CronJobRecord,
  options: ExecuteClaimedCronRunOptions
): Promise<void> {
  if (job.schedule.kind !== 'one_shot') {
    return;
  }
  // 2026-05-05 拍板：完成后不再立即真删，改为 enabled=false 保留进
  // "已完成（7 天后清理）"段，由 sweepExpiredOneShots 到期清理。
  await options.store.setEnabled(job.jobId, false, options.clock.now());
}
