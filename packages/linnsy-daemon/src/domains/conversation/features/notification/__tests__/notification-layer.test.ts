import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteMessageStore } from '../../../../../persistence/stores/message/sqlite-message-store.js';
import { SqliteTaskStore } from '../../../../task/persistence/sqlite-task-store.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import { createTaskTracker } from '../../../../task/features/tracker/task-tracker.js';
import { createNotificationLayer } from '../notification-layer.js';
import type {
  NotificationChannelPort,
  NotificationChannelSendResult,
  NotificationEventPublisherPort,
  ReplyForRunResult
} from '../types.js';

// @ts-expect-error failed deliveries are converted to thrown errors before a ReplyForRunResult exists
const invalidReplyForRunResult: ReplyForRunResult = { outboundMessageId: 'out_invalid', delivery: 'failed' };
void invalidReplyForRunResult;

interface Fixture {
  db: Database.Database;
  conversations: SqliteConversationStore;
  messages: SqliteMessageStore;
  tasks: SqliteTaskStore;
  taskTracker: ReturnType<typeof createTaskTracker>;
  cleanup(): Promise<void>;
}

const fixtures: Fixture[] = [];

async function setup(): Promise<Fixture> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const messages = new SqliteMessageStore(db);
  const tasks = new SqliteTaskStore(db);
  const taskTracker = createTaskTracker({ tasks, clock: { now: () => 5_000 } });
  await conversations.upsert({
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 100,
    updatedAt: 100
  });
  const fixture: Fixture = {
    db,
    conversations,
    messages,
    tasks,
    taskTracker,
    async cleanup() {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (fixture !== undefined) {
      await fixture.cleanup();
    }
  }
});

function createMockChannel(
  platform = 'cli',
  sendResultFactory: (sendCount: number) => NotificationChannelSendResult = (sendCount) => ({
    delivery: 'sent',
    providerMessageId: `provider_${sendCount.toString()}`
  })
): NotificationChannelPort & {
  sent: Array<{ target: unknown; payload: unknown }>;
} {
  const sent: Array<{ target: unknown; payload: unknown }> = [];
  return {
    platform,
    send(target, payload) {
      sent.push({ target, payload });
      return Promise.resolve(sendResultFactory(sent.length));
    },
    sent
  };
}

