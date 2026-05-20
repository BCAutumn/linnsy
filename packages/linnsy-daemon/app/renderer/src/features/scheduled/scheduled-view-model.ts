import type { CronListEntry, CronRunSummary } from '../../lib/daemon-api.js';
import type { I18nKey, Locale } from '../../lib/i18n.js';
import { t } from '../../lib/i18n.js';

export interface ReminderStatusPartition {
  active: CronListEntry[];
  /** 周期型 cron 主人手动停用，永久保留。 */
  disabled: CronListEntry[];
  /**
   * 2026-05-05 拍板：一次性 cron 失败 / 未送达；继续走 tone='failed' 红色渲染。
   * lastRun 为 undefined（尚未拉取）时也临时归到这里，等数据回来重新 partition。
   */
  undelivered: CronListEntry[];
  /**
   * 2026-05-05 拍板：一次性 cron 成功完成进"已完成（7 天后清理）"段，由后端
   * sweeper 到期清理。详见 docs/product/scenarios.md §3.3。
   */
  completed: CronListEntry[];
}

export type LastRunByJob = Record<string, CronRunSummary | null | undefined>;

export function sortReminderEntries(reminders: CronListEntry[]): CronListEntry[] {
  return [...reminders].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }
    return left.nextRunAt - right.nextRunAt;
  });
}

export function partitionRemindersByStatus(
  reminders: CronListEntry[],
  lastRunByJob: LastRunByJob = {}
): ReminderStatusPartition {
  const partition: ReminderStatusPartition = {
    active: [],
    disabled: [],
    undelivered: [],
    completed: []
  };
  for (const reminder of reminders) {
    if (reminder.enabled) {
      partition.active.push(reminder);
      continue;
    }
    if (reminder.schedule.kind !== 'one_shot') {
      partition.disabled.push(reminder);
      continue;
    }
    const lastRun = lastRunByJob[reminder.jobId];
    if (lastRun !== undefined && lastRun !== null && lastRun.status === 'completed') {
      partition.completed.push(reminder);
    } else {
      partition.undelivered.push(reminder);
    }
  }
  return partition;
}

export function describeReminderSchedule(locale: Locale, reminder: CronListEntry): string {
  if (reminder.schedule.kind === 'one_shot') {
    return t(locale, 'cronScheduleOneShot');
  }
  if (reminder.schedule.kind === 'daily') {
    return t(locale, 'cronScheduleDaily', { time: reminder.schedule.time });
  }
  if (reminder.schedule.kind === 'weekly') {
    return t(locale, 'cronScheduleWeekly', {
      day: getWeekdayText(locale, reminder.schedule.dayOfWeek),
      time: reminder.schedule.time
    });
  }
  return t(locale, 'cronScheduleInterval', {
    minutes: Math.max(1, Math.round(reminder.schedule.intervalMs / 60_000))
  });
}

/** 列表主行展示的「频次 + 绝对触发时间」（安排列表要能一眼看到时间）。 */
export function describeReminderScheduleWithNextFire(locale: Locale, reminder: CronListEntry): string {
  const schedule = describeReminderSchedule(locale, reminder);
  const absolute = formatLocaleDateTime(locale, reminder.nextRunAt);
  return `${schedule} · ${absolute}`;
}

/**
 * UI 列表用绝对时间字符串（与用户系统时区一致）。
 */
export function formatLocaleDateTime(locale: Locale, epochMs: number): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(epochMs));
}

export function getWeekdayText(locale: Locale, dayOfWeek: number): string {
  const keys: I18nKey[] = [
    'weekdaySunday',
    'weekdayMonday',
    'weekdayTuesday',
    'weekdayWednesday',
    'weekdayThursday',
    'weekdayFriday',
    'weekdaySaturday'
  ];
  const key = keys[dayOfWeek];
  return key === undefined ? String(dayOfWeek) : t(locale, key);
}

/**
 * 列表副行文案。
 *
 * 2026-05-05 拍板（最少字传最多信息）：
 *  - 启用中（任何类型）→ 不显示副行（主行 `describeReminderScheduleWithNextFire` 已含绝对时间）；
 *  - 已停用（任何类型）→ 只显示「已停用」单词，不附带任何"下次/相对"时间——
 *    已停用的 cron 不会再被触发，附"下次"语义错误且容易误导用户。
 *
 * @returns 无副行时为 null
 */
export function describeReminderMeta(locale: Locale, reminder: CronListEntry): string | null {
  if (reminder.enabled) {
    return null;
  }
  return t(locale, 'cronDisabledPlain');
}
