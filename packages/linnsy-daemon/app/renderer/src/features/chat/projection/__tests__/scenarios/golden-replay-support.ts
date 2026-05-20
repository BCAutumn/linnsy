import { expect } from 'vitest';

import { createInitialState } from '../../state.js';
import { reduce, reduceAll } from '../../reducer.js';
import { hydrateFromMessages, hydrateFromMessagesAndEvents } from '../../hydration.js';
import { selectAllItems } from '../../helpers/selectors.js';
import {
  complete,
  delta,
  inbound,
  legacyTaskStatusSystemEvent,
  resetFixtureCounters,
  subagentProgress,
  subagentSummary,
  systemEvent,
  thoughtComplete,
  thoughtDelta,
  toolCallProgress,
  toolCallResult,
  toolCallStart
} from '../fixtures.js';
import { eventsToMessages } from '../replay-helpers.js';
import type { RuntimeEventEnvelope } from '@renderer/contracts';
import type { EventEnvelope } from '../../types.js';

// 使用与 fixtures 默认一致的 conversationId，避免 reduceInbound 因跨会话保护跳过事件。
export const conversationId = 'conv_test';

// ⭐ 不变量（计划文档 §3.5 第 4 条 · 回放等价）：
//   reduceAll(events).items === hydrateFromMessages(eventsToMessages(events)).items
export function assertReplayEquivalent(events: readonly EventEnvelope[]): void {
  const realtimeState = reduceAll(createInitialState(conversationId), events);
  const realtimeItems = selectAllItems(realtimeState);
  const messages = eventsToMessages(events).filter((message) => {
    return message.conversationId === undefined || message.conversationId === conversationId;
  });
  const hydratedState = hydrateFromMessages(conversationId, messages);
  const hydratedItems = selectAllItems(hydratedState);
  expect(hydratedItems).toEqual(realtimeItems);
}

export function assertDualSourceReplayEquivalent(events: readonly EventEnvelope[]): void {
  const realtimeState = reduceAll(createInitialState(conversationId), events);
  const realtimeItems = selectAllItems(realtimeState);
  const messages = eventsToMessages(events).filter((message) => {
    return message.conversationId === undefined || message.conversationId === conversationId;
  });
  const hydratedState = hydrateFromMessagesAndEvents(
    conversationId,
    messages,
    toPersistedTimelineEvents(events)
  );
  const hydratedItems = selectAllItems(hydratedState);
  expect(hydratedItems).toEqual(realtimeItems);
}

const PERSISTED_TIMELINE_EVENT_KINDS = [
  'message.delta',
  'message.thought_delta',
  'message.thought_complete',
  'tool_call.start',
  'tool_call.progress',
  'tool_call.result',
  'subagent.progress',
  'subagent.summary',
  'system.event'
] as const;

export function toPersistedTimelineEvents(events: readonly EventEnvelope[]): RuntimeEventEnvelope[] {
  return events.filter((event) => {
    return (PERSISTED_TIMELINE_EVENT_KINDS as readonly string[]).includes(event.kind);
  });
}


export { createInitialState, reduce, reduceAll, hydrateFromMessages, hydrateFromMessagesAndEvents, selectAllItems, complete, delta, inbound, legacyTaskStatusSystemEvent, resetFixtureCounters, subagentProgress, subagentSummary, systemEvent, thoughtComplete, thoughtDelta, toolCallProgress, toolCallResult, toolCallStart, eventsToMessages };
export type { RuntimeEventEnvelope, EventEnvelope };