describe('createNotificationLayer', () => {
  test('replyForRun routes to channel and persists outbound message', async () => {
    const fixture = await setup();
    const channel = createMockChannel();
    let nowValue = 5_000;
    const layer = createNotificationLayer({
      channels: [channel],
      messages: fixture.messages,
      clock: { now: () => nowValue },
      outboundIdFactory: () => 'out_fixed'
    });

    const result = await layer.replyForRun({
      runId: 'run_42',
      conversationId: 'conv_1',
      target: { platform: 'cli', chatType: 'private', chatId: 'local' },
      payload: { text: 'pong' }
    });

    expect(result).toEqual({
      outboundMessageId: 'out_fixed',
      delivery: 'sent',
      providerMessageId: 'provider_1'
    });
    expect(channel.sent.length).toBe(1);

    nowValue = 6_000;
    const stored = await fixture.messages.listByConversation('conv_1', { limit: 10 });
    expect(stored.messages).toEqual([
      expect.objectContaining({
        messageId: 'out_fixed',
        runId: 'run_42',
        text: 'pong',
        providerMessageId: 'provider_1',
        source: 'outbound',
        role: 'assistant',
        createdAt: 5_000
      })
    ]);
  });

  test('throws LINNSY_CHANNEL_NOT_STARTED when target platform is unknown', async () => {
    const fixture = await setup();
    const channel = createMockChannel('cli');
    const layer = createNotificationLayer({
      channels: [channel],
      messages: fixture.messages
    });

    await expect(
      layer.replyForRun({
        runId: 'run_1',
        conversationId: 'conv_1',
        target: { platform: 'telegram', chatType: 'private', chatId: 'remote' },
        payload: { text: 'should fail' }
      })
    ).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED });
  });

  test('rejects duplicate channel adapters at construction time', async () => {
    const fixture = await setup();
    const a = createMockChannel('cli');
    const b = createMockChannel('cli');
    expect(() =>
      createNotificationLayer({
        channels: [a, b],
        messages: fixture.messages
      })
    ).toThrowError(LinnsyError);
  });

  test('proactive sends through the target channel', async () => {
    const fixture = await setup();
    const channel = createMockChannel();
    const layer = createNotificationLayer({
      channels: [channel],
      messages: fixture.messages
    });

    await layer.proactive(
      { platform: 'cli', chatType: 'private', chatId: 'local' },
      { text: 'hello' }
    );

    expect(channel.sent).toEqual([
      {
        target: { platform: 'cli', chatType: 'private', chatId: 'local' },
        payload: { text: 'hello' }
      }
    ]);
  });

  test('notifyForTask resolves latest inbound target, sends summary, and marks completed tasks reported', async () => {
    const fixture = await setup();
    const channel = createMockChannel();
    const layer = createNotificationLayer({
      channels: [channel],
      messages: fixture.messages,
      taskTracker: fixture.taskTracker,
      clock: { now: () => 6_000 },
      outboundIdFactory: () => 'out_task'
    });
    await fixture.messages.insert({
      messageId: 'in_1',
      conversationId: 'conv_1',
      role: 'user',
      source: 'inbound',
      platform: 'cli',
      chatType: 'private',
      chatId: 'local',
      text: 'please do it',
      createdAt: 1_000
    });
    await fixture.taskTracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: 'completed'
    });

    await expect(layer.notifyForTask({
      taskId: 'task_1',
      text: 'Task finished'
    })).resolves.toEqual({
      outboundMessageId: 'out_task',
      delivery: 'sent',
      providerMessageId: 'provider_1'
    });
    expect(channel.sent.map((entry) => entry.payload)).toEqual([{ text: 'Task finished' }]);
    await expect(fixture.taskTracker.get('task_1')).resolves.toMatchObject({ status: 'reported' });
  });

  test('replyForTaskRun sends via latest inbound target and persists outbound with run id', async () => {
    const fixture = await setup();
    const channel = createMockChannel();
    const seenKinds: string[] = [];
    const events: NotificationEventPublisherPort = {
      publish(event) {
        seenKinds.push(`${event.kind}:${event.runId}`);
      }
    };
    const layer = createNotificationLayer({
      channels: [channel],
      messages: fixture.messages,
      taskTracker: fixture.taskTracker,
      events,
      clock: { now: () => 6_000 },
      outboundIdFactory: () => 'out_task_run'
    });
    await fixture.messages.insert({
      messageId: 'in_1',
      conversationId: 'conv_1',
      role: 'user',
      source: 'inbound',
      platform: 'cli',
      chatType: 'private',
      chatId: 'local',
      text: 'please do it',
      createdAt: 1_000
    });
    await fixture.taskTracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: 'failed',
      result: { errorMessage: 'boom' }
    });

    await expect(layer.replyForTaskRun({
      taskId: 'task_1',
      runId: 'run_wake',
      text: '任务失败了'
    })).resolves.toEqual({
      outboundMessageId: 'out_task_run',
      delivery: 'sent',
      providerMessageId: 'provider_1'
    });

    expect(channel.sent).toEqual([
      {
        target: { platform: 'cli', chatType: 'private', chatId: 'local' },
        payload: { text: '任务失败了' }
      }
    ]);
    const stored = await fixture.messages.listByConversation('conv_1', { limit: 10 });
    expect(stored.messages).toEqual([
      expect.objectContaining({ messageId: 'in_1' }),
      expect.objectContaining({
        messageId: 'out_task_run',
        runId: 'run_wake',
        text: '任务失败了',
        source: 'outbound',
        role: 'assistant'
      })
    ]);
    expect(seenKinds).toEqual(['message.complete:run_wake']);
  });

  test('notifyForTask keeps completed tasks completed when outbound delivery is deferred', async () => {
    const fixture = await setup();
    const channel = createMockChannel('cli', () => ({
      delivery: 'deferred',
      detail: 'queued in upstream gateway'
    }));
    const layer = createNotificationLayer({
      channels: [channel],
      messages: fixture.messages,
      taskTracker: fixture.taskTracker,
      clock: { now: () => 6_000 },
      outboundIdFactory: () => 'out_task_deferred'
    });
    await fixture.messages.insert({
      messageId: 'in_1',
      conversationId: 'conv_1',
      role: 'user',
      source: 'inbound',
      platform: 'cli',
      chatType: 'private',
      chatId: 'local',
      text: 'please do it',
      createdAt: 1_000
    });
    await fixture.taskTracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: 'completed'
    });

    await expect(layer.notifyForTask({
      taskId: 'task_1',
      text: 'Task queued'
    })).resolves.toEqual({
      outboundMessageId: 'out_task_deferred',
      delivery: 'deferred',
      detail: 'queued in upstream gateway'
    });
    await expect(fixture.taskTracker.get('task_1')).resolves.toMatchObject({ status: 'completed' });

    const stored = await fixture.messages.listByConversation('conv_1', { limit: 10 });
    expect(stored.messages).toEqual([
      expect.objectContaining({
        messageId: 'in_1',
        text: 'please do it'
      }),
      expect.objectContaining({
        messageId: 'out_task_deferred',
        text: 'Task queued',
        source: 'outbound',
        role: 'assistant',
        createdAt: 6_000
      })
    ]);
  });

  test('notifyForTask rejects explicit failed delivery without persisting outbound or reporting task', async () => {
    const fixture = await setup();
    const channel = createMockChannel('cli', () => ({
      delivery: 'failed',
      detail: 'upstream rejected message'
    }));
    const layer = createNotificationLayer({
      channels: [channel],
      messages: fixture.messages,
      taskTracker: fixture.taskTracker,
      clock: { now: () => 6_000 },
      outboundIdFactory: () => 'out_task_failed'
    });
    await fixture.messages.insert({
      messageId: 'in_1',
      conversationId: 'conv_1',
      role: 'user',
      source: 'inbound',
      platform: 'cli',
      chatType: 'private',
      chatId: 'local',
      text: 'please do it',
      createdAt: 1_000
    });
    await fixture.taskTracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: 'completed'
    });

    await expect(layer.notifyForTask({
      taskId: 'task_1',
      text: 'Task failed to notify'
    })).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.NOTIFICATION_DELIVERY_FAILED });
    await expect(fixture.taskTracker.get('task_1')).resolves.toMatchObject({ status: 'completed' });

    const stored = await fixture.messages.listByConversation('conv_1', { limit: 10 });
    expect(stored.messages).toEqual([
      expect.objectContaining({
        messageId: 'in_1',
        text: 'please do it'
      })
    ]);
  });

  test('notifyForTask throws LINNSY_NOTIFICATION_NO_TARGET when no inbound message exists', async () => {
    const fixture = await setup();
    const layer = createNotificationLayer({
      channels: [createMockChannel()],
      messages: fixture.messages,
      taskTracker: fixture.taskTracker
    });
    await fixture.taskTracker.upsert({
      taskId: 'task_1',
      conversationId: 'conv_1',
      title: 'Task',
      status: 'completed'
    });

    await expect(layer.notifyForTask({
      taskId: 'task_1',
      text: 'Task finished'
    })).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.NOTIFICATION_NO_TARGET });
  });
});
