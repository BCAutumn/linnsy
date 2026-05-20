import { markConversationVisibleActivity, moveConversationToTopAfterMessage } from './conversations/list-ops.js';
import type { ConversationMessage, RuntimeClientEvent } from './daemon-api.js';
import { t } from './i18n.js';
import { reduce as reduceProjection } from '../features/chat/projection/reducer.js';
import type { ChatAppState } from '../stores/chat-app-state.js';
import {
  isConversationVisibleSystemEventSourceKind,
  isSystemEventSourceKind,
  type SystemEventSourceKind
} from '@renderer/contracts';

// 把 daemon 推过来的 RuntimeClientEvent 投影到 ChatAppState：
//   - projection: 走 features/chat/projection/reducer.ts 的纯函数 reducer，是渲染层的真相源
//   - conversations: 仅根据 inbound / complete 事件的 message text 更新会话列表元数据
//   - status: 反映 sending / replying / connected
//
// 注：自 S1.7 起本文件不再维护任何 message 数组，所有消息 / 流式 / 工具调用 / 子 agent
// 渲染数据都由 projection 提供。本文件的职责仅限于"事件 → ChatAppState 顶层副作用"。
export function applyRuntimeClientEvent(state: ChatAppState, event: RuntimeClientEvent): ChatAppState {
  const projection = reduceProjection(state.projection, event);

  if (event.kind === 'message.delta') {
    if (projection === state.projection) {
      return state;
    }
    return {
      ...state,
      projection,
      status: t(state.preferences.language, 'connectionStatusReplying')
    };
  }

  if (event.kind !== 'message.inbound' && event.kind !== 'message.complete') {
    const activityAt = readVisibleActivityAt(event);
    if (activityAt !== null) {
      return {
        ...state,
        conversations: markConversationVisibleActivity(
          state.conversations,
          event.conversationId,
          activityAt
        ),
        projection
      };
    }
    if (projection === state.projection) {
      return state;
    }
    return { ...state, projection };
  }

  const message = readMessagePayload(event);
  if (message === null) {
    if (projection === state.projection) {
      return state;
    }
    return { ...state, projection };
  }

  const conversations = moveConversationToTopAfterMessage(
    state.conversations,
    message.conversationId,
    {
      text: message.text ?? '',
      role: message.role,
      source: message.source,
      updatedAt: message.createdAt
    }
  );

  if (message.conversationId !== state.selectedConversationId) {
    return {
      ...state,
      conversations,
      projection
    };
  }

  return {
    ...state,
    conversations,
    projection,
    status: event.kind === 'message.inbound'
      ? t(state.preferences.language, 'connectionStatusSent')
      : t(state.preferences.language, 'connectionStatusConnected')
  };
}

function readVisibleActivityAt(event: RuntimeClientEvent): number | null {
  switch (event.kind) {
    case 'subagent.summary':
      return event.createdAt;
    case 'system.event':
      return readVisibleSystemEventSourceKind(event) === null ? null : event.createdAt;
    default:
      return null;
  }
}

function readVisibleSystemEventSourceKind(event: RuntimeClientEvent): SystemEventSourceKind | null {
  const sourceKind = event.payload.sourceKind;
  return isSystemEventSourceKind(sourceKind) && isConversationVisibleSystemEventSourceKind(sourceKind)
    ? sourceKind
    : null;
}

export function applyRuntimeClientEvents(
  state: ChatAppState,
  events: readonly RuntimeClientEvent[]
): ChatAppState {
  let next = state;
  for (const event of events) {
    next = applyRuntimeClientEvent(next, event);
  }
  return next;
}

function readMessagePayload(event: RuntimeClientEvent): ConversationMessage | null {
  // 调用本函数前 caller 已经判定 event.kind 是 message.inbound / message.complete；
  // 这两种 kind 的 payload 形态都是 { message: ConversationMessage }（共享类型保证）。
  if (event.kind !== 'message.inbound' && event.kind !== 'message.complete') {
    return null;
  }
  const rawMessage: unknown = event.payload.message;
  if (!isRecord(rawMessage)) {
    return null;
  }
  if (
    typeof rawMessage.messageId !== 'string' ||
    typeof rawMessage.role !== 'string' ||
    typeof rawMessage.source !== 'string' ||
    typeof rawMessage.createdAt !== 'number'
  ) {
    return null;
  }
  const message: ConversationMessage = {
    messageId: rawMessage.messageId,
    role: rawMessage.role,
    source: rawMessage.source,
    createdAt: rawMessage.createdAt
  };
  const conversationId = readString(rawMessage.conversationId) ?? event.conversationId;
  if (conversationId !== undefined) {
    message.conversationId = conversationId;
  }
  const text = readString(rawMessage.text);
  if (text !== undefined) {
    message.text = text;
  }
  const runId = readString(rawMessage.runId) ?? event.runId;
  if (runId !== undefined) {
    message.runId = runId;
  }
  if (isRecord(rawMessage.metadata)) {
    message.metadata = rawMessage.metadata;
  }
  return message;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
