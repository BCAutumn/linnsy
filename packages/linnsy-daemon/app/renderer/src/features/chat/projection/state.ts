// ProjectionState 数据结构。所有字段都是 ReadonlyMap / ReadonlySet / readonly array，
// reducer 内部必须返回新引用而不是原地修改（守不变量 #1 纯函数 + #3 immutability）。

import type { ConversationItem } from './types.js';

export interface ProjectionState {
  // 主键索引：itemId → item。
  itemsById: ReadonlyMap<string, ConversationItem>;
  // 渲染顺序：item 首次出现的顺序，永不重排。
  // selectAllItems(state) 用它把 itemsById 串成数组。
  itemOrder: readonly string[];

  // 幂等闸门：已 reduce 过的 eventId 集合。重复 eventId 直接 no-op（守坑 #1/#9）。
  // 注：长会话需要剪枝策略，S1 先无界保留，S5 阶段评估。详见 §3.5 注释。
  seenEventIds: ReadonlySet<string>;

  // 当前 conversation 的标识；不属于该 conversation 的事件被 reduce 跳过（守坑 #8）。
  // null 表示尚未选定 conversation（启动初态）。
  conversationId: string | null;

  // streaming 期：runId → 该 run 当前正在写入的 AssistantBubble itemId。
  // 用于"找到流式 item 然后 append delta"（守坑 #3）。
  // 注：同 runId 多 answerId 时，本表只保留最新 active answerId 的 itemId；
  // 历史 answerId 的 item 仍在 itemsById 中，但 delta 不再继续追加。
  streamingItemIdByRun: ReadonlyMap<string, string>;

  // 同 runId 已结束的运行 id 集合：message.complete 或终态 run.status_change 都会写入。
  // 后续迟到的 delta 见到此集合直接丢弃（守坑 #4）。
  settledRunIds: ReadonlySet<string>;

  // 工具调用索引：toolCallId → itemId（当前对话内）。
  // tool_call.start 创建 ToolCallCardItem 时写入；tool_call.result 来时按 toolCallId 找到
  // 对应卡片，把 status / result / error 等字段填上。daemon 端 toolCallId 由 linnkit ToolNode
  // 注入（context.parentToolCallId），保证全 run 唯一。
  toolCallsById: ReadonlyMap<string, string>;
}

export function createInitialState(conversationId: string | null = null): ProjectionState {
  return {
    itemsById: new Map(),
    itemOrder: [],
    seenEventIds: new Set(),
    conversationId,
    streamingItemIdByRun: new Map(),
    settledRunIds: new Set(),
    toolCallsById: new Map()
  };
}
