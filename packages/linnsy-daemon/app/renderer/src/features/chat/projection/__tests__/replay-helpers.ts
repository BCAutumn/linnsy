// golden-replay 测试专用：把"录制的事件序列"转成"等价的 ConversationMessage[]"，
// 用以模拟历史 readMessages 路径。
//
// 转换规则：
//   - message.inbound  → 一条 ConversationMessage（user 或 assistant 的入站态）
//   - message.complete → 一条 ConversationMessage（assistant outbound 的最终态，覆盖任何同 messageId 早期 inbound）
//   - message.delta    → 忽略（历史 messages 表只存最终态，不存 chunk）

import type { ConversationMessage } from '../../../../lib/daemon-api.js';
import type { EventEnvelope } from '../types.js';

export function eventsToMessages(events: readonly EventEnvelope[]): ConversationMessage[] {
  const byId = new Map<string, ConversationMessage>();
  const order: string[] = [];
  for (const event of events) {
    if (event.kind !== 'message.inbound' && event.kind !== 'message.complete') continue;
    const message = readMessage(event);
    if (message === null) continue;
    if (!byId.has(message.messageId)) {
      order.push(message.messageId);
    }
    byId.set(message.messageId, message);
  }
  return order.map((id) => {
    const message = byId.get(id);
    if (message === undefined) throw new Error('unreachable: missing message in eventsToMessages');
    return message;
  });
}

function readMessage(event: EventEnvelope): ConversationMessage | null {
  // EventEnvelope.payload 的运行时类型由 daemon observability runtime-events 契约严格保证为 Record<string, unknown>，
  // 所以这里无需再检查 null/object——只需要看 message 字段是否符合 ConversationMessage 形态。
  const maybe = (event.payload as { message?: unknown }).message;
  if (typeof maybe !== 'object' || maybe === null) return null;
  // 信任 fixtures.ts 写的是合法 ConversationMessage 形态。
  return { ...(maybe as ConversationMessage) };
}
