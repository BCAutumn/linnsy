// 投影协议核心类型。本文件不依赖 React、不依赖 daemon-api 实现，只暴露纯类型。
// 守住 §3.5 的 4 条不变量（纯函数 / 幂等 / ID 优先 / 回放等价）所需的全部类型抽象。

import type { RuntimeClientEvent } from '../../../lib/daemon-api.js';

// 后续 sprint（S2/S3）会扩展更多 kind；S1 仅实现 user_bubble / assistant_bubble，
// 其余 kind 提前在 union 中预留，避免未来扩展时全量改 switch。
export type ConversationItemKind =
  | 'user_bubble'
  | 'assistant_bubble'
  | 'tool_call_card'
  | 'subagent_summary'
  | 'system_event'
  | 'user_interjection';

// 所有 ConversationItem 的共有字段。
// id 是渲染层 React key 的唯一来源；createdAt 用于跨 item 的排序兜底（首要排序源是 itemOrder）。
export interface ConversationItemBase {
  id: string;
  conversationId: string;
  createdAt: number;
}

// 主人发出的消息。文本只包含 markdown，不含工具调用 / 引用结构等扩展。
export interface UserBubbleItem extends ConversationItemBase {
  kind: 'user_bubble';
  text: string;
  // 后端落库的 messageId；若为本地 optimistic，则等于 clientMessageId。
  messageId: string;
  // optimistic→authoritative 切换时用来定位本地占位的 key；不存在则说明这条已经是后端权威态。
  clientMessageId?: string;
  metadata?: Record<string, unknown>;
}

export interface AssistantThoughtChunk {
  id: string;
  text: string;
  completed: boolean;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  chunks: ReadonlyMap<number, string>;
}

// Linnsy 的回复气泡。流式期 streaming=true，complete 后 streaming 取消并 messageId 切换为权威 ID。
// 同 turnId 的多个 answerId 各自一个 AssistantBubble（多答复段独立渲染，绝不拼接）。
export interface AssistantBubbleItem extends ConversationItemBase {
  kind: 'assistant_bubble';
  text: string;
  streaming: boolean;
  // 流式期由 runId/answerId 派生；complete 时切换为 daemon 给的 messageId。
  messageId: string;
  runId: string;
  answerId: string;
  // chunkSeq → delta 内容的有序映射，用于乱序合并（坑 #6）。
  // 拼接 text 永远以这张映射为准；text 字段是 chunks 的"有序拼接缓存"。
  chunks: ReadonlyMap<number, string>;
  // 思考链属于同一段 assistant 回复的过程信息，渲染为气泡内折叠段，不单开 thought_bubble。
  thoughtChunks: readonly AssistantThoughtChunk[];
  metadata?: Record<string, unknown>;
}

/**
 * 工具调用卡片（一次完整的 tool_call.start → tool_call.result 生命周期）。
 *
 * 状态机：
 *   - 'running'：tool_call.start 创建，args 已知，data/observation/error 暂缺
 *   - 'success'：data 是前端事实源，observation 是 AI 看到的上下文文本
 *   - 'error'：错误已填，errorKind 表明协议错 / 执行错
 *   - 'blocked'：策略层拒绝，没真正"开始执行"过
 */
export interface ToolCallCardItem extends ConversationItemBase {
  kind: 'tool_call_card';
  toolCallId: string;
  toolName: string;
  status: 'running' | 'success' | 'error' | 'blocked';
  args: Record<string, unknown>;
  // linnkit tool_process 的中间过程。默认卡只在展开态渲染；自定义工具卡可按工具语义自行呈现。
  progressChunks?: readonly ToolCallProgressChunk[];
  data?: Record<string, unknown>;
  observation?: string;
  error?: string;
  errorKind?: 'protocol' | 'execution';
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  runId: string;
  turnId?: string;
}

export interface ToolCallProgressChunk {
  id: string;
  phase: 'start' | 'update' | 'complete' | 'error';
  status: 'loading' | 'success' | 'error';
  occurredAt: number;
  detail?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 子 agent 完成汇报。fence 注入到 LLM 的 user role 文本同此 summary，是同一份事实。
 * runId 字段（继承自 ConversationItemBase 不强制）若有，是被唤醒的主 run。
 */
export interface SubagentSummaryItem extends ConversationItemBase {
  kind: 'subagent_summary';
  taskId: string;
  childRunId: string;
  childConversationId: string;
  summary: string;
  // 子 run 汇报前的过程行，来自 linnkit subrun_trace。最终 summary 到达后仍保留，便于展开观察。
  progressChunks?: readonly SubagentProgressChunk[];
}

export interface SubagentProgressChunk {
  id: string;
  parentToolCallId: string;
  kind: 'thought_delta' | 'thought_complete' | 'tool_call_decision' | 'tool_process' | 'tool_output' | 'final_answer_chunk' | 'final_answer';
  occurredAt: number;
  status?: 'loading' | 'success' | 'error';
  toolName?: string;
  toolCallId?: string;
  phase?: 'start' | 'update' | 'complete' | 'error';
  detail?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 系统事件：cron 触发 / 外部 agent 执行提示。
 * task_status_change 已退出 runtime event wire 协议；任务终态只作为 LLM context fence 唤醒主秘书。
 * channel_status 保留为诊断事件，但不投影成对话气泡。
 * 不含 user_interjection（后者独立为 UserInterjectionItem，渲染语义不同）。
 */
export interface SystemEventItem extends ConversationItemBase {
  kind: 'system_event';
  sourceKind: 'cron' | 'task_execution_notice';
  detail: string;
  refId?: string;
  occurredAt: number;
}

/**
 * 主人在 LLM 回复期间的中途插话——daemon 端走 system.event(sourceKind='user_interjection')，
 * 前端按"插话气泡"独立渲染（与 cron/task/channel 视觉不同）。
 */
export interface UserInterjectionItem extends ConversationItemBase {
  kind: 'user_interjection';
  detail: string;
  refId?: string;
  occurredAt: number;
  runId?: string;
}

// 所有渲染目标的并集。Message.tsx 按 item.kind switch 分发。
export type ConversationItem =
  | UserBubbleItem
  | AssistantBubbleItem
  | ToolCallCardItem
  | SubagentSummaryItem
  | SystemEventItem
  | UserInterjectionItem;

// 投影器消费的事件信封。直接复用 daemon-api 的 RuntimeClientEvent，避免重复定义。
// 注意：未来若要让投影器在 daemon 端 / 测试中独立运行，可再做一次同构抽象。
export type EventEnvelope = RuntimeClientEvent;
