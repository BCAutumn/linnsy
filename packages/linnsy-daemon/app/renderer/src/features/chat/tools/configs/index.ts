// 工具配置聚合入口。未注册工具走 DefaultToolCard。
// 新增自定义卡时：
//   1) 在本目录新建 <tool_name>.tsx 实现 ToolUiConfig
//   2) 在下面 entries 数组里加一行 [toolName, config]
//   3) 不需要动 registry.ts / ToolCallCard.tsx / Message.tsx

import { cronListToolUiConfig } from './cron_list.js';
import { delegateToExternalToolUiConfig } from './delegate_to_external.js';
import { listTasksToolUiConfig } from './list_tasks.js';
import type { ToolUiConfig } from '../types.js';

export const configEntries: ReadonlyArray<readonly [string, ToolUiConfig]> = [
  ['delegate_to_external', delegateToExternalToolUiConfig],
  ['list_tasks', listTasksToolUiConfig],
  ['cron_list', cronListToolUiConfig]
];
