import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../__tests__/harness/temp-home.js';
import { LinnsyError } from '../../../../shared/errors.js';
import { createTables } from '../../../../persistence/schema/schema-provider.js';
import { MEMORY_ERROR_CODES } from '../memory-store-port.js';
import { SqliteMemoryStore } from '../sqlite-memory-store.js';

describe('sqlite memory store', () => {
  test('upserts fixed memory section content without a title field', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = new SqliteMemoryStore(db, {
        now: () => 1_000,
        idFactory: () => 'mem_1'
      });

      const item = await store.upsert({
        scope: 'owner_profile',
        body: '主人希望 Linnsy 称呼自己为天司。',
        conversationId: 'conv_1',
        metadata: { approvedBy: 'owner' }
      });

      expect(item).toEqual({
        memoryId: 'mem_1',
        scope: 'owner_profile',
        body: '主人希望 Linnsy 称呼自己为天司。',
        createdAt: 1_000,
        updatedAt: 1_000,
        conversationId: 'conv_1',
        metadata: { approvedBy: 'owner' }
      });
      expect(db.prepare('SELECT content, metadata_json FROM memory_items WHERE memory_id = ?').get('mem_1'))
        .toMatchObject({
          content: '主人希望 Linnsy 称呼自己为天司。',
          metadata_json: '{"approvedBy":"owner","conversationId":"conv_1"}'
        });
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('updates existing items while preserving created_at', async () => {
    const { db, home } = await createStoreFixture();
    let now = 1_000;

    try {
      const store = new SqliteMemoryStore(db, {
        now: () => now,
        idFactory: () => 'mem_1'
      });

      await store.upsert({
        scope: 'owner_profile',
        body: '旧内容'
      });
      now = 2_000;
      const updated = await store.upsert({
        memoryId: 'mem_1',
        scope: 'project',
        body: '新内容'
      });

      expect(updated.createdAt).toBe(1_000);
      expect(updated.updatedAt).toBe(2_000);
      expect(updated.scope).toBe('project');
      expect(updated.body).toBe('新内容');
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('recalls by FTS query, scope, and update order', async () => {
    const { db, home } = await createStoreFixture();
    let nextId = 0;

    try {
      const store = new SqliteMemoryStore(db, {
        now: () => 1_000 + nextId,
        idFactory: () => {
          nextId += 1;
          return `mem_${String(nextId)}`;
        }
      });
      await store.upsert({
        scope: 'owner_profile',
        body: '主人喜欢清晨写代码。'
      });
      await store.upsert({
        scope: 'owner_profile',
        body: '主人喜欢清晨写代码，并希望回答直接一点。'
      });
      await store.upsert({
        scope: 'project',
        body: 'Linnsy 项目需要真实记忆。'
      });

      await expect(store.recall({ query: '清晨 写代码', scope: 'owner_profile' })).resolves.toMatchObject([
        { memoryId: 'mem_2' },
        { memoryId: 'mem_1' }
      ]);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('soft deletes archived memory items from default recall and list', async () => {
    const { db, home } = await createStoreFixture();
    let now = 1_000;

    try {
      const store = new SqliteMemoryStore(db, {
        now: () => now,
        idFactory: () => 'mem_1'
      });
      await store.upsert({
        scope: 'owner_profile',
        body: '主人希望被称呼为天司。'
      });

      now = 2_000;
      await expect(store.remove('mem_1')).resolves.toBe(true);
      await expect(store.recall({ query: '天司' })).resolves.toEqual([]);
      await expect(store.list()).resolves.toEqual([]);
      await expect(store.list({ includeArchived: true })).resolves.toMatchObject([
        { memoryId: 'mem_1', archivedAt: 2_000 }
      ]);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('rejects empty required fields with typed Linnsy errors', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = new SqliteMemoryStore(db, {
        now: () => 1_000,
        idFactory: () => 'mem_1'
      });

      await expect(store.upsert({
        scope: 'owner_profile',
        body: ' '
      })).rejects.toMatchObject({
        code: MEMORY_ERROR_CODES.ITEM_INVALID,
        recoverable: false
      });
      await expect(store.upsert({
        scope: 'owner_profile',
        body: ' '
      })).rejects.toBeInstanceOf(LinnsyError);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});

async function createStoreFixture(): Promise<{ db: Database.Database; home: string }> {
  const home = await createTempLinnsyHome();
  const db = new Database(join(home, 'state.db'));
  createTables(db);
  return { db, home };
}
