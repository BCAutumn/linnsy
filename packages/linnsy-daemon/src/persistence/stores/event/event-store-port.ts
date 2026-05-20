import type { RuntimeEvent, RuntimeEventEnvelope } from '../../../domains/observability/definitions/runtime-events.js';

// 持久化层读出来的事件用共享的 RuntimeEventEnvelope（宽松 payload）表达。
// 字段约束 / 不变量见 domains/observability/definitions/runtime-events.ts。
export type StoredRuntimeEvent = RuntimeEventEnvelope;

export interface ListEventsOptions {
  sinceSeq?: number;
  limit?: number;
}

export interface ListEventsResult {
  events: StoredRuntimeEvent[];
  nextCursor?: string;
}

export interface ConversationActivityMarker {
  markActivity(conversationId: string, activityAt: number): boolean;
}

export interface EventStorePort {
  append(event: RuntimeEvent): void;
  readMaxSeq(): number;
  listByConversation(conversationId: string, options?: ListEventsOptions): ListEventsResult;
  list(options?: ListEventsOptions): ListEventsResult;
}
