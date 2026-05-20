import { describe, expect, test } from 'vitest';

import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
  deriveSidebarWidthFromDrag
} from '../sidebar-width.js';

describe('sidebar width helpers', () => {
  test('clamps saved and dragged widths to the supported sidebar range', () => {
    expect(clampSidebarWidth(180)).toBe(SIDEBAR_WIDTH_MIN);
    expect(SIDEBAR_WIDTH_MIN).toBe(200);
    expect(clampSidebarWidth(260.4)).toBe(260);
    expect(clampSidebarWidth(420)).toBe(SIDEBAR_WIDTH_MAX);
  });

  test('derives the next width from horizontal pointer movement', () => {
    expect(deriveSidebarWidthFromDrag({
      startWidth: 260,
      startClientX: 100,
      currentClientX: 140
    })).toBe(300);
    expect(deriveSidebarWidthFromDrag({
      startWidth: 260,
      startClientX: 100,
      currentClientX: -100
    })).toBe(SIDEBAR_WIDTH_MIN);
  });
});
