// 思考段的展示文案保持为纯函数，React 组件只负责交互和排版。
// 这里用投影层保存的事件时间计算耗时，避免 UI 根据渲染时刻猜测。

import type { Locale } from '../../../lib/i18n.js';
import { t } from '../../../lib/i18n.js';
import type { AssistantBubbleItem, AssistantThoughtChunk } from '../projection/types.js';

export interface AssistantThoughtSummary {
  label: string;
  completed: boolean;
}

export function getAssistantThoughtSummary(item: AssistantBubbleItem, locale: Locale): AssistantThoughtSummary {
  const completed = item.thoughtChunks.every((chunk) => chunk.completed);
  const durationSeconds = formatThoughtDurationSeconds(item.thoughtChunks);
  return {
    completed,
    label: completed
      ? t(locale, 'assistantThoughtDuration', { seconds: durationSeconds })
      : t(locale, 'assistantThoughtThinkingDuration', { seconds: durationSeconds })
  };
}

function formatThoughtDurationSeconds(chunks: readonly AssistantThoughtChunk[]): string {
  const range = getThoughtTimeRange(chunks);
  if (range === null) {
    return '0.0';
  }
  const durationMs = Math.max(0, range.endedAt - range.startedAt);
  return (durationMs / 1000).toFixed(1);
}

function getThoughtTimeRange(chunks: readonly AssistantThoughtChunk[]): { startedAt: number; endedAt: number } | null {
  if (chunks.length === 0) {
    return null;
  }
  let startedAt = Number.POSITIVE_INFINITY;
  let endedAt = Number.NEGATIVE_INFINITY;
  for (const chunk of chunks) {
    startedAt = Math.min(startedAt, chunk.startedAt);
    endedAt = Math.max(endedAt, chunk.completedAt ?? chunk.updatedAt);
  }
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return null;
  }
  return { startedAt, endedAt };
}
