// 默认工具卡：未在 registry 注册的工具统一走这里。
//
// 视觉：
//   - header 一行：状态 chip + toolName + duration（success/error/blocked 时）
//   - body 折叠态不挂载；展开后才格式化 args 并展示 data / observation / error
//
// 高内聚：所有工具状态 → CSS class 映射在本文件，避免散到多个组件。
// 低耦合：args / data / observation 都用 <pre> 兜底；具体工具想要 fancy 渲染请走自定义 Card。

import React, { useId } from 'react';

import type { ToolCardProps } from './types.js';
import { t, type Locale } from '../../../lib/i18n.js';
import type { ToolCallCardItem } from '../projection/types.js';

export function DefaultToolCard({ item, locale, expanded, onToggle }: ToolCardProps): React.JSX.Element {
  const statusLabel = t(locale, statusLabelKey(item.status));
  const bodyId = useId();
  return (
    <div className={`tool-card tool-card--${item.status}`} data-tool-call-id={item.toolCallId}>
      <button
        type="button"
        className="tool-card__header"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <span className={`tool-card__status tool-card__status--${item.status}`}>{statusLabel}</span>
        <span className="tool-card__name">{item.toolName}</span>
        {item.durationMs !== undefined && (
          <span className="tool-card__duration">{formatDuration(item.durationMs)}</span>
        )}
        <span className="tool-card__chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded ? <DefaultToolCardBody bodyId={bodyId} item={item} locale={locale} /> : null}
    </div>
  );
}

function DefaultToolCardBody({
  bodyId,
  item,
  locale
}: {
  bodyId: string;
  item: ToolCallCardItem;
  locale: Locale;
}): React.JSX.Element {
  const argsText = formatJson(item.args);
  const progressChunks = item.progressChunks ?? [];
  return (
    <div className="tool-card__body" id={bodyId}>
      {progressChunks.length > 0 && (
        <section className="tool-card__section">
          <h4>{t(locale, 'toolCardProgressHeading')}</h4>
          <ol className="tool-card__progress-list">
            {progressChunks.map((chunk) => (
              <li className="tool-card__progress-row" key={chunk.id}>
                <span className={`tool-card__progress-dot tool-card__progress-dot--${chunk.status}`} aria-hidden />
                <span className="tool-card__progress-text">
                  {chunk.detail ?? `${chunk.phase} · ${chunk.status}`}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="tool-card__section">
        <h4>{t(locale, 'toolCardArgsHeading')}</h4>
        <pre className="tool-card__pre">{argsText}</pre>
      </section>
      {item.data !== undefined && (
        <section className="tool-card__section">
          <h4>{t(locale, 'toolCardDataHeading')}</h4>
          <pre className="tool-card__pre">{formatJson(item.data)}</pre>
        </section>
      )}
      {item.observation !== undefined && (
        <section className="tool-card__section">
          <h4>{t(locale, 'toolCardObservationHeading')}</h4>
          <pre className="tool-card__pre">{item.observation}</pre>
        </section>
      )}
      {item.error !== undefined && (
        <section className="tool-card__section tool-card__section--error">
          <h4>{t(locale, 'toolCardErrorHeading')}</h4>
          <pre className="tool-card__pre">{item.error}</pre>
          {item.errorKind !== undefined && (
            <span className="tool-card__error-kind">{t(locale, errorKindLabelKey(item.errorKind))}</span>
          )}
        </section>
      )}
    </div>
  );
}

function statusLabelKey(status: 'running' | 'success' | 'error' | 'blocked'):
  | 'toolCardStatusRunning' | 'toolCardStatusSuccess' | 'toolCardStatusError' | 'toolCardStatusBlocked' {
  switch (status) {
    case 'running': return 'toolCardStatusRunning';
    case 'success': return 'toolCardStatusSuccess';
    case 'error': return 'toolCardStatusError';
    case 'blocked': return 'toolCardStatusBlocked';
  }
}

function errorKindLabelKey(kind: 'protocol' | 'execution'):
  | 'toolCardErrorKindProtocol' | 'toolCardErrorKindExecution' {
  return kind === 'protocol' ? 'toolCardErrorKindProtocol' : 'toolCardErrorKindExecution';
}

function formatJson(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // args 含循环引用之类的极端情况；兜底显示 keys 列表，避免整张卡崩。
    return Object.keys(value).join(', ');
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toString()}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
