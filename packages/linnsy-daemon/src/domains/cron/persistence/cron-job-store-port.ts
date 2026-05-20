import type {
  CronJobListFilter,
  CronJobRecord,
  CronRunRecord
} from '../definitions/cron.js';

export interface CronJobStorePort {
  upsert(record: CronJobRecord): Promise<CronJobRecord>;
  get(jobId: string): Promise<CronJobRecord | null>;
  list(filter?: CronJobListFilter): Promise<CronJobRecord[]>;
  listDue(now: number, limit: number): Promise<CronJobRecord[]>;
  setEnabled(jobId: string, enabled: boolean, updatedAt: number): Promise<boolean>;
  remove(jobId: string): Promise<boolean>;
  recordRun(record: CronRunRecord): Promise<CronRunRecord>;
  listRuns(jobId: string, limit: number): Promise<CronRunRecord[]>;
}
