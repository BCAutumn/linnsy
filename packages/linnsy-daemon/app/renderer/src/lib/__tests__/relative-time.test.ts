import { describe, expect, test } from 'vitest';

import { formatRelativeTime } from '../relative-time.js';

describe('formatRelativeTime', () => {
  const now = new Date(2026, 3, 30, 20, 0, 0).getTime();

  test('formats recent times in Chinese relative copy', () => {
    expect(formatRelativeTime('zh-CN', now - 30 * 1000, now)).toBe('刚刚');
    expect(formatRelativeTime('zh-CN', now - 5 * 60 * 1000, now)).toBe('5 分钟前');
    expect(formatRelativeTime('zh-CN', now - 3 * 60 * 60 * 1000, now)).toBe('3 小时前');
  });

  test('uses clock time for older messages on the same day', () => {
    const earlierToday = new Date(2026, 3, 30, 9, 5, 0).getTime();

    expect(formatRelativeTime('zh-CN', earlierToday, now)).toBe('09:05');
  });

  test('formats days, months, and years for older timestamps', () => {
    expect(formatRelativeTime('zh-CN', now - 2 * 24 * 60 * 60 * 1000, now)).toBe('2 天前');
    expect(formatRelativeTime('zh-CN', now - 3 * 30 * 24 * 60 * 60 * 1000, now)).toBe('3 月前');
    expect(formatRelativeTime('zh-CN', now - 2 * 365 * 24 * 60 * 60 * 1000, now)).toBe('2 年前');
  });

  test('keeps English copy compact for sidebar use', () => {
    expect(formatRelativeTime('en-US', now - 5 * 60 * 1000, now)).toBe('5 min ago');
  });
});
