import React from 'react';

import { t, type I18nKey } from '../../../../lib/i18n.js';
import type { ToolCardProps } from '../types.js';

export interface SimpleToolLineLabels {
  running: I18nKey;
  success: I18nKey;
  error: I18nKey;
  blocked: I18nKey;
}

export function SimpleToolLineCard({
  item,
  labels,
  locale
}: ToolCardProps & { labels: SimpleToolLineLabels }): React.JSX.Element {
  return (
    <div className={`tool-inline-notice tool-inline-notice--${item.status}`} data-tool-name={item.toolName}>
      <span className="tool-inline-notice__text">{t(locale, labels[item.status])}</span>
    </div>
  );
}
