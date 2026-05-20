import type { ClockPort, LoggerPort } from '../../../../../shared/ports.js';
import type { CronJobStorePort } from '../../../persistence/cron-job-store-port.js';

import type { CronTickLockPort } from '../definitions/types.js';

export interface SweepExpiredOneShotCronJobsOptions {
  store: CronJobStorePort;
  lock: CronTickLockPort;
  clock: ClockPort;
  logger: LoggerPort;
  oneShotRetentionMs: number;
  sweeperBatchLimit: number;
}

export async function sweepExpiredOneShotCronJobs(options: SweepExpiredOneShotCronJobsOptions): Promise<void> {
  const lock = await options.lock.acquire();
  if (lock === null) {
    return;
  }
  try {
    const now = options.clock.now();
    const cutoff = now - options.oneShotRetentionMs;
    const candidates = await options.store.list({ enabled: false, limit: options.sweeperBatchLimit });
    for (const job of candidates) {
      if (job.schedule.kind !== 'one_shot') {
        // 周期型 cron 主人手动停用永留，sweeper 不参与。
        continue;
      }
      const recentRuns = await options.store.listRuns(job.jobId, 1);
      const lastFinishedAt = recentRuns[0]?.finishedAt;
      if (lastFinishedAt === undefined || lastFinishedAt > cutoff) {
        continue;
      }
      await options.store.remove(job.jobId);
      options.logger.info('cron sweeper removed expired one-shot job', {
        jobId: job.jobId,
        finishedAt: lastFinishedAt,
        retainedForMs: now - lastFinishedAt
      });
    }
  } finally {
    await lock.release();
  }
}
