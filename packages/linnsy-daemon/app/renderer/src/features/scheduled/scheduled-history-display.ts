import type { CronRunSummary } from '../../lib/daemon-api.js';
import type { I18nKey } from '../../lib/i18n.js';

export function historyStatusI18nKey(status: CronRunSummary['status']): I18nKey {
  if (status === 'completed') return 'scheduledHistoryStatusCompleted';
  if (status === 'failed') return 'scheduledHistoryStatusFailed';
  if (status === 'running') return 'scheduledHistoryStatusRunning';
  return 'scheduledHistoryStatusSkippedGrace';
}

/**
 * 列表前点用实心圆 `•`（U+2022）而不是细中点 `·`，11px 字号下也能一眼看清。
 * skipped_grace / running 走灰色实心圆，由 CSS `.scheduled-view-history-status` 统一控制大小。
 */
export function historyStatusGlyph(status: CronRunSummary['status']): string {
  if (status === 'completed') return '✓';
  if (status === 'failed') return '✗';
  if (status === 'running') return '•';
  return '•';
}
