// 系统事件气泡（cron / 外部 agent 执行提示）。
//
// 视觉：居中浅灰单行 + 时间，参考微信/Telegram 的 system notice 样式。
// 默认折叠（只显示一行 detail）；点击展开看详情（refId / occurredAt 全字段）。
// 沉默权：默认不响铃、不弹窗、不抢视觉焦点；只是一条历史可见的事实记录。

import React, { useState } from 'react';

import type { SystemEventItem } from '../projection/types.js';
import type { Locale } from '../../../lib/i18n.js';
import { t } from '../../../lib/i18n.js';

export function SystemEvent({
  entryClassName,
  item,
  locale
}: { entryClassName: string; item: SystemEventItem; locale: Locale }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const isTaskExecutionNotice = item.sourceKind === 'task_execution_notice';
  const sourceLabel = isTaskExecutionNotice ? undefined : t(locale, 'systemEventSourceCron');

  return (
    <div
      className={`message system-event system-event--${item.sourceKind}${entryClassName}`}
      data-item-id={item.id}
      role="status"
    >
      <button
        type="button"
        className="system-event__line"
        onClick={() => { setExpanded((prev) => !prev); }}
        aria-expanded={expanded}
      >
        {sourceLabel !== undefined && <span className="system-event__source">{sourceLabel}</span>}
        <span className="system-event__detail">{item.detail}</span>
      </button>
      {expanded && (
        <dl className="system-event__details">
          {item.refId !== undefined && (
            <>
              <dt>{t(locale, 'systemEventRefIdLabel')}</dt>
              <dd>{item.refId}</dd>
            </>
          )}
          <dt>{t(locale, 'systemEventOccurredAtLabel')}</dt>
          <dd>{new Date(item.occurredAt).toLocaleString(locale)}</dd>
        </dl>
      )}
    </div>
  );
}
