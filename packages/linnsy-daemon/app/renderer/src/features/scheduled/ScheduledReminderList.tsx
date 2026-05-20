import React, { useState } from 'react';

import type { CreateCronInput, CronListEntry } from '../../lib/daemon-api.js';
import { FluentIcon } from '../../components/FluentIcon.js';
import { t, type Locale } from '../../lib/i18n.js';
import {
  describeReminderMeta,
  describeReminderScheduleWithNextFire,
  partitionRemindersByStatus,
  sortReminderEntries,
  type LastRunByJob
} from './scheduled-view-model.js';
import type { HistoryState, OutputState, ScheduledHistoryContext } from './scheduled-view-types.js';
import { CreateCronDialog } from './CreateCronDialog.js';
import { ConfirmDialog, EmptyState, PanelHeader } from './ScheduledViewChrome.js';
import { ReminderHistoryPanel } from './ScheduledReminderHistory.js';
import { ReminderRowActions } from './ReminderRowActions.js';
import { UndeliveredReminderSection } from './UndeliveredReminderSection.js';

interface ConfirmDeleteState {
  reminder: CronListEntry;
  /** true 时弹窗里显示"以后不再确认（已停用 / 已完成 / 未送达）"checkbox。 */
  allowSkipFuture: boolean;
}

export function ScheduledReminderList(props: {
  busyId: string | null;
  locale: Locale;
  reminders: CronListEntry[];
  historyByJob: Record<string, HistoryState>;
  outputsByRun: Record<string, OutputState>;
  lastRunByJob: LastRunByJob;
  skipInactiveDeleteConfirm: boolean;
  onCreate(input: CreateCronInput): Promise<void>;
  onDelete(jobId: string): Promise<void>;
  onToggle(jobId: string, enabled: boolean): Promise<void>;
  onSetSkipInactiveDeleteConfirm(next: boolean): Promise<void>;
  onOpenConversation(conversationId: string, finishedAt?: number): void;
}): React.JSX.Element {
  const [confirmState, setConfirmState] = useState<ConfirmDeleteState | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const reminders = sortReminderEntries(props.reminders);
  const partition = partitionRemindersByStatus(reminders, props.lastRunByJob);
  const hasReminders = reminders.length > 0;

  const buildHistoryContext = (jobId: string): ScheduledHistoryContext => ({
    state: props.historyByJob[jobId],
    outputs: props.outputsByRun,
    onOpenConversation: (conversationId, finishedAt) => {
      props.onOpenConversation(conversationId, finishedAt);
    }
  });

  const handleInactiveDelete = (reminder: CronListEntry): void => {
    if (props.skipInactiveDeleteConfirm) {
      void props.onDelete(reminder.jobId);
      return;
    }
    setConfirmState({ reminder, allowSkipFuture: true });
  };

  return (
    <section className="scheduled-view-panel">
      <PanelHeader
        action={(
          <button
            className="scheduled-view-panel-create"
            disabled={props.busyId !== null}
            onClick={() => {
              setIsCreateOpen(true);
            }}
            type="button"
          >
            <FluentIcon aria-hidden="true" name="add" size={15} />
            {t(props.locale, 'cronCreateAction')}
          </button>
        )}
        title={t(props.locale, 'scheduledSectionTitle')}
      />
      {!hasReminders ? (
        <EmptyState icon="clock" text={t(props.locale, 'tasksReminderEmpty')} />
      ) : (
        <>
          {partition.active.length === 0 ? null : (
            <div className="scheduled-view-list">
              {partition.active.map((reminder) => (
                <ReminderRow
                  busyId={props.busyId}
                  key={reminder.jobId}
                  locale={props.locale}
                  reminder={reminder}
                  history={buildHistoryContext(reminder.jobId)}
                  tone="active"
                  showToggle={true}
                  onDelete={() => {
                    setConfirmState({ reminder, allowSkipFuture: false });
                  }}
                  onToggle={(jobId, enabled) => props.onToggle(jobId, enabled)}
                />
              ))}
            </div>
          )}
          <ReminderDetailsSection
            busyId={props.busyId}
            locale={props.locale}
            reminders={partition.completed}
            summary={t(props.locale, 'scheduledCompletedSection', { count: partition.completed.length })}
            tone="muted"
            showToggle={false}
            buildHistory={buildHistoryContext}
            onDelete={handleInactiveDelete}
            onToggle={(jobId, enabled) => props.onToggle(jobId, enabled)}
          />
          <ReminderDetailsSection
            busyId={props.busyId}
            locale={props.locale}
            reminders={partition.disabled}
            summary={t(props.locale, 'remindersDisabledSection', { count: partition.disabled.length })}
            tone="muted"
            showToggle={true}
            buildHistory={buildHistoryContext}
            onDelete={handleInactiveDelete}
            onToggle={(jobId, enabled) => props.onToggle(jobId, enabled)}
          />
          <UndeliveredReminderSection
            busyId={props.busyId}
            locale={props.locale}
            reminders={partition.undelivered}
            onDelete={handleInactiveDelete}
          />
        </>
      )}
      {confirmState === null ? null : (
        <ConfirmDialog
          body={t(props.locale, 'cronDeleteConfirm')}
          locale={props.locale}
          {...(confirmState.allowSkipFuture ? {
            skipFutureOption: {
              label: t(props.locale, 'cronDeleteSkipFutureLabel'),
              hint: t(props.locale, 'cronDeleteSkipFutureHint')
            }
          } : {})}
          onCancel={() => {
            setConfirmState(null);
          }}
          onConfirm={(skipFuture) => {
            const jobId = confirmState.reminder.jobId;
            setConfirmState(null);
            void props.onDelete(jobId);
            if (skipFuture) {
              void props.onSetSkipInactiveDeleteConfirm(true);
            }
          }}
          title={confirmState.reminder.query}
        />
      )}
      {isCreateOpen ? (
        <CreateCronDialog
          locale={props.locale}
          onCancel={() => {
            setIsCreateOpen(false);
          }}
          onSubmit={(input) => {
            void props.onCreate(input).then(() => {
              setIsCreateOpen(false);
            });
          }}
        />
      ) : null}
    </section>
  );
}

