import { randomUUID } from 'node:crypto';

import type { ClockPort, LoggerPort } from '../../../../shared/ports.js';
import { consoleLogger, systemClock } from '../../../../shared/ports.js';
import type { MessageStorePort } from '../../../../persistence/stores/message/message-store-port.js';
import type { CronJobStorePort } from '../../persistence/cron-job-store-port.js';
import type { LinnsyNotificationLayer } from '../../../conversation/features/notification/types.js';
import type { RunSpawnerPort } from '../../../agent-run/features/run-spawner/types.js';
import type { TerminalBindingServicePort } from '../../../desktop-integration/features/terminal-binding/terminal-binding-service.js';
import type { RuntimeEventHubPort } from '../../../observability/features/event-hub/event-hub.js';

import type { CronSchedulerPort, CronTickLockPort } from './definitions/types.js';
import { claimDueCronRuns } from './orchestration/claim-due-runs.js';
import type { ClaimedCronRun } from './orchestration/claim-due-runs.js';
import { executeClaimedCronRun } from './orchestration/execute-claimed-run.js';
import { sweepExpiredOneShotCronJobs } from './orchestration/one-shot-sweeper.js';
import { serializeError } from './scheduler-errors.js';

export interface CreateCronSchedulerOptions {
  store: CronJobStorePort;
  spawner: Pick<RunSpawnerPort, 'spawnDetached' | 'waitForTerminal'>;
  notification?: Pick<LinnsyNotificationLayer, 'replyForRun'>;
  messages?: Pick<MessageStorePort, 'findLatestInboundTarget'>;
  terminalBinding?: Pick<TerminalBindingServicePort, 'getBinding'>;
  lock: CronTickLockPort;
  tickIntervalMs?: number;
  dueLimit?: number;
  /**
   * 2026-05-05 拍板新增：一次性 cron 完成后保留 7 天供前端"已完成"段展示，
   * 之后由独立 sweeper tick 永久删除。配置项可被测试覆盖。详见
   * docs/product/scenarios.md §3.3。
   */
  oneShotRetentionMs?: number;
  sweeperIntervalMs?: number;
  sweeperBatchLimit?: number;
  clock?: ClockPort;
  logger?: LoggerPort;
  cronRunIdFactory?: () => string;
  // 注入后，cron 触发时同步 publish system.event(sourceKind='cron')。
  // 与 createLinnsySystemEventFence 注入到 LLM 的内容是同一份事实——给前端再发一遍。
  events?: RuntimeEventHubPort;
}

const DEFAULT_ONE_SHOT_RETENTION_MS = 7 * 24 * 3_600_000;
const DEFAULT_SWEEPER_INTERVAL_MS = 24 * 3_600_000;
const DEFAULT_SWEEPER_BATCH_LIMIT = 100;

export function createCronScheduler(options: CreateCronSchedulerOptions): CronSchedulerPort {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? consoleLogger;
  const tickIntervalMs = options.tickIntervalMs ?? 60_000;
  const dueLimit = options.dueLimit ?? 50;
  const oneShotRetentionMs = options.oneShotRetentionMs ?? DEFAULT_ONE_SHOT_RETENTION_MS;
  const sweeperIntervalMs = options.sweeperIntervalMs ?? DEFAULT_SWEEPER_INTERVAL_MS;
  const sweeperBatchLimit = options.sweeperBatchLimit ?? DEFAULT_SWEEPER_BATCH_LIMIT;
  const cronRunIdFactory = options.cronRunIdFactory ?? defaultCronRunIdFactory;
  let timer: NodeJS.Timeout | undefined;
  let sweeperTimer: NodeJS.Timeout | undefined;
  let stopped = true;

  async function tick(): Promise<void> {
    let claims: ClaimedCronRun[] = [];
    const lock = await options.lock.acquire();
    if (lock === null) {
      return;
    }

    try {
      claims = await claimDueCronRuns({ store: options.store, dueLimit, cronRunIdFactory }, clock.now());
    } finally {
      await lock.release();
    }

    for (const claim of claims) {
      await executeClaimedCronRun(claim, {
        store: options.store,
        spawner: options.spawner,
        clock,
        logger,
        ...(options.notification === undefined ? {} : { notification: options.notification }),
        ...(options.messages === undefined ? {} : { messages: options.messages }),
        ...(options.terminalBinding === undefined ? {} : { terminalBinding: options.terminalBinding }),
        ...(options.events === undefined ? {} : { events: options.events })
      });
    }
  }

  async function sweep(): Promise<void> {
    await sweepExpiredOneShotCronJobs({
      store: options.store,
      lock: options.lock,
      clock,
      logger,
      oneShotRetentionMs,
      sweeperBatchLimit
    });
  }

  function scheduleNextTick(): void {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      tick()
        .catch((error: unknown) => {
          logger.warn('cron scheduler tick failed', { error: serializeError(error) });
        })
        .finally(scheduleNextTick);
    }, tickIntervalMs);
  }

  function scheduleNextSweeperTick(): void {
    if (stopped) {
      return;
    }
    sweeperTimer = setTimeout(() => {
      sweep()
        .catch((error: unknown) => {
          logger.warn('cron sweeper tick failed', { error: serializeError(error) });
        })
        .finally(scheduleNextSweeperTick);
    }, sweeperIntervalMs);
  }

  return {
    async tick(): Promise<void> {
      await tick();
    },

    /**
     * 暴露 sweeper tick 入口便于测试与 daemon 启动期补扫；生产由 start()
     * 自动按 sweeperIntervalMs 调度。
     */
    async sweep(): Promise<void> {
      await sweep();
    },

    start(): Promise<void> {
      if (!stopped) {
        return Promise.resolve();
      }
      stopped = false;
      scheduleNextTick();
      scheduleNextSweeperTick();
      return Promise.resolve();
    },

    stop(): Promise<void> {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (sweeperTimer !== undefined) {
        clearTimeout(sweeperTimer);
        sweeperTimer = undefined;
      }
      return Promise.resolve();
    }
  };
}

function defaultCronRunIdFactory(): string {
  return `cron_run_${randomUUID()}`;
}
