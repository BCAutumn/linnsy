import type { CreateCronInput, CronSchedule } from '../../lib/daemon-api.js';
import { t, type Locale } from '../../lib/i18n.js';

export type CreateScheduleKind = CronSchedule['kind'];
export type IntervalUnit = 'hours' | 'minutes';

export function createDefaultCronFormValues(): {
  date: string;
  dayOfWeek: number;
  time: string;
} {
  const next = new Date(Date.now() + 3_600_000);
  next.setMinutes(0, 0, 0);
  return {
    date: formatDateInputValue(next),
    dayOfWeek: next.getDay(),
    time: formatTimeInputValue(next)
  };
}

export function buildCreateCronInput(input: {
  query: string;
  scheduleKind: CreateScheduleKind;
  date: string;
  time: string;
  dayOfWeek: string;
  intervalValue: string;
  intervalUnit: IntervalUnit;
}): CreateCronInput | null {
  const query = input.query.trim();
  if (query.length === 0) {
    return null;
  }
  if (input.scheduleKind === 'one_shot') {
    const atMs = new Date(`${input.date}T${input.time}:00`).getTime();
    if (!Number.isFinite(atMs) || atMs <= Date.now()) {
      return null;
    }
    return { query, schedule: { kind: 'one_shot', atMs } };
  }
  if (input.scheduleKind === 'daily') {
    if (!isTimeInputValue(input.time)) {
      return null;
    }
    return { query, schedule: { kind: 'daily', time: input.time } };
  }
  if (input.scheduleKind === 'weekly') {
    const dayOfWeek = Number(input.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || !isTimeInputValue(input.time)) {
      return null;
    }
    return { query, schedule: { kind: 'weekly', dayOfWeek, time: input.time } };
  }
  const interval = Number(input.intervalValue);
  if (!Number.isInteger(interval) || interval <= 0) {
    return null;
  }
  const intervalMs = interval * (input.intervalUnit === 'hours' ? 3_600_000 : 60_000);
  return { query, schedule: { kind: 'interval', intervalMs } };
}

function isTimeInputValue(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/u.test(value);
}

export function formatDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

export function formatTimeInputValue(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

export function getWeekdayOptionText(locale: Locale, dayOfWeek: number): string {
  const keys = [
    'weekdaySunday',
    'weekdayMonday',
    'weekdayTuesday',
    'weekdayWednesday',
    'weekdayThursday',
    'weekdayFriday',
    'weekdaySaturday'
  ] as const;
  return t(locale, keys[dayOfWeek] ?? 'weekdaySunday');
}
