// ID 派生与校验。所有派生函数都是纯函数 + 确定性输出，绝不读时间或随机数。

// 流式期 AssistantBubble 的 itemId。complete 到达后会切换为 daemon 给的权威 messageId。
// 形态：`stream:${runId}:${answerId}`，便于调试与正则定位。
export function streamingAssistantItemId(runId: string, answerId: string): string {
  return `stream:${runId}:${answerId}`;
}

export function thoughtAssistantItemId(runId: string, thoughtId: string): string {
  return `stream:${runId}:thought:${thoughtId}`;
}

// 历史 hydrate 出来的 UserBubble itemId 直接取 messageId。
// 同 messageId 不会出现两次（坑 #4 inbound 幂等）。
export function userBubbleItemId(messageId: string): string {
  return messageId;
}

// 历史/收尾后的 AssistantBubble itemId 也直接取 messageId（与 streamingAssistantItemId 共用同一 key 空间，
// 但写入逻辑保证："同一条逻辑回复在生命周期内只占一个 itemId 槽"——complete 时把流式 itemId 替换为 messageId）。
export function settledAssistantItemId(messageId: string): string {
  return messageId;
}

// 工具调用卡片 itemId：直接取 toolCallId（daemon 端由 linnkit ToolNode 注入，全 run 唯一）。
// 这样 tool_call.start / tool_call.result 两个事件天然按 itemId 匹配，无需额外索引——
// 但保留 toolCallsById 索引以应对未来 toolCallId 来源变更（当前是冗余但便于演进）。
export function toolCallItemId(toolCallId: string): string {
  return `tool:${toolCallId}`;
}

// 子 agent 汇报 itemId：用 childRunId 派生（一个子 run 只汇报一次）。
export function subagentSummaryItemId(childRunId: string): string {
  return `subagent:${childRunId}`;
}

// 系统事件 itemId：用 eventId 派生（每个事件一张气泡，绝不合并）。
// 这样幂等：同 eventId 第二次 reduce 命中 seenEventIds 闸门 → no-op；
// 即使闸门绕过，appendItem 也走 replaceItem 而不重复添加。
export function systemEventItemId(eventId: string): string {
  return `sys:${eventId}`;
}

// 主人插话 itemId：与 system_event 同源（都来自 system.event 事件），但映射到不同 ConversationItemKind。
export function userInterjectionItemId(eventId: string): string {
  return `interjection:${eventId}`;
}

// 校验 string 不为空（trim 后长度 > 0）。
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
