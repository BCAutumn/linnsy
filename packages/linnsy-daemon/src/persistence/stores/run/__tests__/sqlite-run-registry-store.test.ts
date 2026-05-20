import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../schema/schema-provider.js';
import { SqliteRunRegistryStore } from '../sqlite-run-registry-store.js';

type LinnkitMemoryRunRegistryStore = InstanceType<typeof runSupervisor.MemoryRunRegistryStore>;
type RunRecord = NonNullable<Awaited<ReturnType<LinnkitMemoryRunRegistryStore['load']>>>;

describe('SqliteRunRegistryStore', () => {
  test('upserts, loads, filters, pages, and deletes run records', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      seedConversation(db, 'conv_1');

      const store = new SqliteRunRegistryStore(db);
      const first: RunRecord = {
        runId: 'run_1',
        conversationId: 'conv_1',
        status: 'running',
        currentNode: 'llm',
        startedAt: 10,
        updatedAt: 20,
        iterationsUsed: 2,
        iterationBudget: {
          max: 8,
          refundable: true
        },
        metadata: {
          source: 'unit'
        }
      };
      const second: RunRecord = {
        runId: 'run_2',
        conversationId: 'conv_1',
        status: 'completed',
        startedAt: 30,
        updatedAt: 40
      };

      await store.save(first);
      await store.save(second);
      await store.save({ ...first, status: 'awaiting_user', updatedAt: 50 });

      await expect(store.load('run_1')).resolves.toMatchObject({
        runId: 'run_1',
        status: 'awaiting_user',
        iterationBudget: { max: 8, refundable: true },
        metadata: { source: 'unit' }
      });
      await expect(store.list({ status: ['awaiting_user', 'completed'], limit: 1 })).resolves.toEqual({
        runs: [expect.objectContaining({ runId: 'run_1' })],
        nextCursor: 'run_1'
      });

      await store.delete('run_1');

      await expect(store.load('run_1')).resolves.toBeNull();
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('supports parent/status filters, empty status filters, and error metadata', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      seedConversation(db, 'conv_1');

      const store = new SqliteRunRegistryStore(db);
      await store.save({
        runId: 'parent',
        conversationId: 'conv_1',
        status: 'failed',
        startedAt: 1,
        updatedAt: 1,
        errorIfAny: {
          errorCode: 'BOOM',
          message: 'failed',
          recoverable: false
        }
      });
      await store.save({
        runId: 'child',
        conversationId: 'conv_1',
        parentRunId: 'parent',
        status: 'running',
        startedAt: 2,
        updatedAt: 2
      });

      await expect(store.load('parent')).resolves.toMatchObject({
        errorIfAny: {
          errorCode: 'BOOM',
          recoverable: false
        }
      });
      await expect(store.list({ status: 'running', parentRunId: 'parent' })).resolves.toEqual({
        runs: [expect.objectContaining({ runId: 'child' })]
      });
      await expect(store.list({ status: [], startedAfter: 0, startedBefore: 10 })).resolves.toEqual({
        runs: []
      });
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('paginates without dropping the overflow run', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      seedConversation(db, 'conv_1');

      const store = new SqliteRunRegistryStore(db);
      for (const runId of ['run_1', 'run_2', 'run_3']) {
        const index = Number(runId.at(-1));
        await store.save({
          runId,
          conversationId: 'conv_1',
          status: 'completed',
          startedAt: index,
          updatedAt: index
        });
      }

      const firstPage = await store.list({ limit: 1 });
      expect(firstPage.runs.map((run) => run.runId)).toEqual(['run_3']);
      expect(firstPage.nextCursor).toBe('run_3');
      if (firstPage.nextCursor === undefined) {
        throw new Error('first page should expose cursor');
      }

      const secondPage = await store.list({ limit: 1, cursor: firstPage.nextCursor });
      expect(secondPage.runs.map((run) => run.runId)).toEqual(['run_2']);
      expect(secondPage.nextCursor).toBe('run_2');
      if (secondPage.nextCursor === undefined) {
        throw new Error('second page should expose cursor');
      }

      const thirdPage = await store.list({ limit: 1, cursor: secondPage.nextCursor });
      expect(thirdPage.runs.map((run) => run.runId)).toEqual(['run_1']);
      expect(thirdPage.nextCursor).toBeUndefined();
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});

function seedConversation(db: Database.Database, conversationId: string): void {
  db.prepare(
    'INSERT INTO conversations (conversation_id, session_key, platform, chat_type, chat_id, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(conversationId, `linnsy:test:${conversationId}`, 'cli', 'private', conversationId, 1, 1, 1);
}
