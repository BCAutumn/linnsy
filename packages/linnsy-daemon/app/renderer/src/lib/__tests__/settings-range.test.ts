import { describe, expect, it } from 'vitest';

import { calculateSettingsRangeProgress } from '../settings-range.js';

describe('calculateSettingsRangeProgress', () => {
  it('maps a range value to a clamped progress percentage', () => {
    expect(calculateSettingsRangeProgress({ min: 220, max: 360, value: 220 })).toBe(0);
    expect(calculateSettingsRangeProgress({ min: 220, max: 360, value: 290 })).toBe(50);
    expect(calculateSettingsRangeProgress({ min: 220, max: 360, value: 360 })).toBe(100);
    expect(calculateSettingsRangeProgress({ min: 220, max: 360, value: 500 })).toBe(100);
  });
});
