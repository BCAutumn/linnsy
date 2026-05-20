import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../schema/schema-provider.js';
import { SqliteConversationStore } from '../../conversation/sqlite-conversation-store.js';
import { SqliteEventStore } from '../sqlite-event-store.js';
import type { RuntimeEvent } from '../../../../domains/observability/definitions/runtime-events.js';

describe('sqlite event store', () => {
  test('appends events and lists them by conversation in seq order', async () => {
    const { db, home } = await createStoreFixture();
    try {
      const store = new SqliteEventStore(db);

      store.append(toolStartEvent({ seq: 1, eventId: 'evt_1', conversationId: 'conv_1' }));
      store.append(toolResultEvent({ seq: 2, eventId: 'evt_2', conversationId: 'conv_1' }));
      // 跨会话事件不应被读出
      store.append(toolStartEvent({ seq: 3, eventId: 'evt_3', conversationId: 'conv_other' }));
      store.append(systemEvent({ seq: 4, eventId: 'evt_4', conversationId: 'conv_1' }));

      const result = store.listByConversation('conv_1');
      expect(result.events.map((e) => e.eventId)).toEqual(['evt_1', 'evt_2', 'evt_4']);
      expect(result.events.map((e) => e.kind)).toEqual([
        'tool_call.start',
        'tool_call.result',
        'system.event'
      ]);
      expect(result.events[0]?.payload).toMatchObject({ toolName: 'list_tasks' });
      expect(result.nextCursor).toBe('4');
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('readMaxSeq returns 0 on empty table and the largest seq otherwise', async () => {
    const { db, home } = await createStoreFixture();
    try {
      const store = new SqliteEventStore(db);
      expect(store.readMaxSeq()).toBe(0);

      store.append(toolStartEvent({ seq: 7, eventId: 'evt_7', conversationId: 'conv_1' }));
      store.append(toolResultEvent({ seq: 9, eventId: 'evt_9', conversationId: 'conv_1' }));
      expect(store.readMaxSeq()).toBe(9);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('sinceSeq does incremental polling, schema-drift kinds are ignored', async () => {
    const { db, home } = await createStoreFixture();
    try {
      const store = new SqliteEventStore(db);
      store.append(toolStartEvent({ seq: 1, eventId: 'evt_1', conversationId: 'conv_1' }));
      // 模拟 schema 漂移：手插一条未来 kind，期望 store 静默跳过而非崩。
      db.prepare(`INSERT INTO events (event_id, seq, kind, conversation_id, payload_json, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run('evt_drift', 2, 'future.unknown', 'conv_1', JSON.stringify({}), 100);
      store.append(toolResultEvent({ seq: 3, eventId: 'evt_3', conversationId: 'conv_1' }));

      const tail = store.listByConversation('conv_1', { sinceSeq: 1 });
      expect(tail.events.map((e) => e.eventId)).toEqual(['evt_3']);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('default conversation history returns the latest limited window in seq order', async () => {
    const { db, home } = await createStoreFixture();
    try {
      const store = new SqliteEventStore(db);
      store.append(toolStartEvent({ seq: 1, eventId: 'evt_1', conversationId: 'conv_1' }));
      store.append(toolResultEvent({ seq: 2, eventId: 'evt_2', conversationId: 'conv_1' }));
      store.append(systemEvent({ seq: 3, eventId: 'evt_3', conversationId: 'conv_1' }));
      store.append(toolStartEvent({ seq: 4, eventId: 'evt_4', conversationId: 'conv_1' }));
      store.append(toolResultEvent({ seq: 5, eventId: 'evt_5', conversationId: 'conv_1' }));

      const result = store.listByConversation('conv_1', { limit: 2 });

      expect(result.events.map((event) => event.eventId)).toEqual(['evt_4', 'evt_5']);
      expect(result.nextCursor).toBe('5');
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('marks only visible conversation events as activity', async () => {
    const { db, home, conversations } = await createStoreFixture();
    try {
      const store = new SqliteEventStore(db, { conversations });

      store.append(toolStartEvent({ seq: 1, eventId: 'evt_tool', conversationId: 'conv_1' }));
      await expect(conversations.get('conv_1')).resolves.toMatchObject({ lastActivityAt: 0 });

      store.append(channelStatusEvent({ seq: 2, eventId: 'evt_channel', conversationId: 'conv_1' }));
      await expect(conversations.get('conv_1')).resolves.toMatchObject({ lastActivityAt: 0 });

      store.append(systemEvent({ seq: 4, eventId: 'evt_system', conversationId: 'conv_1' }));
      await expect(conversations.get('conv_1')).resolves.toMatchObject({ lastActivityAt: 200 });

      store.append(taskExecutionNoticeEvent({ seq: 5, eventId: 'evt_task_notice', conversationId: 'conv_1' }));
      await expect(conversations.get('conv_1')).resolves.toMatchObject({ lastActivityAt: 220 });

      store.append(subagentSummaryEvent({ seq: 6, eventId: 'evt_subagent', conversationId: 'conv_1' }));
      await expect(conversations.get('conv_1')).resolves.toMatchObject({ lastActivityAt: 250 });
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});

function toolStartEvent(overrides: { seq: number; eventId: string; conversationId: string }): RuntimeEvent {
  return {
    eventId: overrides.eventId,
    seq: overrides.seq,
    kind: 'tool_call.start',
    conversationId: overrides.conversationId,
    runId: 'run_1',
    createdAt: 100,
    payload: {
      toolCallId: 'tc_1',
      toolName: 'list_tasks',
      args: { foo: 'bar' },
      startedAt: 100
    }
  };
}

function toolResultEvent(overrides: { seq: number; eventId: string; conversationId: string }): RuntimeEvent {
  return {
    eventId: overrides.eventId,
    seq: overrides.seq,
    kind: 'tool_call.result',
    conversationId: overrides.conversationId,
    runId: 'run_1',
    createdAt: 110,
    payload: {
      toolCallId: 'tc_1',
      toolName: 'list_tasks',
      status: 'success',
      data: { items: [] },
      observation: '[]',
      durationMs: 10,
      endedAt: 110
    }
  };
}

function systemEvent(overrides: { seq: number; eventId: string; conversationId: string }): RuntimeEvent {
  return {
    eventId: overrides.eventId,
    seq: overrides.seq,
    kind: 'system.event',
    conversationId: overrides.conversationId,
    createdAt: 200,
    payload: {
      sourceKind: 'cron',
      detail: '提醒主人喝水',
      refId: 'job_1',
      occurredAt: 200
    }
  };
}

function channelStatusEvent(overrides: { seq: number; eventId: string; conversationId: string }): RuntimeEvent {
  return {
    eventId: overrides.eventId,
    seq: overrides.seq,
    kind: 'system.event',
    conversationId: overrides.conversationId,
    createdAt: 210,
    payload: {
      sourceKind: 'channel_status',
      detail: 'wechat disconnected',
      refId: 'wechat',
      occurredAt: 210
    }
  };
}

function taskExecutionNoticeEvent(overrides: { seq: number; eventId: string; conversationId: string }): RuntimeEvent {
  return {
    eventId: overrides.eventId,
    seq: overrides.seq,
    kind: 'system.event',
    conversationId: overrides.conversationId,
    createdAt: 220,
    payload: {
      sourceKind: 'task_execution_notice',
      detail: '------ Codex 任务已执行 ------',
      refId: 'task_1',
      occurredAt: 220
    }
  };
}

function subagentSummaryEvent(overrides: { seq: number; eventId: string; conversationId: string }): RuntimeEvent {
  return {
    eventId: overrides.eventId,
    seq: overrides.seq,
    kind: 'subagent.summary',
    conversationId: overrides.conversationId,
    createdAt: 250,
    payload: {
      taskId: 'task_1',
      childRunId: 'run_child',
      childConversationId: 'conv_child',
      summary: '子任务完成'
    }
  };
}

async function createStoreFixture(): Promise<{
  db: Database.Database;
  home: string;
  conversations: SqliteConversationStore;
}> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);

  const conversations = new SqliteConversationStore(db);
  await conversations.upsert({
    conversationId: 'conv_1',
    sessionKey: 'linnsy:main:cli:private:local',
    platform: 'cli',
    chatType: 'private',
    chatId: 'local',
    createdAt: 0,
    updatedAt: 0
  });
  await conversations.upsert({
    conversationId: 'conv_other',
    sessionKey: 'linnsy:main:cli:private:other',
    platform: 'cli',
    chatType: 'private',
    chatId: 'other',
    createdAt: 0,
    updatedAt: 0
  });
  return { db, home, conversations };
}
