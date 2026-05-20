import React from 'react';

import type { CronListEntry } from '../../lib/daemon-api.js';
import { FluentIcon } from '../../components/FluentIcon.js';
import { IconActionButtons, type IconActionButtonItem } from '../../components/IconActionButtons.js';
import { t, type Locale } from '../../lib/i18n.js';
import { describeReminderScheduleWithNextFire } from './scheduled-view-model.js';

/**
 * 「未送达」专用段：极简两行卡片（标题 + 红徽章「未送达」+ 频次/原计划绝对时间）。
 */
export function UndeliveredReminderSection(props: {
  busyId: string | null;
  locale: Locale;
  reminders: CronListEntry[];
  onDelete(reminder: CronListEntry): void;
}): React.JSX.Element | null {
  if (props.reminders.length === 0) {
    return null;
  }
  return (
    <details className="scheduled-view-archived scheduled-view-archived--failed">
      <summary>
        <span>{t(props.locale, 'remindersUndeliveredSection', { count: props.reminders.length })}</span>
        <FluentIcon aria-hidden="true" name="chevronRight" size={14} />
      </summary>
      <div className="scheduled-view-list">
        {props.reminders.map((reminder) => (
          <UndeliveredReminderRow
            busyId={props.busyId}
            key={reminder.jobId}
            locale={props.locale}
            reminder={reminder}
            onDelete={() => {
              props.onDelete(reminder);
            }}
          />
        ))}
      </div>
    </details>
  );
}

function UndeliveredReminderRow(props: {
  busyId: string | null;
  locale: Locale;
  reminder: CronListEntry;
  onDelete(): void;
}): React.JSX.Element {
  const scheduleLine = describeReminderScheduleWithNextFire(props.locale, props.reminder);
  const deleteItems: Array<IconActionButtonItem<'delete'>> = [
    {
      value: 'delete',
      label: t(props.locale, 'cronActionDelete'),
      icon: 'delete',
      disabled: props.busyId !== null
    }
  ];
  return (
    <article className="scheduled-view-row scheduled-view-row--undelivered scheduled-view-undelivered-row">
      <div className="scheduled-view-undelivered-main">
        <strong className="scheduled-view-undelivered-title">{props.reminder.query}</strong>
        <div className="scheduled-view-undelivered-meta">
          <span className="scheduled-view-badge scheduled-view-badge--failed">{t(props.locale, 'cronUndeliveredBadge')}</span>
          <span className="scheduled-view-undelivered-schedule">{scheduleLine}</span>
        </div>
      </div>
      <div className="scheduled-view-row-actions">
        <IconActionButtons
          ariaLabel={t(props.locale, 'cronRowActionsLabel')}
          items={deleteItems}
          size="sm"
          onAction={(value: 'delete') => {
            void value;
            props.onDelete();
          }}
        />
      </div>
    </article>
  );
}
