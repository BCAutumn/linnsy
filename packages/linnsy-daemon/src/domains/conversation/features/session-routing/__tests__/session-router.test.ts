import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { SqliteConversationStore } from '../../../../../persistence/stores/conversation/sqlite-conversation-store.js';
import type { ClockPort } from '../../../../../shared/ports.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import { buildSessionKey, createSessionRouter } from '../session-router.js';

interface RouterFixture {
  conversations: SqliteConversationStore;
  router: ReturnType<typeof createSessionRouter>;
  setNow: (value: number) => void;
  cleanup: () => Promise<void>;
}

async function createFixture(initialNow = 1_000): Promise<RouterFixture> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  const conversations = new SqliteConversationStore(db);
  let now = initialNow;
  const clock: ClockPort = { now: () => now };
  const router = createSessionRouter({
    conversations,
    clock,
    conversationIdFactory: (sessionKey) => `id_${sessionKey}`,
    desktopChatIdFactory: () => 'window:branch:test'
  });
  return {
    conversations,
    router,
    setNow: (value: number) => {
      now = value;
    },
    cleanup: async () => {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  };
}

describe('buildSessionKey', () => {
  test('uses linnsy:main:{platform}:{chatType}:{chatId} pattern', () => {
    expect(buildSessionKey({ platform: 'cli', chatType: 'private', chatId: 'local' })).toBe(
      'linnsy:main:cli:private:local'
    );
    expect(buildSessionKey({ platform: 'telegram', chatType: 'group', chatId: '42' })).toBe(
      'linnsy:main:telegram:group:42'
    );
  });
});

describe('SessionRouter.resolve', () => {
  test('creates conversation on first contact and reuses it on second contact', async () => {
    const { router, conversations, setNow, cleanup } = await createFixture(1_000);
    try {
      const first = await router.resolve({
        platform: 'cli',
        chatType: 'private',
        chatId: 'local'
      });
      expect(first.isNew).toBe(true);
      expect(first.sessionKey).toBe('linnsy:main:cli:private:local');
      expect(first.conversationId).toBe('id_linnsy:main:cli:private:local');
      expect(first.createdAt).toBe(1_000);

      setNow(2_000);
      const second = await router.resolve({
        platform: 'cli',
        chatType: 'private',
        chatId: 'local'
      });
      expect(second.isNew).toBe(false);
      expect(second.conversationId).toBe(first.conversationId);
      expect(second.updatedAt).toBe(2_000);

      const stored = await conversations.get(first.conversationId);
      expect(stored?.updatedAt).toBe(2_000);
    } finally {
      await cleanup();
    }
  });

  test('persists userId and merges metadata across contacts', async () => {
    const { router, conversations, cleanup } = await createFixture();
    try {
      await router.resolve({
        platform: 'telegram',
        chatType: 'private',
        chatId: 'chat_1',
        userId: 'user_1',
        metadata: { source: 'webhook' }
      });
      await router.resolve({
        platform: 'telegram',
        chatType: 'private',
        chatId: 'chat_1',
        metadata: { lastUpdate: 'edited' }
      });
      const record = await conversations.findBySessionKey(
        buildSessionKey({ platform: 'telegram', chatType: 'private', chatId: 'chat_1' })
      );
      expect(record?.userId).toBe('user_1');
      expect(record?.metadata).toEqual({ source: 'webhook', lastUpdate: 'edited' });
    } finally {
      await cleanup();
    }
  });
});

