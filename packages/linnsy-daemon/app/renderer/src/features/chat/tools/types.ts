// 工具卡 Registry 类型契约。
//
// 设计原则（来自 STREAMING_RENDER_PLAN.md §3.2 + Linnya `ui/tools/configs/`）：
//   - 每个工具自带 layout 配置 + 可选自定义 Card 组件
//   - 未注册工具走 DefaultToolCard（折叠卡）—— 新增工具不动渲染主路径
//   - layout 字段全是布尔开关，不让自定义 CSS 直接进 className（防御性 UI）
//
// 三层职责拆分：
//   - ToolCardProps：工具卡组件接收的标准 props（item + 折叠态）
//   - ToolCardLayout：默认卡 / 自定义卡共用的视觉粒度开关
//   - ToolUiConfig：注册表里每个 toolName 对应的配置（layout + 可选 Card）

import type React from 'react';
import type { Locale } from '../../../lib/i18n.js';
import type { ToolCallCardItem } from '../projection/types.js';

export interface ToolCardProps {
  item: ToolCallCardItem;
  locale: Locale;
  // 当前是否处于展开态。控制由父组件（ToolCallCard）持有，这里只读。
  // 自定义 Card 可以选择忽略此 prop（例如不需要展开折叠的 inline 卡）。
  expanded: boolean;
  onToggle: () => void;
}

export interface ToolCardLayout {
  // 隐藏卡片边框，让卡完全融入消息流（用于轻量提示型工具）。
  hideBorder?: boolean;
  // 隐藏卡片背景色（仅边框 + 内容）。
  hideBackground?: boolean;
  // 取消内边距（自定义 Card 自己控制 padding）。
  noPadding?: boolean;
  // 占满消息列表宽度而不是默认窄气泡（适合代码 / 表格类输出）。
  fullWidth?: boolean;
  // 隐藏内容区（连 args / result 都不渲染，仅 header 行——极简打点工具）。
  hideContent?: boolean;
}

export interface ToolUiConfig {
  layout?: ToolCardLayout;
  // 完全自定义卡组件。命中 registry 时优先于 DefaultToolCard。
  // 仍然遵循 ToolCardProps 接口——layout 和 expanded 由父级 ToolCallCard 控制。
  CardComponent?: React.ComponentType<ToolCardProps>;
}
