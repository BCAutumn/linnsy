import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, test, vi } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import { SqliteMessageStore } from '../../../../../persistence/stores/message/sqlite-message-store.js';
import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import {
  createConversationManagementService,
  type ConversationTerminalBindingLookupPort
} from '../conversation-management-service.js';

describe('conversation management service', () => {
  test('renames with whitespace normalization and clears blank titles', async () => {
    const fixture = await createFixture();
    try {
      await fixture.seedConversation('conv_1');

      await expect(fixture.service.rename('conv_1', '  A   nice title  ')).resolves.toMatchObject({
        title: 'A nice title',
        updatedAt: 100
      });
      await expect(fixture.service.rename('conv_1', '   ')).resolves.toMatchObject({
        conversationId: 'conv_1',
        updatedAt: 100
      });
      const record = await fixture.conversations.get('conv_1');
      expect(record?.title).toBeUndefined();
      expect(fixture.invalidate).toHaveBeenCalledWith('conv_1');
    } finally {
      await fixture.close();
    }
  });

  test('pins and unpins without changing archived state', async () => {
    const fixture = await createFixture();
    try {
      await fixture.seedConversation('conv_1');

      await expect(fixture.service.setPinned('conv_1', true)).resolves.toMatchObject({
        pinnedAt: 100,
        updatedAt: 100
      });
      await expect(fixture.service.setPinned('conv_1', false)).resolves.toMatchObject({
        conversationId: 'conv_1',
        updatedAt: 100
      });
      const record = await fixture.conversations.get('conv_1');
      expect(record?.pinnedAt).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });

  test('rejects archive and delete for the mobile terminal bound conversation', async () => {
    const fixture = await createFixture({ boundConversationId: 'conv_1' });
    try {
      await fixture.seedConversation('conv_1');

      await expect(fixture.service.archive('conv_1')).rejects.toMatchObject({
        code: LINNSY_ERROR_CODES.CONVERSATION_ARCHIVE_TERMINAL_BOUND
      });
      await expect(fixture.service.permanentDelete('conv_1')).rejects.toMatchObject({
        code: LINNSY_ERROR_CODES.CONVERSATION_DELETE_TERMINAL_BOUND
      });
    } finally {
      await fixture.close();
    }
  });

  test('rejects permanent delete while active work exists', async () => {
    const fixture = await createFixture();
    try {
      await fixture.seedConversation('conv_1');
      fixture.db.prepare(
        `INSERT INTO runs (run_id, conversation_id, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('run_1', 'conv_1', 'running', 1, 1);

      await expect(fixture.service.permanentDelete('conv_1')).rejects.toMatchObject({
        code: LINNSY_ERROR_CODES.CONVERSATION_DELETE_HAS_ACTIVE_RUN
      });
      await expect(fixture.conversations.get('conv_1')).resolves.not.toBeNull();
    } finally {
      await fixture.close();
    }
  });

  test('permanently deletes short-term conversation data without deleting memory', async () => {
    const fixture = await createFixture();
    try {
      await fixture.seedConversation('conv_1');
      await fixture.messages.insert({
        messageId: 'msg_1',
        conversationId: 'conv_1',
        role: 'user',
        source: 'inbound',
        text: 'hello',
        createdAt: 2
      });
      fixture.db.prepare(
        `INSERT INTO events (event_id, seq, kind, conversation_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('evt_1', 1, 'message.inbound', 'conv_1', '{}', 3);
      fixture.db.prepare(
        `INSERT INTO runs (run_id, conversation_id, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('run_1', 'conv_1', 'completed', 4, 4);
      fixture.db.prepare(
        `INSERT INTO checkpoints (conversation_id, state_json, schema_version, updated_at)
         VALUES (?, ?, ?, ?)`
      ).run('conv_1', '{"nodeId":"done"}', 1, 5);
      fixture.db.prepare(
        `INSERT INTO tasks (task_id, conversation_id, status, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('task_1', 'conv_1', 'completed', 'done', 6, 6);
      fixture.db.prepare(
        `INSERT INTO memory_items (memory_id, scope, content, importance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('mem_1', 'long_term', 'likes quiet mornings', 5, 7, 7);

      await fixture.service.permanentDelete('conv_1');

      expect(countRows(fixture.db, 'conversations')).toBe(0);
      expect(countRows(fixture.db, 'messages')).toBe(0);
      expect(countRows(fixture.db, 'events')).toBe(0);
      expect(countRows(fixture.db, 'runs')).toBe(0);
      expect(countRows(fixture.db, 'checkpoints')).toBe(0);
      expect(countRows(fixture.db, 'tasks')).toBe(0);
      expect(countRows(fixture.db, 'memory_items')).toBe(1);
      expect(fixture.invalidate).toHaveBeenCalledWith('conv_1');
    } finally {
      await fixture.close();
    }
  });
});

async function createFixture(options: { boundConversationId?: string } = {}): Promise<{
  db: Database.Database;
  conversations: SqliteConversationStore;
  messages: SqliteMessageStore;
  service: ReturnType<typeof createConversationManagementService>;
  invalidate: ReturnType<typeof vi.fn>;
  seedConversation(conversationId: string): Promise<void>;
  close(): Promise<void>;
}> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  const messages = new SqliteMessageStore(db);
  const terminalBinding = terminalBindingService(options.boundConversationId ?? 'conv_mobile');
  const invalidate = vi.fn(() => 1);
  const service = createConversationManagementService({
    conversations,
    terminalBinding,
    systemPromptAssembler: { invalidate },
    clock: { now: () => 100 }
  });

  return {
    db,
    conversations,
    messages,
    service,
    invalidate,
    seedConversation(conversationId) {
      return conversations.upsert({
        conversationId,
        sessionKey: `linnsy:main:desktop:private:${conversationId}`,
        platform: 'desktop',
        chatType: 'private',
        chatId: conversationId,
        createdAt: 1,
        updatedAt: 1
      });
    },
    async close() {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  };
}

function terminalBindingService(conversationId: string): ConversationTerminalBindingLookupPort {
  return {
    getBinding: () => Promise.resolve({
      conversationId
    })
  };
}

function countRows(db: Database.Database, table: string): number {
  const row = db.prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return row?.count ?? 0;
}
