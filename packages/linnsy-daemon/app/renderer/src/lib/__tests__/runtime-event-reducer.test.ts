import { describe, expect, test } from 'vitest';

import type { ChatAppState } from '../chat-actions.js';
import type { ApplicationConnectionsSnapshot } from '@renderer/contracts';
import { applyRuntimeClientEvent, applyRuntimeClientEvents } from '../runtime-event-reducer.js';
import { selectAllItems } from '../../features/chat/projection/helpers/selectors.js';
import { createInitialState } from '../../features/chat/projection/state.js';

// 这个文件只测 applyRuntimeClientEvent 的"顶层副作用"：
//   - conversations 列表是否按 inbound/complete 的 message text 提到顶 / 补齐标题
//   - status 是否随 inbound→Sent / delta→Replying / complete→Connected 切换
//   - projection 是否被正确投影
//
// 投影器自身的不变量（幂等 / 拼接 / 跨会话隔离 / multi-answer 等）由
// features/chat/projection/__tests__/* 35 项测试守住，这里不再重复。

describe('applyRuntimeClientEvent · top-level side effects', () => {
  test('inbound for the selected conversation updates conversation list, status and projection together', () => {
    const state = appState({
      conversations: [conversation({ updatedAt: 1 })]
    });
    const next = applyRuntimeClientEvent(state, {
      eventId: 'evt_1',
      seq: 1,
      kind: 'message.inbound',
      createdAt: 5,
      conversationId: 'conv_1',
      messageId: 'msg_1',
      payload: {
        message: {
          messageId: 'msg_1',
          conversationId: 'conv_1',
          role: 'user',
          source: 'inbound',
          text: 'ping',
          createdAt: 5
        }
      }
    });
    expect(next.conversations[0]).toMatchObject({
      conversationId: 'conv_1',
      title: 'ping',
      updatedAt: 5,
      lastActivityAt: 5
    });
    expect(next.status).toBe('已发送');
    const items = selectAllItems(next.projection);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'user_bubble', id: 'msg_1', text: 'ping' });
  });

  test('inbound for another conversation updates that conversation metadata but does not change selected projection or status', () => {
    const state = appState({
      conversations: [
        conversation({ conversationId: 'conv_1', title: 'current', updatedAt: 1 }),
        conversation({ conversationId: 'conv_2', updatedAt: 1 })
      ]
    });
    const next = applyRuntimeClientEvent(state, {
      eventId: 'evt_other',
      seq: 2,
      kind: 'message.inbound',
      createdAt: 9,
      conversationId: 'conv_2',
      messageId: 'msg_other',
      payload: {
        message: {
          messageId: 'msg_other',
          conversationId: 'conv_2',
          role: 'user',
          source: 'inbound',
          text: 'other new',
          createdAt: 9
        }
      }
    });
    expect(next.conversations[0]).toMatchObject({
      conversationId: 'conv_2',
      title: 'other new',
      updatedAt: 9,
      lastActivityAt: 9
    });
    expect(selectAllItems(next.projection)).toEqual([]);
    expect(next.status).toBe(state.status);
  });

  test('delta for the selected conversation flips status to replying and adds a streaming bubble to the projection', () => {
    const next = applyRuntimeClientEvent(appState(), {
      eventId: 'evt_delta',
      seq: 1,
      kind: 'message.delta',
      createdAt: 3,
      conversationId: 'conv_1',
      runId: 'run_1',
      payload: {
        turnId: 'turn_1',
        answerId: 'ans_1',
        chunkSeq: 0,
        delta: '你好'
      }
    });
    expect(next.status).toBe('正在回复');
    const items = selectAllItems(next.projection);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'assistant_bubble', text: '你好', streaming: true });
  });

  test('visible non-message events refresh sidebar activity, but tool progress does not', () => {
    const state = appState({
      conversations: [conversation({ conversationId: 'conv_1', updatedAt: 1, lastActivityAt: 1 })]
    });
    const afterSystem = applyRuntimeClientEvent(state, {
      eventId: 'evt_system',
      seq: 1,
      kind: 'system.event',
      createdAt: 8,
      conversationId: 'conv_1',
      payload: {
        sourceKind: 'task_execution_notice',
        detail: '------ Codex 任务已执行 ------',
        occurredAt: 8
      }
    });
    expect(afterSystem.conversations[0]).toMatchObject({ lastActivityAt: 8 });

    const afterToolProgress = applyRuntimeClientEvent(afterSystem, {
      eventId: 'evt_tool_progress',
      seq: 2,
      kind: 'tool_call.progress',
      createdAt: 9,
      conversationId: 'conv_1',
      payload: {
        toolCallId: 'tc_1',
        toolName: 'delegate_to_internal',
        phase: 'update',
        status: 'loading',
        occurredAt: 9
      }
    });
    expect(afterToolProgress.conversations[0]).toMatchObject({ lastActivityAt: 8 });

    const afterSubagent = applyRuntimeClientEvent(afterToolProgress, {
      eventId: 'evt_subagent',
      seq: 3,
      kind: 'subagent.summary',
      createdAt: 10,
      conversationId: 'conv_1',
      payload: {
        taskId: 'task_1',
        childRunId: 'run_child',
        childConversationId: 'conv_child',
        summary: '整理好了'
      }
    });
    expect(afterSubagent.conversations[0]).toMatchObject({ lastActivityAt: 10 });
  });

  test('legacy task_status_change system events do not refresh sidebar activity', () => {
    const state = appState({
      conversations: [conversation({ conversationId: 'conv_1', updatedAt: 1, lastActivityAt: 1 })]
    });
    const next = applyRuntimeClientEvent(state, {
      eventId: 'evt_legacy_task_status',
      seq: 1,
      kind: 'system.event',
      createdAt: 8,
      conversationId: 'conv_1',
      payload: {
        sourceKind: 'task_status_change',
        detail: 'task_status_change:received->dispatched:旧事件',
        occurredAt: 8
      }
    });
    expect(next.conversations[0]).toMatchObject({ lastActivityAt: 1 });
  });

  test('complete for the selected conversation finalizes the streaming bubble and resets status to connected', () => {
    const afterDelta = applyRuntimeClientEvent(appState(), {
      eventId: 'evt_delta',
      seq: 1,
      kind: 'message.delta',
      createdAt: 3,
      conversationId: 'conv_1',
      runId: 'run_1',
      payload: { turnId: 'turn_1', answerId: 'ans_1', chunkSeq: 0, delta: 'partial' }
    });
    const next = applyRuntimeClientEvent(afterDelta, {
      eventId: 'evt_complete',
      seq: 2,
      kind: 'message.complete',
      createdAt: 4,
      conversationId: 'conv_1',
      messageId: 'out_1',
      runId: 'run_1',
      payload: {
        message: {
          messageId: 'out_1',
          conversationId: 'conv_1',
          role: 'assistant',
          source: 'outbound',
          text: 'final',
          runId: 'run_1',
          createdAt: 4
        }
      }
    });
    expect(next.status).toBe('已连接');
    const items = selectAllItems(next.projection);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'assistant_bubble',
      id: 'out_1',
      text: 'final',
      streaming: false
    });
  });

  test('batched events produce the same state as one-by-one application', () => {
    const initial = appState();
    const events = [
      {
        eventId: 'evt_delta_1',
        seq: 1,
        kind: 'message.delta',
        createdAt: 3,
        conversationId: 'conv_1',
        runId: 'run_1',
        payload: { turnId: 'turn_1', answerId: 'ans_1', chunkSeq: 0, delta: '你' }
      },
      {
        eventId: 'evt_delta_2',
        seq: 2,
        kind: 'message.delta',
        createdAt: 4,
        conversationId: 'conv_1',
        runId: 'run_1',
        payload: { turnId: 'turn_1', answerId: 'ans_1', chunkSeq: 1, delta: '好' }
      },
      {
        eventId: 'evt_complete',
        seq: 3,
        kind: 'message.complete',
        createdAt: 5,
        conversationId: 'conv_1',
        messageId: 'out_1',
        runId: 'run_1',
        payload: {
          message: {
            messageId: 'out_1',
            conversationId: 'conv_1',
            role: 'assistant',
            source: 'outbound',
            text: '你好',
            runId: 'run_1',
            createdAt: 5
          }
        }
      }
    ] satisfies Parameters<typeof applyRuntimeClientEvents>[1];

    const batched = applyRuntimeClientEvents(initial, events);
    let oneByOne = initial;
    for (const event of events) {
      oneByOne = applyRuntimeClientEvent(oneByOne, event);
    }

    expect(batched).toEqual(oneByOne);
    expect(selectAllItems(batched.projection)[0]).toMatchObject({
      kind: 'assistant_bubble',
      text: '你好',
      streaming: false
    });
  });
});

