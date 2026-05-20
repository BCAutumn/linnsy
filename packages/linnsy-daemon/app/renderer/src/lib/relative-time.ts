import { t, type Locale } from './i18n.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const CLOCK_TIME_AFTER_MS = 6 * HOUR_MS;
const UNIX_MS_THRESHOLD = 1_000_000_000_000;

export function formatRelativeTime(locale: Locale, value: number, now = Date.now()): string {
  if (value < UNIX_MS_THRESHOLD) {
    return '';
  }

  const elapsed = Math.max(0, now - value);
  if (elapsed < MINUTE_MS) {
    return t(locale, 'timeJustNow');
  }
  if (elapsed < HOUR_MS) {
    return t(locale, 'timeMinutesAgo', { count: Math.max(1, Math.floor(elapsed / MINUTE_MS)) });
  }
  if (elapsed < CLOCK_TIME_AFTER_MS) {
    return t(locale, 'timeHoursAgo', { count: Math.max(1, Math.floor(elapsed / HOUR_MS)) });
  }
  if (isSameLocalDay(new Date(value), new Date(now))) {
    return formatClockTime(locale, value);
  }
  if (elapsed < MONTH_MS) {
    return t(locale, 'timeDaysAgo', { count: Math.max(1, Math.floor(elapsed / DAY_MS)) });
  }
  if (elapsed < YEAR_MS) {
    return t(locale, 'timeMonthsAgo', { count: Math.max(1, Math.floor(elapsed / MONTH_MS)) });
  }
  return t(locale, 'timeYearsAgo', { count: Math.max(1, Math.floor(elapsed / YEAR_MS)) });
}

function formatClockTime(locale: Locale, value: number): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
