import type { CronListEntry, CronRunOutput, CronRunSummary } from '../../lib/daemon-api.js';
import type { I18nKey, I18nParams } from '../../lib/i18n.js';

/**
 * 定时页首屏 / 操作条带的错误：存 key 或原文，渲染时用当前语言翻译，换语言后文案立即更新。
 */
export type ScheduledLoadError =
  | { kind: 'i18n'; key: I18nKey; params?: I18nParams }
  | { kind: 'raw'; message: string };

/** 列表与首屏加载状态（reminders + 全局错误）。 */
export type LoadState =
  | { status: 'idle' | 'loading'; reminders: CronListEntry[]; error: null }
  | { status: 'ready'; reminders: CronListEntry[]; error: null }
  | { status: 'error'; reminders: CronListEntry[]; error: ScheduledLoadError };

/** 单条 reminder 对应的历史执行列表加载状态。 */
export type HistoryState =
  | { status: 'loading' }
  | { status: 'ready'; runs: CronRunSummary[] }
  | { status: 'error'; error: string };

/** 单次执行的输出拉取状态。 */
export type OutputState =
  | { status: 'loading' }
  | { status: 'ready'; output: CronRunOutput }
  | { status: 'error'; error: string };

/**
 * 历史区所需上下文：列表状态、按 runId 索引的输出、跳转对话回调。
 * 由列表层构造，行内历史组件只读消费，避免层层透传过多单参数。
 */
export interface ScheduledHistoryContext {
  state: HistoryState | undefined;
  outputs: Record<string, OutputState>;
  onOpenConversation(conversationId: string, finishedAt?: number): void;
}

// 2026-05-05 拍板（详见 docs/product/scenarios.md §3.3）：每条 reminder 直接展示
// 最近 N 条历史执行，不做"展开 / 收起"折叠交互——和"Linnsy 是一个人"的心智一致：
// 像看朋友的最近留言，不是点开一个 agent 的报表面板。
/** 每条 reminder 并行拉取的历史条数上限。 */
export const HISTORY_PER_ROW = 5;
