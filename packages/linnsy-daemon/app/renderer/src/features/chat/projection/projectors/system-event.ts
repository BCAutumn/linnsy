// system.event 投影器：根据 sourceKind 映射到不同的 ConversationItemKind。
//
//   - sourceKind='user_interjection'   → UserInterjectionItem（"插话气泡"，渲染样式独立）
//   - sourceKind='cron' → SystemEventItem（"系统通知"样式）
//   - sourceKind='task_execution_notice' → SystemEventItem（外部 agent 终态时间线提示）
//   - sourceKind='channel_status' → 对话流静默忽略；右上角/通道设置已有专门状态入口
//   - 历史 task_status_change → 共享协议不再承认，payload reader 会静默丢弃
//
// 守住的不变量：
//   - 一个 eventId 一张气泡，重复事件 no-op（itemId 由 eventId 派生 → 天然不重）
//   - 跨会话隔离

import type { ProjectionState } from '../state.js';
import type { EventEnvelope, SystemEventItem, UserInterjectionItem } from '../types.js';
import { systemEventItemId, userInterjectionItemId } from '../helpers/ids.js';
import { appendItem } from '../helpers/item-ops.js';
import { readSystemEventPayload } from '../helpers/payload-readers.js';
import { isConversationVisibleSystemEventSourceKind } from '@renderer/contracts';

export function reduceSystemEvent(state: ProjectionState, event: EventEnvelope): ProjectionState {
  const payload = readSystemEventPayload(event.payload);
  if (payload === null) return state;
  if (state.conversationId !== null && event.conversationId !== state.conversationId) {
    return state;
  }

  if (payload.sourceKind === 'user_interjection') {
    const itemId = userInterjectionItemId(event.eventId);
    if (state.itemsById.has(itemId)) return state;
    const item: UserInterjectionItem = {
      kind: 'user_interjection',
      id: itemId,
      conversationId: event.conversationId ?? '',
      createdAt: event.createdAt,
      detail: payload.detail,
      occurredAt: payload.occurredAt,
      ...(payload.refId === undefined ? {} : { refId: payload.refId }),
      ...(event.runId === undefined ? {} : { runId: event.runId })
    };
    return appendItem(state, item);
  }

  // 是否给主人展示统一由共享事件协议决定，避免前后端活动规则各自漂移。
  if (!isConversationVisibleSystemEventSourceKind(payload.sourceKind)) {
    return state;
  }

  // 其余 sourceKind（cron / task_execution_notice）→ 系统通知气泡。
  const itemId = systemEventItemId(event.eventId);
  if (state.itemsById.has(itemId)) return state;
  const item: SystemEventItem = {
    kind: 'system_event',
    id: itemId,
    conversationId: event.conversationId ?? '',
    createdAt: event.createdAt,
    sourceKind: payload.sourceKind,
    detail: payload.detail,
    occurredAt: payload.occurredAt,
    ...(payload.refId === undefined ? {} : { refId: payload.refId })
  };
  return appendItem(state, item);
}