function appState(overrides: Partial<ChatAppState> = {}): ChatAppState {
  return {
    client: null,
    conversations: [],
    selectedConversationId: 'conv_1',
    pendingDesktopConversation: false,
    terminalBinding: {
      terminalId: 'mobile',
      conversationId: 'conv_1',
      updatedAt: 1,
      updatedBy: 'test'
    },
    applicationConnections: createApplicationConnections(),
    projection: createInitialState('conv_1'),
    preferences: {
      'theme.mode': 'auto',
      'theme.primary_color': 'pine_cypress',
      'font.size': 'medium',
      'sidebar.width_px': 260,
      'sidebar.archived_collapsed': true,
      last_opened_conversation_id: 'conv_1',
      language: 'zh-CN',
      'scheduled.skip_inactive_delete_confirm': false
    },
    channelStatuses: new Map(),
    status: '已连接',
    error: null,
    ...overrides
  };
}

function createApplicationConnections(): ApplicationConnectionsSnapshot {
  return {
    codex: {
      status: 'not_found',
      command: 'codex',
      checkedAt: 1
    },
    claudeCode: { status: 'unsupported' },
    cursor: { status: 'unsupported' }
  };
}

function conversation(overrides: {
  conversationId?: string;
  title?: string;
  updatedAt?: number;
  lastActivityAt?: number;
}): ChatAppState['conversations'][number] {
  const updatedAt = overrides.updatedAt ?? 1;
  return {
    conversationId: overrides.conversationId ?? 'conv_1',
    platform: 'desktop',
    chatType: 'private',
    chatId: 'window:main',
    updatedAt,
    lastActivityAt: overrides.lastActivityAt ?? updatedAt,
    ...(overrides.title === undefined ? {} : { title: overrides.title })
  };
}
