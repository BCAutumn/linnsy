export type CronRunStatus = 'skipped_grace' | 'running' | 'completed' | 'failed';

// 定时安排默认回到主 Linnsy：到点事件是一张内部纸条，不是另起一个临时小号。
export const DEFAULT_CRON_DEFINITION_KEY = 'linnsy_main';

export type CronSchedule =
  | { kind: 'one_shot'; atMs: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; dayOfWeek: number; time: string }
  | { kind: 'interval'; intervalMs: number };

export interface CronJobPayload {
  /** 定时提醒永远进入手机终端绑定对话；未来若真有日报/周报显式绑定需求再加字段。 */
  definitionKey: string;
  query: string;
}

export interface CronJobRecord {
  jobId: string;
  enabled: boolean;
  schedule: CronSchedule;
  nextRunAt: number;
  missGraceMs: number;
  payload: CronJobPayload;
  createdAt: number;
  updatedAt: number;
}

export interface CronJobListFilter {
  enabled?: boolean;
  limit?: number;
}

export interface CronRunRecord {
  cronRunId: string;
  jobId: string;
  scheduledAt: number;
  startedAt?: number;
  finishedAt?: number;
  status: CronRunStatus;
  runId?: string;
  errorCode?: string;
}

export const CRON_MISS_GRACE_MIN_MS = 120_000;
export const CRON_MISS_GRACE_MAX_MS = 7_200_000;