function ReminderDetailsSection(props: {
  busyId: string | null;
  locale: Locale;
  reminders: CronListEntry[];
  summary: string;
  tone: 'failed' | 'muted';
  metaText?: string | null;
  showToggle: boolean;
  buildHistory(jobId: string): ScheduledHistoryContext;
  onDelete(reminder: CronListEntry): void;
  onToggle(jobId: string, enabled: boolean): Promise<void>;
}): React.JSX.Element | null {
  if (props.reminders.length === 0) {
    return null;
  }
  return (
    <details className={`scheduled-view-archived scheduled-view-archived--${props.tone}`}>
      <summary>
        <span>{props.summary}</span>
        <FluentIcon aria-hidden="true" name="chevronRight" size={14} />
      </summary>
      <div className="scheduled-view-list">
        {props.reminders.map((reminder) => (
          <ReminderRow
            busyId={props.busyId}
            key={reminder.jobId}
            locale={props.locale}
            {...(props.metaText === undefined ? {} : { metaText: props.metaText })}
            reminder={reminder}
            history={props.buildHistory(reminder.jobId)}
            tone={props.tone}
            showToggle={props.showToggle}
            onDelete={() => {
              props.onDelete(reminder);
            }}
            onToggle={(jobId, enabled) => props.onToggle(jobId, enabled)}
          />
        ))}
      </div>
    </details>
  );
}

function ReminderRow(props: {
  busyId: string | null;
  locale: Locale;
  metaText?: string | null;
  reminder: CronListEntry;
  history: ScheduledHistoryContext;
  showToggle: boolean;
  /**
   * 'failed' 仅供 ReminderDetailsSection 兼容旧回归测试保留；当前 partition.undelivered 走 UndeliveredReminderSection 自渲染，不再进 ReminderRow。
   */
  tone: 'active' | 'failed' | 'muted';
  onDelete(): void;
  onToggle(jobId: string, enabled: boolean): Promise<void>;
}): React.JSX.Element {
  const rowClassName = props.tone === 'failed'
    ? 'scheduled-view-row scheduled-view-row--undelivered'
    : 'scheduled-view-row';
  const frequencyLine = describeReminderScheduleWithNextFire(props.locale, props.reminder);
  const metaTextRaw = props.metaText === undefined
    ? describeReminderMeta(props.locale, props.reminder)
    : props.metaText;
  return (
    <article className={rowClassName}>
      <div className="scheduled-view-row-main">
        <span className={`scheduled-view-status-dot status-${props.tone}`} />
        <div>
          <strong>{props.reminder.query}</strong>
          <span className="scheduled-view-row-frequency">{frequencyLine}</span>
          {metaTextRaw ? <small>{metaTextRaw}</small> : null}
          <ReminderHistoryPanel locale={props.locale} history={props.history} />
        </div>
      </div>
      <ReminderRowActions
        busyId={props.busyId}
        locale={props.locale}
        reminder={props.reminder}
        showToggle={props.showToggle}
        onDelete={() => {
          props.onDelete();
        }}
        onToggle={(jobId, enabled) => props.onToggle(jobId, enabled)}
      />
    </article>
  );
}
