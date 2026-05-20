import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../schema/schema-provider.js';
import { SqliteConversationStore } from '../../conversation/sqlite-conversation-store.js';
import { SqliteMessageStore } from '../sqlite-message-store.js';

describe('sqlite message store', () => {
  test('lists messages by conversation order', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      const conversations = new SqliteConversationStore(db);
      const messages = new SqliteMessageStore(db);

      await conversations.upsert({
        conversationId: 'conv_1',
        sessionKey: 'linnsy:main:cli:private:conv_1',
        platform: 'cli',
        chatType: 'private',
        chatId: 'conv_1',
        title: 'CLI',
        createdAt: 10,
        updatedAt: 20
      });
      await messages.insert({
        messageId: 'msg_1',
        conversationId: 'conv_1',
        role: 'user',
        source: 'inbound',
        text: 'hello',
        createdAt: 30
      });
      await messages.insert({
        messageId: 'msg_2',
        conversationId: 'conv_1',
        role: 'assistant',
        source: 'outbound',
        text: 'hi',
        runId: 'run_1',
        toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'answer', arguments: '{}' } }],
        createdAt: 40
      });

      await expect(messages.listByConversation('conv_1', { limit: 10 })).resolves.toMatchObject({
        messages: [
          { messageId: 'msg_1', text: 'hello' },
          { messageId: 'msg_2', runId: 'run_1' }
        ]
      });
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('enforces inbound provider message idempotency per platform', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      const conversations = new SqliteConversationStore(db);
      const messages = new SqliteMessageStore(db);

      await conversations.upsert({
        conversationId: 'conv_1',
        sessionKey: 'linnsy:main:telegram:private:chat_1',
        platform: 'telegram',
        chatType: 'private',
        chatId: 'chat_1',
        createdAt: 10,
        updatedAt: 10
      });

      await messages.insert({
        messageId: 'msg_1',
        conversationId: 'conv_1',
        role: 'user',
        source: 'inbound',
        platform: 'telegram',
        providerMessageId: 'update_1',
        text: 'hello',
        createdAt: 20
      });

      await expect(messages.insert({
        messageId: 'msg_2',
        conversationId: 'conv_1',
        role: 'user',
        source: 'inbound',
        platform: 'telegram',
        providerMessageId: 'update_1',
        text: 'duplicate',
        createdAt: 21
      })).rejects.toThrow();

      await expect(messages.insertIfProviderMessageAbsent({
        messageId: 'msg_3',
        conversationId: 'conv_1',
        role: 'user',
        source: 'inbound',
        platform: 'telegram',
        providerMessageId: 'update_1',
        text: 'duplicate ignored',
        createdAt: 22
      })).resolves.toBe(false);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('paginates without dropping the overflow message', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      const conversations = new SqliteConversationStore(db);
      const messages = new SqliteMessageStore(db);

      await conversations.upsert({
        conversationId: 'conv_1',
        sessionKey: 'linnsy:main:cli:private:local',
        platform: 'cli',
        chatType: 'private',
        chatId: 'local',
        createdAt: 10,
        updatedAt: 10
      });

      for (const id of ['msg_1', 'msg_2', 'msg_3']) {
        await messages.insert({
          messageId: id,
          conversationId: 'conv_1',
          role: 'user',
          source: 'inbound',
          text: id,
          createdAt: Number(id.at(-1))
        });
      }

      const firstPage = await messages.listByConversation('conv_1', { limit: 1 });
      expect(firstPage.messages.map((message) => message.messageId)).toEqual(['msg_1']);
      expect(firstPage.nextCursor).toBe('msg_1');
      if (firstPage.nextCursor === undefined) {
        throw new Error('first page should expose cursor');
      }

      const secondPage = await messages.listByConversation('conv_1', {
        limit: 1,
        cursor: firstPage.nextCursor
      });
      expect(secondPage.messages.map((message) => message.messageId)).toEqual(['msg_2']);
      expect(secondPage.nextCursor).toBe('msg_2');
      if (secondPage.nextCursor === undefined) {
        throw new Error('second page should expose cursor');
      }

      const thirdPage = await messages.listByConversation('conv_1', {
        limit: 1,
        cursor: secondPage.nextCursor
      });
      expect(thirdPage.messages.map((message) => message.messageId)).toEqual(['msg_3']);
      expect(thirdPage.nextCursor).toBeUndefined();
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('finds an existing provider message for inbound deduplication', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      const conversations = new SqliteConversationStore(db);
      const messages = new SqliteMessageStore(db);

      await conversations.upsert({
        conversationId: 'conv_1',
        sessionKey: 'linnsy:main:telegram:private:chat_1',
        platform: 'telegram',
        chatType: 'private',
        chatId: 'chat_1',
        createdAt: 10,
        updatedAt: 10
      });
      await messages.insert({
        messageId: 'msg_1',
        conversationId: 'conv_1',
        role: 'user',
        source: 'inbound',
        platform: 'telegram',
        providerMessageId: 'update_1',
        text: 'hello',
        createdAt: 20
      });

      await expect(messages.findByProviderMessage('telegram', 'update_1')).resolves.toMatchObject({
        messageId: 'msg_1',
        text: 'hello'
      });
      await expect(messages.findByProviderMessage('telegram', 'missing')).resolves.toBeNull();
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});
