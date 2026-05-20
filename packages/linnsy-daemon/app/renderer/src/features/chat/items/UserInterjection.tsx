// 主人插话气泡：daemon 处理 LLM 仍在生成中的入站消息时，把内容当作"插话"
// 同时注入到 LLM context fence 和前端事件流。
//
// 视觉：偏右小尺寸 + 标记色，与正常的 UserBubble 视觉区分——"插话"和"正常发言"
// 是两件事（前者是在 LLM 回话过程中打断，后者是新一轮对话起点）。

import React from 'react';

import type { UserInterjectionItem } from '../projection/types.js';
import type { Locale } from '../../../lib/i18n.js';
import { t } from '../../../lib/i18n.js';

export function UserInterjection({
  entryClassName,
  item,
  locale
}: { entryClassName: string; item: UserInterjectionItem; locale: Locale }): React.JSX.Element {
  return (
    <div
      className={`message user-interjection${entryClassName}`}
      data-item-id={item.id}
      role="note"
    >
      <span className="user-interjection__label">{t(locale, 'userInterjectionLabel')}</span>
      <span className="user-interjection__detail">{item.detail}</span>
    </div>
  );
}
