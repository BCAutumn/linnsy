import type { CronSchedule } from '../definitions/types.js';

const DAILY_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;

/**
 * 新建 cron 时计算第一轮 nextRunAt。
 * 这里是 HTTP route、manage_schedule(action=set) 共同使用的唯一时间算法入口。
 */
export function computeInitialCronRunAt(schedule: CronSchedule, now: number): number {
  if (schedule.kind === 'one_shot') {
    if (schedule.atMs < now) {
      throw new Error('one-shot schedule must not be in the past');
    }
    return schedule.atMs;
  }
  if (schedule.kind === 'interval') {
    return now + schedule.intervalMs;
  }
  if (schedule.kind === 'weekly') {
    return nextWeeklyRunAt(schedule.dayOfWeek, schedule.time, now);
  }
  return nextDailyRunAt(schedule.time, now);
}

/**
 * cron 执行前推进下一轮 nextRunAt。
 * recurring 任务以原 scheduledAt 为基准快进，避免 daemon 卡顿后把错过的周期一次性补跑。
 */
export function computeNextCronRunAt(
  schedule: CronSchedule,
  scheduledAt: number,
  now: number
): number | null {
  if (schedule.kind === 'one_shot') {
    return null;
  }
  if (schedule.kind === 'interval') {
    let next = scheduledAt + schedule.intervalMs;
    while (next <= now) {
      next += schedule.intervalMs;
    }
    return next;
  }
  if (schedule.kind === 'weekly') {
    const nextWeekly = nextWeeklyRunAt(schedule.dayOfWeek, schedule.time, scheduledAt);
    if (nextWeekly > now) {
      return nextWeekly;
    }
    return nextWeeklyRunAt(schedule.dayOfWeek, schedule.time, now);
  }
  const nextDaily = nextDailyRunAt(schedule.time, scheduledAt);
  if (nextDaily > now) {
    return nextDaily;
  }
  return nextDailyRunAt(schedule.time, now);
}

export function nextDailyRunAt(time: string, afterMs: number): number {
  const parsed = readDailyTime(time);
  const candidate = new Date(afterMs);
  candidate.setHours(parsed.hours, parsed.minutes, 0, 0);
  if (candidate.getTime() <= afterMs) {
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(parsed.hours, parsed.minutes, 0, 0);
  }
  return candidate.getTime();
}

export function nextWeeklyRunAt(dayOfWeek: number, time: string, afterMs: number): number {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error('weekly dayOfWeek must be an integer from 0 to 6');
  }
  const candidate = new Date(nextDailyRunAt(time, afterMs));
  const daysUntilTarget = (dayOfWeek - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + daysUntilTarget);
  if (candidate.getTime() <= afterMs) {
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate.getTime();
}

function readDailyTime(time: string): { hours: number; minutes: number } {
  const match = DAILY_TIME_PATTERN.exec(time);
  if (match === null) {
    throw new Error('daily time must be HH:mm');
  }
  const hoursText = match[1];
  const minutesText = match[2];
  if (hoursText === undefined || minutesText === undefined) {
    throw new Error('daily time must be HH:mm');
  }
  return {
    hours: Number(hoursText),
    minutes: Number(minutesText)
  };
}
