// 工具调用卡：S3 渲染入口。
//
// 职责：
//   1) 持有展开 / 折叠状态（默认 running 时折叠；终态卡也折叠，由用户按需展开）
//   2) 查 registry，命中走自定义 Card；否则走 DefaultToolCard
//   3) 应用 layout 开关（hideBorder / hideBackground / fullWidth / hideContent / noPadding）
//
// 不做：
//   - 不直接渲染工具内容（交给 Card 组件，本文件不知道任何工具语义）
//   - 不持有任何会变的子状态（展开态除外）

import React, { useState } from 'react';

import type { ToolCallCardItem } from '../projection/types.js';
import type { Locale } from '../../../lib/i18n.js';
import { lookupToolUiConfig } from '../tools/registry.js';
import { DefaultToolCard } from '../tools/DefaultToolCard.js';

export function ToolCallCard({
  entryClassName,
  item,
  locale,
  onBeforeExpand
}: {
  entryClassName: string;
  item: ToolCallCardItem;
  locale: Locale;
  onBeforeExpand?: () => void;
}): React.JSX.Element {
  // 默认折叠 —— "对话即观察台"哲学要求工具卡是辅助信息，不抢占视觉焦点。
  const [expanded, setExpanded] = useState(false);
  const toggle = (): void => {
    if (!expanded) {
      onBeforeExpand?.();
    }
    setExpanded((prev) => !prev);
  };

  const config = lookupToolUiConfig(item.toolName);
  const layout = config?.layout ?? {};
  const Card = config?.CardComponent ?? DefaultToolCard;

  const wrapperClass = [
    'tool-card-wrapper',
    layout.hideBorder === true ? 'tool-card-wrapper--no-border' : '',
    layout.hideBackground === true ? 'tool-card-wrapper--no-bg' : '',
    layout.noPadding === true ? 'tool-card-wrapper--no-padding' : '',
    layout.fullWidth === true ? 'tool-card-wrapper--full-width' : ''
  ].filter((cls) => cls.length > 0).join(' ');

  return (
    <div
      className={`message tool-call ${wrapperClass}${entryClassName}`}
      data-item-id={item.id}
      role="region"
      aria-label={`tool ${item.toolName} ${item.status}`}
    >
      {layout.hideContent === true ? null : (
        <Card item={item} locale={locale} expanded={expanded} onToggle={toggle} />
      )}
    </div>
  );
}