describe('SessionRouter.createDesktopConversation', () => {
  test('creates a desktop private conversation using the shared session key format', async () => {
    const { router, conversations, cleanup } = await createFixture(1_000);
    try {
      const lookup = await router.createDesktopConversation();

      expect(lookup).toMatchObject({
        conversationId: 'id_linnsy:main:desktop:private:window:branch:test',
        sessionKey: 'linnsy:main:desktop:private:window:branch:test',
        platform: 'desktop',
        chatType: 'private',
        chatId: 'window:branch:test',
        isNew: true,
        createdAt: 1_000,
        updatedAt: 1_000,
        lastActivityAt: 1_000
      });

      await expect(conversations.get(lookup.conversationId)).resolves.toMatchObject({
        conversationId: lookup.conversationId,
        sessionKey: lookup.sessionKey,
        platform: 'desktop',
        chatType: 'private',
        chatId: 'window:branch:test'
      });
    } finally {
      await cleanup();
    }
  });
});

describe('SessionRouter.setTitleIfMissing', () => {
  test('sets the first user message as title once and preserves later summaries', async () => {
    const { router, conversations, cleanup } = await createFixture(1_000);
    try {
      const lookup = await router.createDesktopConversation();

      await router.setTitleIfMissing(lookup.conversationId, '  第一条   用户消息  ');
      await expect(conversations.get(lookup.conversationId)).resolves.toMatchObject({
        title: '第一条 用户消息'
      });

      await router.setTitleIfMissing(lookup.conversationId, '第二条消息');
      await expect(conversations.get(lookup.conversationId)).resolves.toMatchObject({
        title: '第一条 用户消息'
      });
    } finally {
      await cleanup();
    }
  });
});

describe('SessionRouter.archive', () => {
  test('marks conversation as archived', async () => {
    const { router, conversations, setNow, cleanup } = await createFixture(1_000);
    try {
      const lookup = await router.resolve({
        platform: 'cli',
        chatType: 'private',
        chatId: 'local'
      });
      setNow(5_000);
      await router.archive(lookup.conversationId);
      const record = await conversations.get(lookup.conversationId);
      expect(record?.archivedAt).toBe(5_000);
      expect(record?.updatedAt).toBe(5_000);
    } finally {
      await cleanup();
    }
  });

  test('throws LINNSY_SESSION_NOT_FOUND for missing conversation', async () => {
    const { router, cleanup } = await createFixture();
    try {
      await expect(router.archive('does_not_exist')).rejects.toMatchObject({
        code: LINNSY_ERROR_CODES.SESSION_NOT_FOUND
      });
      await expect(router.archive('does_not_exist')).rejects.toBeInstanceOf(LinnsyError);
    } finally {
      await cleanup();
    }
  });
});

describe('SessionRouter.list', () => {
  test('lists active conversations and respects platform/activeWithinMs filter', async () => {
    const { router, setNow, cleanup } = await createFixture(1_000);
    try {
      await router.resolve({ platform: 'cli', chatType: 'private', chatId: 'local' });
      setNow(2_000);
      await router.resolve({ platform: 'telegram', chatType: 'private', chatId: 'chat_a' });
      setNow(3_000);
      await router.resolve({ platform: 'telegram', chatType: 'group', chatId: 'group_b' });

      setNow(10_000);
      const all = await router.list();
      expect(all.map((s) => s.platform)).toEqual(['telegram', 'telegram', 'cli']);

      const onlyTelegram = await router.list({ platform: 'telegram' });
      expect(onlyTelegram.length).toBe(2);

      const recent = await router.list({ activeWithinMs: 8_000 });
      expect(recent.map((s) => s.chatId)).toEqual(['group_b', 'chat_a']);
    } finally {
      await cleanup();
    }
  });

  test('hides archived conversations by default', async () => {
    const { router, cleanup } = await createFixture();
    try {
      const lookup = await router.resolve({
        platform: 'cli',
        chatType: 'private',
        chatId: 'local'
      });
      await router.archive(lookup.conversationId);

      const visible = await router.list();
      expect(visible).toEqual([]);

      const includingArchived = await router.list({ includeArchived: true });
      expect(includingArchived.length).toBe(1);
      expect(includingArchived[0]?.archivedAt).toBeDefined();
    } finally {
      await cleanup();
    }
  });
});
