import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../schema/schema-provider.js';
import { SqliteConversationStore } from '../sqlite-conversation-store.js';

describe('sqlite conversation store', () => {
  const permanentDeleteOptions = {
    activeRunStatuses: ['pending', 'running', 'awaiting_user'],
    activeTaskStatuses: ['received', 'dispatched', 'in_progress', 'paused']
  } as const;

  test('upserts conversations with metadata', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      const conversations = new SqliteConversationStore(db);

      await conversations.upsert({
        conversationId: 'conv_1',
        sessionKey: 'linnsy:main:cli:private:conv_1',
        platform: 'cli',
        chatType: 'private',
        chatId: 'conv_1',
        title: 'CLI',
        createdAt: 10,
        updatedAt: 20,
        metadata: { transport: 'stdio' }
      });

      await expect(conversations.get('conv_1')).resolves.toMatchObject({
        conversationId: 'conv_1',
        metadata: { transport: 'stdio' }
      });
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('renames, pins, archives, unarchives, and purges conversations', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      const conversations = new SqliteConversationStore(db);

      await conversations.upsert({
        conversationId: 'conv_1',
        sessionKey: 'linnsy:main:desktop:private:window:1',
        platform: 'desktop',
        chatType: 'private',
        chatId: 'window:1',
        createdAt: 10,
        updatedAt: 10
      });

      await expect(conversations.rename('conv_1', 'Renamed', 20)).resolves.toBe(true);
      await expect(conversations.setPinned('conv_1', 30, 30)).resolves.toBe(true);
      await expect(conversations.get('conv_1')).resolves.toMatchObject({
        title: 'Renamed',
        pinnedAt: 30,
        updatedAt: 30,
        lastActivityAt: 10
      });

      expect(conversations.markActivity('conv_1', 25)).toBe(true);
      expect(conversations.markActivity('conv_1', 15)).toBe(false);
      await expect(conversations.get('conv_1')).resolves.toMatchObject({
        lastActivityAt: 25,
        updatedAt: 30
      });

      await expect(conversations.archive('conv_1', 40)).resolves.toBe(true);
      await expect(conversations.list()).resolves.toEqual([]);
      await expect(conversations.list({ includeArchived: true })).resolves.toHaveLength(1);

      await expect(conversations.unarchive('conv_1', 50)).resolves.toBe(true);
      await expect(conversations.get('conv_1')).resolves.toMatchObject({ updatedAt: 50, lastActivityAt: 25 });
      await expect(conversations.purge('conv_1')).resolves.toBe(true);
      await expect(conversations.get('conv_1')).resolves.toBeNull();
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('blocks permanent short-term delete when active work exists', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      const conversations = new SqliteConversationStore(db);

      await conversations.upsert({
        conversationId: 'conv_active',
        sessionKey: 'linnsy:main:desktop:private:conv_active',
        platform: 'desktop',
        chatType: 'private',
        chatId: 'conv_active',
        createdAt: 10,
        updatedAt: 10
      });
      db.prepare(
        `INSERT INTO runs (run_id, conversation_id, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('run_active', 'conv_active', 'running', 20, 20);

      await expect(
        conversations.permanentDeleteShortTermData('conv_active', permanentDeleteOptions)
      ).resolves.toEqual({ status: 'has_active_work' });
      await expect(conversations.get('conv_active')).resolves.not.toBeNull();
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('permanently deletes short-term data without deleting long-term memory', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      const conversations = new SqliteConversationStore(db);

      await conversations.upsert({
        conversationId: 'conv_1',
        sessionKey: 'linnsy:main:desktop:private:conv_1',
        platform: 'desktop',
        chatType: 'private',
        chatId: 'conv_1',
        createdAt: 10,
        updatedAt: 10
      });
      db.prepare(
        `INSERT INTO messages (message_id, conversation_id, role, source, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('msg_1', 'conv_1', 'user', 'inbound', 'hello', 20);
      db.prepare(
        `INSERT INTO events (event_id, seq, kind, conversation_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('evt_1', 1, 'message.inbound', 'conv_1', '{}', 30);
      db.prepare(
        `INSERT INTO runs (run_id, conversation_id, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('run_1', 'conv_1', 'completed', 40, 40);
      db.prepare(
        `INSERT INTO checkpoints (conversation_id, state_json, schema_version, updated_at)
         VALUES (?, ?, ?, ?)`
      ).run('conv_1', '{"nodeId":"done"}', 1, 50);
      db.prepare(
        `INSERT INTO tasks (task_id, conversation_id, status, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('task_1', 'conv_1', 'completed', 'done', 60, 60);
      db.prepare(
        `INSERT INTO memory_items (memory_id, scope, content, importance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('mem_1', 'long_term', 'likes quiet mornings', 5, 70, 70);

      await expect(
        conversations.permanentDeleteShortTermData('conv_1', permanentDeleteOptions)
      ).resolves.toEqual({ status: 'deleted' });

      expect(countRows(db, 'conversations')).toBe(0);
      expect(countRows(db, 'messages')).toBe(0);
      expect(countRows(db, 'events')).toBe(0);
      expect(countRows(db, 'runs')).toBe(0);
      expect(countRows(db, 'checkpoints')).toBe(0);
      expect(countRows(db, 'tasks')).toBe(0);
      expect(countRows(db, 'memory_items')).toBe(1);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});

function countRows(
  db: Database.Database,
  table: 'conversations' | 'messages' | 'events' | 'runs' | 'checkpoints' | 'tasks' | 'memory_items'
): number {
  const row = db.prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return row?.count ?? 0;
}
