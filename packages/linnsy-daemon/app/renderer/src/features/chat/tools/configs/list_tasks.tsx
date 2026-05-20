import React from 'react';

import { SimpleToolLineCard } from './SimpleToolLineCard.js';
import type { ToolCardProps, ToolUiConfig } from '../types.js';

const labels = {
  running: 'toolLineListTasksRunning',
  success: 'toolLineListTasksSuccess',
  error: 'toolLineListTasksError',
  blocked: 'toolLineListTasksBlocked'
} as const;

function ListTasksCard(props: ToolCardProps): React.JSX.Element {
  return <SimpleToolLineCard {...props} labels={labels} />;
}

export const listTasksToolUiConfig: ToolUiConfig = {
  layout: {
    hideBorder: true,
    hideBackground: true,
    noPadding: true
  },
  CardComponent: ListTasksCard
};
