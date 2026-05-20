// Runtime 事件协议 · 前后端共享类型源。
//
// 这一份是 daemon publish 与 renderer 消费的唯一真相源。任何 kind 的新增 / 字段变更都必须
// 改这个文件 → daemon `event-hub.ts` 同步 → renderer `daemon-api.ts` 同步——三方一起改。
//
// 设计原则：
//   1. 用 discriminated union（按 `kind` 收敛 payload 类型），禁止 `Record<string, unknown>` 兜底。
//   2. payload 字段必须严格定义，可选字段必须显式标注 `?`，不允许 any/unknown。
//   3. 顶层字段（eventId/seq/conversationId/runId/createdAt）按当前实现保留。

/**
 * 工具调用执行状态。
 *   - success: 工具执行成功，data 字段给前端渲染，observation 字段给 LLM 继续推理
 *   - error: 工具执行抛错（errorKind='execution'）或参数 / 协议错（errorKind='protocol'）
 *   - blocked: 被 policy-scoped runtime 在策略层禁止执行（status='blocked'，无 data/observation）
 */
export type ToolCallStatus = 'success' | 'error' | 'blocked';

export type ToolCallErrorKind = 'protocol' | 'execution';

export type RuntimeRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * `system.event` 的来源类别。新增类别时同步更新本 union 与对应触发点。
 *   - cron: cron-scheduler 触发提醒 / 定时任务
 *   - user_interjection: 主人在 LLM 回复期间中途插话
 *   - task_execution_notice: 外部 agent 任务完成后的轻量时间线提示，不包含状态机细节
 *   - channel_status: channel adapter 状态变更（连接 / 断开 / 重连），只作运行诊断，不默认展示成对话气泡
 *
 * 注意：LLM 上下文里的 `<system-event kind="task_status_change">` 是 FenceRegistry 的
 * attrs.kind，不是这个 runtime event sourceKind。任务终态仍走 context fence 唤醒主秘书；
 * 前端/持久化 runtime event 协议不再允许新发布 task_status_change。
 */
export type SystemEventSourceKind =
  | 'cron'
  | 'user_interjection'
  | 'task_execution_notice'
  | 'channel_status';

export type ConversationVisibleSystemEventSourceKind = Extract<
  SystemEventSourceKind,
  'cron' | 'user_interjection' | 'task_execution_notice'
>;

export const SYSTEM_EVENT_SOURCE_KINDS: readonly SystemEventSourceKind[] = [
  'cron',
  'user_interjection',
  'task_execution_notice',
  'channel_status'
] as const;

const SYSTEM_EVENT_SOURCE_KIND_SET: ReadonlySet<SystemEventSourceKind> = new Set(SYSTEM_EVENT_SOURCE_KINDS);

export function isSystemEventSourceKind(value: unknown): value is SystemEventSourceKind {
  return typeof value === 'string' && (SYSTEM_EVENT_SOURCE_KIND_SET as ReadonlySet<string>).has(value);
}

export function isConversationVisibleSystemEventSourceKind(
  sourceKind: SystemEventSourceKind
): sourceKind is ConversationVisibleSystemEventSourceKind {
  return sourceKind === 'cron' ||
    sourceKind === 'user_interjection' ||
    sourceKind === 'task_execution_notice';
}

// ============================================================================
// payload 类型：每个 kind 一份
// ============================================================================

export interface MessageInboundPayload {
  // 已序列化的 ConversationMessage 形态（参考 sqlite-message-store.ts MessageRecord）
  message: {
    messageId: string;
    conversationId?: string;
    role: string;
    source: string;
    text?: string;
    runId?: string;
    metadata?: Record<string, unknown>;
    streaming?: boolean;
    createdAt: number;
  };
}

export type MessageCompletePayload = MessageInboundPayload;

export interface MessageDeltaPayload {
  turnId: string;
  answerId: string;
  chunkSeq: number;
  delta: string;
}

export interface MessageThoughtDeltaPayload {
  turnId: string;
  thoughtId: string;
  chunk: string;
  chunkSeq: number;
}

export interface MessageThoughtCompletePayload {
  turnId: string;
  thoughtId: string;
  text: string;
}

export interface RunStatusChangePayload {
  status: RuntimeRunStatus;
  updatedAt?: number;
}

export interface ToolCallStartPayload {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  turnId?: string;
  startedAt: number;
}

export interface ToolCallResultPayload {
  toolCallId: string;
  toolName: string;
  status: ToolCallStatus;
  // data 是前端工具卡渲染的结构化事实源；observation 是 LLM 看到的工具结果。
  data?: Record<string, unknown>;
  observation?: string;
  error?: string;
  errorKind?: ToolCallErrorKind;
  durationMs: number;
  endedAt: number;
}

