/**
 * 2026-05-05 X1 自适应展示阈值（详见 docs/product/scenarios.md §3.3）：
 * 单次定时执行的"产物"是否算"任务型"由两个条件判定，满足任意一个即在历史
 * 时间线那一行追加一个"查看完整对话"跳转：
 * 1. summaryText 长度 >= SCHEDULED_OUTPUT_SUMMARY_THRESHOLD（默认 200 字符）
 * 2. 调过 delegate_to_internal / delegate_to_external（或注入了
 *    `<subagent-summary>` 围栏文本）
 *
 * 注意：前端不在历史区贴长摘要——任务型也只显示跳转，遵循"是一个人不是 Agent"
 * 的扁平心智。阈值集中放在这里，便于以后调整。
 */

export const SCHEDULED_OUTPUT_SUMMARY_THRESHOLD = 200;

export interface ScheduledOutputSignal {
  summaryLength: number;
  hasSubagentSummary: boolean;
}

export function isTaskLikeScheduledOutput(signal: ScheduledOutputSignal): boolean {
  if (signal.hasSubagentSummary) {
    return true;
  }
  return signal.summaryLength >= SCHEDULED_OUTPUT_SUMMARY_THRESHOLD;
}
