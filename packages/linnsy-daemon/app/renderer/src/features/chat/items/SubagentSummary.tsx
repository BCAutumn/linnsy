// 子 agent 完成汇报气泡。
//
// 视觉：左缩进 + 头像位 + summary（markdown）。
// 与"主线 assistant 气泡"区分，让主人一眼看出"这是被派出去的小弟回报"。

import React from 'react';

import type { SubagentProgressChunk, SubagentSummaryItem } from '../projection/types.js';
import type { Locale } from '../../../lib/i18n.js';
import { t } from '../../../lib/i18n.js';
import { ChatMarkdownView } from '../markdown/ChatMarkdownView.js';

export function SubagentSummary({
  entryClassName,
  item,
  locale
}: { entryClassName: string; item: SubagentSummaryItem; locale: Locale }): React.JSX.Element {
  const progressChunks = item.progressChunks ?? [];
  return (
    <div className={`message subagent-summary${entryClassName}`} data-item-id={item.id} role="article">
      <header className="subagent-summary__header">
        <span className="subagent-summary__avatar" aria-hidden>🤝</span>
        <span className="subagent-summary__label">{t(locale, 'subagentSummaryLabel')}</span>
        <span className="subagent-summary__task">{item.taskId}</span>
      </header>
      {progressChunks.length > 0 && (
        <ol className="subagent-summary__progress" aria-label={t(locale, 'subagentProgressLabel')}>
          {progressChunks.map((chunk) => (
            <li className="subagent-summary__progress-row" key={chunk.id}>
              <span className={`subagent-summary__progress-dot subagent-summary__progress-dot--${chunk.status ?? 'loading'}`} aria-hidden />
              <span>{chunk.detail ?? formatSubagentProgressFallback(chunk)}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="subagent-summary__body">
        {item.summary.length === 0
          ? <span className="subagent-summary__pending">{t(locale, 'subagentProgressPending')}</span>
          : <ChatMarkdownView content={item.summary} streaming={false} />}
      </div>
    </div>
  );
}

function formatSubagentProgressFallback(chunk: SubagentProgressChunk): string {
  if (chunk.toolName !== undefined && chunk.phase !== undefined) {
    return `${chunk.toolName} · ${chunk.phase}`;
  }
  return chunk.kind;
}
