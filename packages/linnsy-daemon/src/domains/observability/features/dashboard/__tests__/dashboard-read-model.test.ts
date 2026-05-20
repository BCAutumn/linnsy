import { describe, expect, test } from 'vitest';

import type { ConversationRecord } from '../../../../../persistence/stores/conversation/conversation-store-port.js';
import type { MessageRecord } from '../../../../../persistence/stores/message/message-store-port.js';
import type { TaskRecord } from '../../../../task/definitions/task.js';
import { createRuntimeEventHub } from '../../event-hub/event-hub.js';
import { createDashboardReadModel } from '../dashboard-read-model.js';

describe('DashboardReadModel', () => {
  test('lists conversation summaries without deriving sidebar preview from messages', async () => {
    let messageReadCount = 0;
    const readModel = createDashboardReadModel({
      conversations: {
        list: () => Promise.resolve([
          conversation({ conversationId: 'conv_2', title: 'Later', updatedAt: 30, pinnedAt: 40 }),
          conversation({ conversationId: 'conv_1', title: 'Earlier', updatedAt: 20 })
        ])
      },
      messages: {
        listByConversation: () => {
          messageReadCount += 1;
          return Promise.resolve({ messages: [] });
        }
      },
      tasks: { list: () => Promise.resolve([]) }
    });

    const conversations = await readModel.listConversations({ limit: 10 });
    expect(conversations[0]).toMatchObject({
      conversationId: 'conv_2',
      title: 'Later',
      pinnedAt: 40
    });
    expect(conversations[1]).toMatchObject({
      conversationId: 'conv_1',
      title: 'Earlier'
    });
    expect(messageReadCount).toBe(0);
  });

  test('reads paginated messages for a conversation', async () => {
    const readModel = createDashboardReadModel({
      conversations: { list: () => Promise.resolve([]) },
      messages: {
        listByConversation: (conversationId, options) => {
          expect(conversationId).toBe('conv_1');
          expect(options).toEqual({ limit: 50, cursor: 'msg_1' });
          return Promise.resolve({
            messages: [message({ messageId: 'msg_2', conversationId: 'conv_1', text: 'next' })],
            nextCursor: 'msg_2'
          });
        }
      },
      tasks: { list: () => Promise.resolve([]) }
    });

    const page = await readModel.readMessages('conv_1', { limit: 50, cursor: 'msg_1' });
    expect(page).toMatchObject({
      messages: [{ messageId: 'msg_2', text: 'next' }],
      nextCursor: 'msg_2'
    });
  });

  test('lists tasks through the task tracker read port', async () => {
    const readModel = createDashboardReadModel({
      conversations: { list: () => Promise.resolve([]) },
      messages: { listByConversation: () => Promise.resolve({ messages: [] }) },
      tasks: {
        list: (filter) => {
          expect(filter).toEqual({ conversationId: 'conv_1', limit: 25 });
          return Promise.resolve([task({ taskId: 'task_1', conversationId: 'conv_1' })]);
        }
      }
    });

    await expect(readModel.listTasks({ conversationId: 'conv_1', limit: 25 })).resolves.toEqual([
      expect.objectContaining({ taskId: 'task_1', conversationId: 'conv_1' })
    ]);
  });

  test('polls runtime events through the shared event hub', async () => {
    const events = createRuntimeEventHub({ idFactory: () => 'evt_1', now: () => 99 });
    const completePayload = {
      message: {
        messageId: 'msg_1',
        conversationId: 'conv_1',
        role: 'assistant',
        source: 'outbound',
        text: 'done',
        runId: 'run_1',
        createdAt: 99
      }
    };
    events.publish({
      kind: 'message.complete',
      conversationId: 'conv_1',
      messageId: 'msg_1',
      runId: 'run_1',
      payload: completePayload
    });
    const readModel = createDashboardReadModel({
      conversations: { list: () => Promise.resolve([]) },
      messages: { listByConversation: () => Promise.resolve({ messages: [] }) },
      tasks: { list: () => Promise.resolve([]) },
      events
    });

    await expect(readModel.pollEvents()).resolves.toEqual({
      events: [
        {
          eventId: 'evt_1',
          seq: 1,
          kind: 'message.complete',
          conversationId: 'conv_1',
          messageId: 'msg_1',
          runId: 'run_1',
          createdAt: 99,
          payload: completePayload
        }
      ],
      nextCursor: '1'
    });
  });
});

function conversation(overrides: Partial<ConversationRecord>): ConversationRecord {
  return {
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 10,
    updatedAt: 10,
    lastActivityAt: overrides.lastActivityAt ?? overrides.updatedAt ?? 10,
    ...overrides
  };
}

function message(overrides: Partial<MessageRecord>): MessageRecord {
  return {
    messageId: 'msg_1',
    conversationId: 'conv_1',
    role: 'user',
    source: 'inbound',
    text: 'hello',
    createdAt: 10,
    ...overrides
  };
}

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    taskId: 'task_1',
    conversationId: 'conv_1',
    kind: 'external',
    attemptCount: 0,
    title: 'task',
    status: 'received',
    createdAt: 10,
    updatedAt: 10,
    ...overrides
  };
}
