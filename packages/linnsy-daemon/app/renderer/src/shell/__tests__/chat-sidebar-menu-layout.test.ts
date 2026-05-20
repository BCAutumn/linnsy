import { describe, expect, test } from 'vitest';

import { deriveSidebarMoreMenuLayout } from '../chat-sidebar-menu-layout.js';

describe('deriveSidebarMoreMenuLayout', () => {
  test('默认左对齐 more 按钮并向右展开', () => {
    const layout = deriveSidebarMoreMenuLayout({
      anchorRect: { bottom: 40, left: 200, right: 224 },
      viewportWidth: 800
    });

    expect(layout).toEqual({
      left: 200,
      top: 45,
      width: 144
    });
  });

  test('右侧空间不足时翻到 more 按钮左侧', () => {
    const layout = deriveSidebarMoreMenuLayout({
      anchorRect: { bottom: 40, left: 700, right: 724 },
      viewportWidth: 800
    });

    expect(layout).toEqual({
      left: 580,
      top: 45,
      width: 144
    });
  });

  test('极窄窗口内仍保留 viewport 边距', () => {
    const layout = deriveSidebarMoreMenuLayout({
      anchorRect: { bottom: 40, left: 12, right: 36 },
      viewportWidth: 120
    });

    expect(layout.left).toBe(8);
  });
});
