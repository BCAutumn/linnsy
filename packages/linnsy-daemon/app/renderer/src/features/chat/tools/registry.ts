// 工具卡注册表：toolName → ToolUiConfig 的纯函数映射。
//
// 默认只注册少量轻量卡，其它工具走 DefaultToolCard。后续每个工具
// 在 configs/<tool_name>.tsx 写自己的卡片，再在 configs/index.ts 聚合进 registry。
// 添加新工具不动主渲染路径——这是"高内聚低耦合"自检条目要求。

import { configEntries } from './configs/index.js';
import type { ToolUiConfig } from './types.js';

const registry = new Map<string, ToolUiConfig>(configEntries);

export function lookupToolUiConfig(toolName: string): ToolUiConfig | undefined {
  return registry.get(toolName);
}

// 测试 / 开发期热加载：configs/index.ts 改动后调一次重置缓存。
// 生产构建（vite build）走静态聚合，调用方不需要 awareness。
export function resetToolRegistry(entries: Iterable<readonly [string, ToolUiConfig]> = configEntries): void {
  registry.clear();
  for (const [name, config] of entries) {
    registry.set(name, config);
  }
}
