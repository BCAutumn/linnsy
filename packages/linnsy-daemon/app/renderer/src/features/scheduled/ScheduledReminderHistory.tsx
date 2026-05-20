import React from 'react';

import type { CronRunSummary } from '../../lib/daemon-api.js';
import { FluentIcon } from '../../components/FluentIcon.js';
import { t, type Locale } from '../../lib/i18n.js';
import { formatRelativeTime } from '../../lib/relative-time.js';
import { isTaskLikeScheduledOutput } from '../../lib/scheduled-output-policy.js';
import type { OutputState, ScheduledHistoryContext } from './scheduled-view-types.js';
import { historyStatusGlyph, historyStatusI18nKey } from './scheduled-history-display.js';

export function ReminderHistoryPanel(props: {
  locale: Locale;
  history: ScheduledHistoryContext;
}): React.JSX.Element | null {
  const { state } = props.history;
  if (state === undefined || state.status !== 'ready' || state.runs.length === 0) {
    return null;
  }
  return (
    <ol className="scheduled-view-history-list" aria-label={t(props.locale, 'scheduledHistorySection')}>
      {state.runs.map((run) => (
        <ReminderHistoryItem
          key={run.cronRunId}
          locale={props.locale}
          run={run}
          output={props.history.outputs[run.cronRunId]}
          onOpenConversation={(conversationId) => {
            props.history.onOpenConversation(conversationId, run.finishedAt);
          }}
        />
      ))}
    </ol>
  );
}

function ReminderHistoryItem(props: {
  locale: Locale;
  run: CronRunSummary;
  output: OutputState | undefined;
  onOpenConversation(conversationId: string): void;
}): React.JSX.Element {
  const finishedAt = props.run.finishedAt ?? props.run.startedAt ?? props.run.scheduledAt;
  const relative = formatRelativeTime(props.locale, finishedAt);
  const statusLabel = t(props.locale, historyStatusI18nKey(props.run.status));
  const output = props.run.status === 'completed' && props.output?.status === 'ready'
    ? props.output.output
    : null;
  const taskLike = output !== null && isTaskLikeScheduledOutput({
    summaryLength: output.summaryLength,
    hasSubagentSummary: output.hasSubagentSummary
  });
  const conversationId = taskLike ? output.conversationId : null;

  return (
    <li className={`scheduled-view-history-item status-${props.run.status}`}>
      <span className={`scheduled-view-history-status status-${props.run.status}`} aria-label={statusLabel}>
        {historyStatusGlyph(props.run.status)}
      </span>
      <span className="scheduled-view-history-time">{relative}</span>
      {props.run.status !== 'completed' ? <span className="scheduled-view-history-status-text">{statusLabel}</span> : null}
      {conversationId !== null ? (
        <button
          type="button"
          className="scheduled-view-history-open"
          onClick={() => {
            props.onOpenConversation(conversationId);
          }}
        >
          {t(props.locale, 'scheduledViewFullChat')}
          <FluentIcon aria-hidden="true" name="chevronRight" size={11} />
        </button>
      ) : null}
    </li>
  );
}