export interface ToolCallProgressPayload {
  toolCallId: string;
  toolName: string;
  phase: 'start' | 'update' | 'complete' | 'error';
  status: 'loading' | 'success' | 'error';
  occurredAt: number;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface SubagentSummaryPayload {
  taskId: string;
  childRunId: string;
  childConversationId: string;
  summary: string;
}

export interface SubagentProgressPayload {
  childRunId: string;
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

export interface SystemEventPayload {
  sourceKind: SystemEventSourceKind;
  // 用大白话写清事件事实；是否给主人展示由消费方按 sourceKind 决定
  detail: string;
  // 当 sourceKind 为 task_execution_notice 时为 taskId；channel_status 时为 channelId；cron 时为 jobId
  refId?: string;
  occurredAt: number;
}

// ============================================================================
// RuntimeEvent · 完整 union
// ============================================================================

interface RuntimeEventBase {
  eventId: string;
  seq: number;
  createdAt: number;
  conversationId?: string;
  messageId?: string;
  runId?: string;
}

export type RuntimeEvent =
  | (RuntimeEventBase & { kind: 'message.inbound'; payload: MessageInboundPayload })
  | (RuntimeEventBase & { kind: 'message.delta'; payload: MessageDeltaPayload })
  | (RuntimeEventBase & { kind: 'message.thought_delta'; payload: MessageThoughtDeltaPayload })
  | (RuntimeEventBase & { kind: 'message.thought_complete'; payload: MessageThoughtCompletePayload })
  | (RuntimeEventBase & { kind: 'message.complete'; payload: MessageCompletePayload })
  | (RuntimeEventBase & { kind: 'run.status_change'; payload: RunStatusChangePayload })
  | (RuntimeEventBase & { kind: 'tool_call.start'; payload: ToolCallStartPayload })
  | (RuntimeEventBase & { kind: 'tool_call.progress'; payload: ToolCallProgressPayload })
  | (RuntimeEventBase & { kind: 'tool_call.result'; payload: ToolCallResultPayload })
  | (RuntimeEventBase & { kind: 'subagent.progress'; payload: SubagentProgressPayload })
  | (RuntimeEventBase & { kind: 'subagent.summary'; payload: SubagentSummaryPayload })
  | (RuntimeEventBase & { kind: 'system.event'; payload: SystemEventPayload });

export type RuntimeEventKind = RuntimeEvent['kind'];

/**
 * Wire / 持久化层"宽松"事件信封：顶层结构与 RuntimeEvent 完全一致，但 payload
 * 仅做了基础形态校验（Record<string, unknown>），未按 kind 收敛到 discriminated union。
 *
 * 为什么需要它：
 *   - SQLite 反序列化拿到的是 JSON 对象，没法在编译期保证 payload 字段齐全；
 *   - 前端 WS 帧守卫 `isRuntimeClientEvent` 也只能校验顶层字段；
 *   - dashboard `pollEvents` 直接转发 hub 的事件，要兼容上述两种来源。
 *
 * 由消费端（投影 reducer）按 `kind` 分发后再做严格 payload 校验。这样避免了
 * "store 层 / parse 层 / reducer 层各做一遍 payload 校验"的重复劳动。
 */
export interface RuntimeEventEnvelope {
  eventId: string;
  seq: number;
  kind: RuntimeEventKind;
  createdAt: number;
  conversationId?: string;
  messageId?: string;
  runId?: string;
  payload: Record<string, unknown>;
}

// 全部 kind 的运行时集合。daemon publish 与 renderer parse 都从这里读，
// 避免硬编码 if/else 漏新 kind（此前 renderer 的 isRuntimeEventKind 白名单就栽过这个坑）。
export const RUNTIME_EVENT_KINDS: readonly RuntimeEventKind[] = [
  'message.inbound',
  'message.delta',
  'message.thought_delta',
  'message.thought_complete',
  'message.complete',
  'run.status_change',
  'tool_call.start',
  'tool_call.progress',
  'tool_call.result',
  'subagent.progress',
  'subagent.summary',
  'system.event'
] as const;

const KIND_SET: ReadonlySet<RuntimeEventKind> = new Set(RUNTIME_EVENT_KINDS);

export function isRuntimeEventKind(value: unknown): value is RuntimeEventKind {
  return typeof value === 'string' && (KIND_SET as ReadonlySet<string>).has(value);
}

// ============================================================================
// publish 输入：discriminated union 严格收敛 payload
// ============================================================================

interface RuntimeEventPublishInputBase {
  conversationId?: string;
  messageId?: string;
  runId?: string;
  createdAt?: number;
}

export type RuntimeEventPublishInput =
  | (RuntimeEventPublishInputBase & { kind: 'message.inbound'; payload: MessageInboundPayload })
  | (RuntimeEventPublishInputBase & { kind: 'message.delta'; payload: MessageDeltaPayload })
  | (RuntimeEventPublishInputBase & { kind: 'message.thought_delta'; payload: MessageThoughtDeltaPayload })
  | (RuntimeEventPublishInputBase & { kind: 'message.thought_complete'; payload: MessageThoughtCompletePayload })
  | (RuntimeEventPublishInputBase & { kind: 'message.complete'; payload: MessageCompletePayload })
  | (RuntimeEventPublishInputBase & { kind: 'run.status_change'; payload: RunStatusChangePayload })
  | (RuntimeEventPublishInputBase & { kind: 'tool_call.start'; payload: ToolCallStartPayload })
  | (RuntimeEventPublishInputBase & { kind: 'tool_call.progress'; payload: ToolCallProgressPayload })
  | (RuntimeEventPublishInputBase & { kind: 'tool_call.result'; payload: ToolCallResultPayload })
  | (RuntimeEventPublishInputBase & { kind: 'subagent.progress'; payload: SubagentProgressPayload })
  | (RuntimeEventPublishInputBase & { kind: 'subagent.summary'; payload: SubagentSummaryPayload })
  | (RuntimeEventPublishInputBase & { kind: 'system.event'; payload: SystemEventPayload });
