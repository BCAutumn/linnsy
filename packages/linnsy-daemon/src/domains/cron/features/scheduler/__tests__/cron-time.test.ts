import { describe, expect, test } from 'vitest';

import {
  computeInitialCronRunAt,
  computeNextCronRunAt,
  nextDailyRunAt,
  nextWeeklyRunAt
} from '../functions/cron-time.js';

function localMs(
  year: number,
  monthIndex: number,
  day: number,
  hours: number,
  minutes: number
): number {
  return new Date(year, monthIndex, day, hours, minutes, 0, 0).getTime();
}

describe('cron time helpers', () => {
  test('computes the first run for each schedule kind', () => {
    const now = localMs(2026, 4, 14, 9, 30);

    expect(computeInitialCronRunAt({ kind: 'one_shot', atMs: now + 1_000 }, now)).toBe(now + 1_000);
    expect(computeInitialCronRunAt({ kind: 'interval', intervalMs: 60_000 }, now)).toBe(now + 60_000);
    expect(computeInitialCronRunAt({ kind: 'daily', time: '10:00' }, now)).toBe(localMs(2026, 4, 14, 10, 0));
    expect(computeInitialCronRunAt({ kind: 'weekly', dayOfWeek: 5, time: '08:00' }, now)).toBe(
      localMs(2026, 4, 15, 8, 0)
    );
  });

  test('rejects one-shot schedules that are already in the past', () => {
    const now = localMs(2026, 4, 14, 9, 30);

    expect(() => computeInitialCronRunAt({ kind: 'one_shot', atMs: now - 1 }, now)).toThrow(
      'one-shot schedule must not be in the past'
    );
  });

  test('advances recurring jobs without replaying missed interval ticks', () => {
    const scheduledAt = localMs(2026, 4, 14, 9, 0);
    const now = localMs(2026, 4, 14, 9, 5);

    expect(computeNextCronRunAt({ kind: 'interval', intervalMs: 60_000 }, scheduledAt, now)).toBe(
      localMs(2026, 4, 14, 9, 6)
    );
    expect(computeNextCronRunAt({ kind: 'one_shot', atMs: scheduledAt }, scheduledAt, now)).toBeNull();
  });

  test('advances daily and weekly schedules from their scheduled wall-clock cadence', () => {
    const scheduledAt = localMs(2026, 4, 14, 9, 0);
    const now = localMs(2026, 4, 14, 9, 1);

    expect(computeNextCronRunAt({ kind: 'daily', time: '09:00' }, scheduledAt, now)).toBe(
      localMs(2026, 4, 15, 9, 0)
    );
    expect(computeNextCronRunAt({ kind: 'weekly', dayOfWeek: 4, time: '09:00' }, scheduledAt, now)).toBe(
      localMs(2026, 4, 21, 9, 0)
    );
  });

  test('validates wall-clock inputs in the shared helper', () => {
    const now = localMs(2026, 4, 14, 9, 30);

    expect(nextDailyRunAt('09:31', now)).toBe(localMs(2026, 4, 14, 9, 31));
    expect(nextDailyRunAt('09:00', now)).toBe(localMs(2026, 4, 15, 9, 0));
    expect(nextWeeklyRunAt(4, '09:00', now)).toBe(localMs(2026, 4, 21, 9, 0));
    expect(() => nextDailyRunAt('24:00', now)).toThrow('daily time must be HH:mm');
    expect(() => nextWeeklyRunAt(7, '09:00', now)).toThrow('weekly dayOfWeek');
  });
});
