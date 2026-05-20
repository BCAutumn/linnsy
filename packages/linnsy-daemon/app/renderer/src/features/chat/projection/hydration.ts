// 历史回放唯一入口。
//
// 设计原则：把 ConversationMessage[] + RuntimeEventEnvelope[] 都转成 / 合并成一条
// 时间线后走同一个 reduce，不另写一份"历史→state"逻辑。这是 §3.5 第 4 条不变量
// "回放等价"的实现保证：
//   reduceAll(events) === hydrateFromMessagesAndEvents(toMessages(events), filterNonMessage(events))
//
// 因此 reducer 行为升级时（比如 S2 加新事件 kind），hydration 只需要把对应历史
// 形态映射成同样的事件，不会出现"实时态有 ToolCallCard、回放态没有"这种漂移。
//
// 双源策略（S2.4）：
//   - messages 表是消息状态权威源；events 表是 S2 新加的事件流原始日志
//   - daemon 当前会把 message.* 事件**也**写进 events 表（event-hub.publish → persistence.append）
//     → 直接合并会重复
//   - 选择：messages 派生 message.* 事件；events 表只取**非 message.\*** 事件
//     这样既兼容旧消息（events 表里没记录），又对 S2 引入的 tool_call.* / subagent.summary /
//     system.event / run.status_change 形成补全
//   - 二者按 (createdAt asc, seq asc) 整体排序后走 reduceAll

import type { ConversationMessage } from '../../../lib/daemon-api.js';
import type { RuntimeEventEnvelope } from '@renderer/contracts';
import { createInitialState, type ProjectionState } from './state.js';
import { reduceAll } from './reducer.js';
import type { EventEnvelope } from './types.js';

export function hydrateFromMessages(
  conversationId: string,
  messages: readonly ConversationMessage[]
): ProjectionState {
  return hydrateFromMessagesAndEvents(conversationId, messages, []);
}

export function hydrateFromMessagesAndEvents(
  conversationId: string,
  messages: readonly ConversationMessage[],
  events: readonly RuntimeEventEnvelope[]
): ProjectionState {
  const initial = createInitialState(conversationId);
  const messageEvents = [...messages]
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((message, index) => toEventFromMessage(conversationId, message, index));

  // events 表里的 message.inbound / message.complete 与 messages 派生的同义重叠，过滤掉以避免双源重复。
  // message.delta 必须保留：同一个 run 内多 answerId 的早期答复段只存在于事件流里，
  // messages 表只存最终 outbound；过滤 delta 会导致刷新后丢掉"先答 A → 工具 → 再答 B"里的 A。
  const HYDRATION_EVENT_KINDS = [
    'message.delta',
    'message.thought_delta',
    'message.thought_complete',
    'run.status_change',
    'tool_call.start',
    'tool_call.progress',
    'tool_call.result',
    'subagent.progress',
    'subagent.summary',
    'system.event'
  ] as const;
  type HydrationEventKind = (typeof HYDRATION_EVENT_KINDS)[number];
  const isHydrationEventKind = (kind: string): kind is HydrationEventKind =>
    (HYDRATION_EVENT_KINDS as readonly string[]).includes(kind);
  const persistedTimelineEvents = events.filter((event) => isHydrationEventKind(event.kind));

  // 时间线合并：先按 createdAt 升序；同 createdAt 时 events 表的"原 seq"优先，
  // messages 派生事件靠后（messages 派生事件的 seq 是 hydrate 内部计数，没法跟 events 表混排）。
  // 现实场景下 createdAt 同毫秒的概率极低，先以这种规则简单合并即可，等观察到 race 再加权。
  const merged: EventEnvelope[] = [...messageEvents, ...persistedTimelineEvents].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return left.seq - right.seq;
  });
  if (merged.length === 0) return initial;
  return reduceAll(initial, merged);
}

function toEventFromMessage(conversationId: string, message: ConversationMessage, index: number): EventEnvelope {
  const eventId = `hydrate:${message.messageId}`;
  const seq = index + 1;
  const messagePayload: ConversationMessage = {
    ...message,
    conversationId: message.conversationId ?? conversationId
  };

  if (message.role === 'user') {
    return {
      eventId,
      seq,
      kind: 'message.inbound',
      createdAt: message.createdAt,
      conversationId,
      messageId: message.messageId,
      payload: { message: messagePayload }
    };
  }

  return {
    eventId,
    seq,
    kind: 'message.complete',
    createdAt: message.createdAt,
    conversationId,
    messageId: message.messageId,
    ...(message.runId === undefined ? {} : { runId: message.runId }),
    payload: { message: messagePayload }
  };
}
