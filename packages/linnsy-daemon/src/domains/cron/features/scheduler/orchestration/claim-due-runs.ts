import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import type { CronJobStorePort } from '../../../persistence/cron-job-store-port.js';

import type { CronJobRecord } from '../definitions/types.js';
import { computeNextCronRunAt } from '../functions/cron-time.js';

export interface ClaimedCronRun {
  job: CronJobRecord;
  cronRunId: string;
  scheduledAt: number;
  startedAt: number;
}

export interface ClaimDueCronRunsOptions {
  store: CronJobStorePort;
  dueLimit: number;
  cronRunIdFactory: () => string;
}

export async function claimDueCronRuns(options: ClaimDueCronRunsOptions, now: number): Promise<ClaimedCronRun[]> {
  const dueJobs = await options.store.listDue(now, options.dueLimit);
  const claims: ClaimedCronRun[] = [];
  for (const job of dueJobs) {
    const claim = await claimCronJob(options, job, now);
    if (claim !== null) {
      claims.push(claim);
    }
  }
  return claims;
}

function advanceCronJob(job: CronJobRecord, now: number): CronJobRecord {
  const nextRunAt = computeNextCronRunAt(job.schedule, job.nextRunAt, now);
  return {
    ...job,
    enabled: nextRunAt === null ? false : job.enabled,
    nextRunAt: nextRunAt ?? job.nextRunAt,
    updatedAt: now
  };
}

async function claimCronJob(
  options: ClaimDueCronRunsOptions,
  job: CronJobRecord,
  now: number
): Promise<ClaimedCronRun | null> {
  const scheduledAt = job.nextRunAt;
  const advanced = advanceCronJob(job, now);

  if (now - scheduledAt > job.missGraceMs) {
    await options.store.upsert(advanced);
    await options.store.recordRun({
      cronRunId: options.cronRunIdFactory(),
      jobId: job.jobId,
      scheduledAt,
      finishedAt: now,
      status: 'skipped_grace',
      errorCode: LINNSY_ERROR_CODES.CRON_SCHEDULE_INVALID
    });
    return null;
  }

  const cronRunId = options.cronRunIdFactory();
  await options.store.upsert(advanced);
  await options.store.recordRun({
    cronRunId,
    jobId: job.jobId,
    scheduledAt,
    startedAt: now,
    status: 'running'
  });
  return {
    job,
    cronRunId,
    scheduledAt,
    startedAt: now
  };
}
