import { describe, expect, it } from 'vitest';

import type { CronListEntry } from '../../../lib/daemon-api.js';
import {
  describeReminderMeta,
  describeReminderSchedule,
  describeReminderScheduleWithNextFire,
  partitionRemindersByStatus,
  sortReminderEntries
} from '../scheduled-view-model.js';

describe('scheduled-view-model', () => {
  it('keeps enabled reminders first and sorts each group by next run time', () => {
    const reminders: CronListEntry[] = [
      createReminder({ jobId: 'disabled-soon', enabled: false, nextRunAt: 10 }),
      createReminder({ jobId: 'enabled-later', enabled: true, nextRunAt: 30 }),
      createReminder({ jobId: 'enabled-soon', enabled: true, nextRunAt: 20 })
    ];

    expect(sortReminderEntries(reminders).map((reminder) => reminder.jobId)).toEqual([
      'enabled-soon',
      'enabled-later',
      'disabled-soon'
    ]);
  });

  it('describes weekly scheduled items', () => {
    expect(describeReminderSchedule('zh-CN', createReminder({
      schedule: { kind: 'weekly', dayOfWeek: 1, time: '10:00' }
    }))).toBe('每周一 10:00');
  });

  it('partitions reminders by enabled, recurring disabled, and undelivered one-shot states', () => {
    const reminders = [
      createReminder({ jobId: 'enabled', enabled: true }),
      createReminder({ jobId: 'disabled-daily', enabled: false, schedule: { kind: 'daily', time: '09:00' } }),
      createReminder({ jobId: 'undelivered', enabled: false, schedule: { kind: 'one_shot', atMs: 1 } })
    ];

    expect(partitionRemindersByStatus(reminders)).toEqual({
      active: [expect.objectContaining({ jobId: 'enabled' })],
      disabled: [expect.objectContaining({ jobId: 'disabled-daily' })],
      undelivered: [expect.objectContaining({ jobId: 'undelivered' })],
      completed: []
    });
  });

  it('routes completed one-shot reminders into the completed bucket', () => {
    const reminders = [
      createReminder({ jobId: 'finished', enabled: false, schedule: { kind: 'one_shot', atMs: 1 } }),
      createReminder({ jobId: 'pending', enabled: false, schedule: { kind: 'one_shot', atMs: 2 } })
    ];

    const partition = partitionRemindersByStatus(reminders, {
      finished: {
        cronRunId: 'cron_run_finished',
        jobId: 'finished',
        scheduledAt: 1,
        finishedAt: 100,
        status: 'completed'
      },
      pending: null
    });
    expect(partition.completed.map((r) => r.jobId)).toEqual(['finished']);
    expect(partition.undelivered.map((r) => r.jobId)).toEqual(['pending']);
  });

  it('formats list subtitle combining schedule wording and absolute next-fire time', () => {
    const nextRunAt = Date.UTC(2030, 4, 5, 9, 15, 0);
    expect(describeReminderScheduleWithNextFire('zh-CN', createReminder({
      schedule: { kind: 'daily', time: '09:00' },
      nextRunAt
    }))).toBe(`每天 09:00 · ${new Intl.DateTimeFormat('zh-CN', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(nextRunAt)}`);
  });

  /** 启用中的提醒副行不再额外贴时间（主行已有绝对时间）；任何类型都返回 null。 */
  it('returns null meta for enabled reminders regardless of schedule kind', () => {
    expect(describeReminderMeta('zh-CN', createReminder({
      enabled: true,
      schedule: { kind: 'daily', time: '09:00' }
    }))).toBeNull();
    expect(describeReminderMeta('zh-CN', createReminder({
      enabled: true,
      schedule: { kind: 'one_shot', atMs: 1 }
    }))).toBeNull();
  });

  /** 已停用副行只显示「已停用」，不再附带"下次/相对时间"，避免对停用 cron 出现误导性"下次"。 */
  it('returns plain disabled label for any disabled reminder', () => {
    expect(describeReminderMeta('zh-CN', createReminder({
      enabled: false,
      nextRunAt: Date.now() - 60_000,
      schedule: { kind: 'daily', time: '09:00' }
    }))).toBe('已停用');
    expect(describeReminderMeta('zh-CN', createReminder({
      enabled: false,
      nextRunAt: Date.now() - 60_000,
      schedule: { kind: 'one_shot', atMs: Date.now() - 60_000 }
    }))).toBe('已停用');
    expect(describeReminderMeta('en-US', createReminder({
      enabled: false,
      schedule: { kind: 'weekly', dayOfWeek: 3, time: '16:00' }
    }))).toBe('Disabled');
  });
});

function createReminder(input: Partial<CronListEntry>): CronListEntry {
  return {
    jobId: input.jobId ?? 'job',
    enabled: input.enabled ?? true,
    nextRunAt: input.nextRunAt ?? 1,
    query: input.query ?? 'Reminder',
    schedule: input.schedule ?? { kind: 'one_shot', atMs: 1 }
  };
}
