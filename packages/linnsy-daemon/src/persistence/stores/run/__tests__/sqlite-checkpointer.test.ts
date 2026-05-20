import type { EngineState } from '@linnlabs/linnkit/runtime-kernel';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../__tests__/harness/temp-home.js';
import { createTables } from '../../../schema/schema-provider.js';
import { SqliteCheckpointer } from '../sqlite-checkpointer.js';

describe('SqliteCheckpointer', () => {
  test('saves, loads, peeks, lists, and clears graph engine state', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      seedConversation(db, 'conv_1');

      const checkpointer = new SqliteCheckpointer(db);
      const state: EngineState = {
        nodeId: 'llm',
        schemaVersion: 1,
        local: {
          executorLocal: {
            stepCount: 3
          },
          pendingToolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'recall_memory',
                arguments: '{"query":"water"}'
              }
            }
          ]
        }
      };

      await checkpointer.save('conv_1', state);

      await expect(checkpointer.load('conv_1')).resolves.toEqual(state);
      await expect(checkpointer.peekMeta('conv_1')).resolves.toMatchObject({
        conversationId: 'conv_1',
        schemaVersion: 1,
        currentNode: 'llm',
        iterations: 3,
        hasPendingToolCalls: true
      });
      await expect(checkpointer.list({ limit: 10 })).resolves.toEqual([
        expect.objectContaining({ conversationId: 'conv_1', currentNode: 'llm' })
      ]);

      await checkpointer.clear('conv_1');

      await expect(checkpointer.load('conv_1')).resolves.toBeNull();
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('round-trips unknown EngineState fields without lossy projection', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      seedConversation(db, 'conv_1');

      const checkpointer = new SqliteCheckpointer(db);
      const state = {
        nodeId: 'wait_user',
        schemaVersion: 1,
        local: {
          executorLocal: { stepCount: 2 }
        },
        turnState: {
          turnId: 'turn_1',
          yieldedAtNode: 'wait_user'
        },
        historySnapshot: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' }
        ],
        enginePrivate: {
          resumeToken: 'resume_1'
        }
      };

      await checkpointer.save('conv_1', state);

      await expect(checkpointer.load('conv_1')).resolves.toEqual(state);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('supports checkpoint listing filters and rejects malformed persisted state', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      seedConversation(db, 'conv_1');
      seedConversation(db, 'conv_2');

      const checkpointer = new SqliteCheckpointer(db);
      await checkpointer.save('conv_1', { nodeId: 'answer', schemaVersion: 1 });
      await checkpointer.save('conv_2', { nodeId: 'wait_user', schemaVersion: 1 });

      const all = await checkpointer.list({ limit: 1 });
      expect(all).toHaveLength(1);
      const first = all[0];
      if (first === undefined) {
        throw new Error('Expected at least one checkpoint summary');
      }
      await expect(checkpointer.list({ cursor: first.conversationId, limit: 10 })).resolves.toHaveLength(1);
      await expect(checkpointer.list({ savedAfter: Date.now() + 1000 })).resolves.toEqual([]);

      db.prepare('UPDATE checkpoints SET state_json = ? WHERE conversation_id = ?').run('{"local":{}}', 'conv_1');

      await expect(checkpointer.load('conv_1')).rejects.toThrow('checkpoint state must contain string nodeId');
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
