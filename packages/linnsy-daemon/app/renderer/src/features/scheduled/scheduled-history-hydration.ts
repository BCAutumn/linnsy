import type { Dispatch, SetStateAction } from 'react';

import type { CronListEntry, DaemonApiClient } from '../../lib/daemon-api.js';

import { HISTORY_PER_ROW, type HistoryState, type OutputState } from './scheduled-view-types.js';

/**
 * 为当前 reminder 列表批量填充 history 与 outputs（并行按 job 拉取）。
 * 设计上不改变 LoadState，仅更新 historyByJob / outputsByRun，便于列表区独立订阅。
 */
export async function hydrateAllHistories(
  client: DaemonApiClient,
  reminders: CronListEntry[],
  setHistoryByJob: Dispatch<SetStateAction<Record<string, HistoryState>>>,
  setOutputsByRun: Dispatch<SetStateAction<Record<string, OutputState>>>
): Promise<void> {
  if (reminders.length === 0) return;
  setHistoryByJob((current) => {
    const next = { ...current };
    for (const reminder of reminders) {
      next[reminder.jobId] = { status: 'loading' };
    }
    return next;
  });
  await Promise.all(reminders.map(async (reminder) => {
    try {
      const runs = await client.listCronRuns(reminder.jobId, HISTORY_PER_ROW);
      setHistoryByJob((current) => ({ ...current, [reminder.jobId]: { status: 'ready', runs } }));
      await Promise.all(runs
        .filter((run) => run.status === 'completed' || run.status === 'failed')
        .map((run) => loadOutputForRun(client, reminder.jobId, run.cronRunId, setOutputsByRun)));
    } catch (error: unknown) {
      setHistoryByJob((current) => ({
        ...current,
        [reminder.jobId]: { status: 'error', error: error instanceof Error ? error.message : 'unknown' }
      }));
    }
  }));
}

async function loadOutputForRun(
  client: DaemonApiClient,
  jobId: string,
  cronRunId: string,
  setOutputsByRun: Dispatch<SetStateAction<Record<string, OutputState>>>
): Promise<void> {
  setOutputsByRun((current) => ({ ...current, [cronRunId]: { status: 'loading' } }));
  try {
    const response = await client.getCronRunOutput(jobId, cronRunId);
    setOutputsByRun((current) => ({ ...current, [cronRunId]: { status: 'ready', output: response.output } }));
  } catch (error: unknown) {
    setOutputsByRun((current) => ({
      ...current,
      [cronRunId]: { status: 'error', error: error instanceof Error ? error.message : 'unknown' }
    }));
  }
}
