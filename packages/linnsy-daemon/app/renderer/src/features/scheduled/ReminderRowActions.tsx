import React from 'react';

import type { CronListEntry } from '../../lib/daemon-api.js';
import { IconActionButtons, type IconActionButtonItem } from '../../components/IconActionButtons.js';
import { t, type Locale } from '../../lib/i18n.js';

/**
 * 行内操作条：启停 + 删除，全部直接做成图标按钮（不藏在二级菜单里）。
 */
export function ReminderRowActions(props: {
  busyId: string | null;
  locale: Locale;
  reminder: CronListEntry;
  showToggle: boolean;
  onDelete(): void;
  onToggle(jobId: string, enabled: boolean): Promise<void>;
}): React.JSX.Element {
  const items: Array<IconActionButtonItem<'toggle' | 'delete'>> = [];
  if (props.showToggle) {
    const isEnabled = props.reminder.enabled;
    items.push({
      value: 'toggle',
      label: isEnabled ? t(props.locale, 'cronActionDisable') : t(props.locale, 'cronActionEnable'),
      icon: isEnabled ? 'pause' : 'play',
      disabled: props.busyId !== null
    });
  }
  items.push({
    value: 'delete',
    label: t(props.locale, 'cronActionDelete'),
    icon: 'delete',
    disabled: props.busyId !== null
  });

  return (
    <div className="scheduled-view-row-actions">
      <IconActionButtons
        ariaLabel={t(props.locale, 'cronRowActionsLabel')}
        items={items}
        size="sm"
        onAction={(value) => {
          if (value === 'delete') {
            props.onDelete();
            return;
          }
          void props.onToggle(props.reminder.jobId, !props.reminder.enabled);
        }}
      />
    </div>
  );
}
