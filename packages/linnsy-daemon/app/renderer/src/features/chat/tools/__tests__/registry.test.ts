// 工具卡 Registry 单元测试。
//
// 覆盖：
//   - 默认空表（configEntries 为空，所有 lookup 返回 undefined）
//   - resetToolRegistry 能注入测试 fixture（运行时热加载场景）
//   - lookup 命中后返回配置（layout / CardComponent）

import React from 'react';
import { describe, expect, test, afterEach } from 'vitest';

import { lookupToolUiConfig, resetToolRegistry } from '../registry.js';
import type { ToolUiConfig, ToolCardProps } from '../types.js';

afterEach(() => {
  // 还原默认（空）—— 防止测试间相互污染
  resetToolRegistry();
});

describe('tools/registry', () => {
  test('默认注册轻量工具卡，其它工具返回 undefined', () => {
    expect(lookupToolUiConfig('delegate_to_external')?.CardComponent).toBeDefined();
    expect(lookupToolUiConfig('list_tasks')?.CardComponent).toBeDefined();
    expect(lookupToolUiConfig('cron_list')?.CardComponent).toBeDefined();
    expect(lookupToolUiConfig('any.tool')).toBeUndefined();
  });

  test('resetToolRegistry 可注入新条目，lookup 返回 layout 配置', () => {
    const config: ToolUiConfig = {
      layout: { hideBorder: true, fullWidth: true }
    };
    resetToolRegistry([['echo', config]]);
    const got = lookupToolUiConfig('echo');
    expect(got).toBeDefined();
    expect(got?.layout?.hideBorder).toBe(true);
    expect(got?.layout?.fullWidth).toBe(true);
  });

  test('resetToolRegistry 可注入自定义 CardComponent', () => {
    const CustomCard = (props: ToolCardProps): React.JSX.Element =>
      React.createElement('div', { 'data-tool': props.item.toolName });
    resetToolRegistry([['echo', { CardComponent: CustomCard }]]);
    expect(lookupToolUiConfig('echo')?.CardComponent).toBe(CustomCard);
  });

  test('多条目注册：每个 toolName 独立映射', () => {
    resetToolRegistry([
      ['a', { layout: { hideBorder: true } }],
      ['b', { layout: { fullWidth: true } }]
    ]);
    expect(lookupToolUiConfig('a')?.layout?.hideBorder).toBe(true);
    expect(lookupToolUiConfig('a')?.layout?.fullWidth).toBeUndefined();
    expect(lookupToolUiConfig('b')?.layout?.fullWidth).toBe(true);
    expect(lookupToolUiConfig('c')).toBeUndefined();
  });
});
