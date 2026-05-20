export {
  CRON_MISS_GRACE_MAX_MS,
  CRON_MISS_GRACE_MIN_MS,
  DEFAULT_CRON_DEFINITION_KEY
} from '../../../definitions/cron.js';
export type {
  CronJobListFilter,
  CronJobPayload,
  CronJobRecord,
  CronRunRecord,
  CronRunStatus,
  CronSchedule
} from '../../../definitions/cron.js';

export interface CronTickLockHandle {
  release(): Promise<void>;
}

export interface CronTickLockPort {
  acquire(): Promise<CronTickLockHandle | null>;
}

export interface CronSchedulerPort {
  tick(): Promise<void>;
  /**
   * 2026-05-05 拍板新增：执行一次"一次性 cron 7 天清理"扫描。生产期间由
   * scheduler 内部按 24h 间隔自动调度；这里暴露入口便于测试与 daemon 启动
   * 期可选补扫。详见 docs/product/scenarios.md §3.3。
   */
  sweep(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
