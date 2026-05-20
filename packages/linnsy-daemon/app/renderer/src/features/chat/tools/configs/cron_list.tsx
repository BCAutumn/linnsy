import React from 'react';

import { SimpleToolLineCard } from './SimpleToolLineCard.js';
import type { ToolCardProps, ToolUiConfig } from '../types.js';

const labels = {
  running: 'toolLineCronListRunning',
  success: 'toolLineCronListSuccess',
  error: 'toolLineCronListError',
  blocked: 'toolLineCronListBlocked'
} as const;

function CronListCard(props: ToolCardProps): React.JSX.Element {
  return <SimpleToolLineCard {...props} labels={labels} />;
}

export const cronListToolUiConfig: ToolUiConfig = {
  layout: {
    hideBorder: true,
    hideBackground: true,
    noPadding: true
  },
  CardComponent: CronListCard
};
