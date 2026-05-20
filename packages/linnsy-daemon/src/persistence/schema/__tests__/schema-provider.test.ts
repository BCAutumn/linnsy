import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../__tests__/harness/temp-home.js';
import { createTables } from '../schema-provider.js';

describe('createTables', () => {
  test('creates the Phase 1 tables and is idempotent', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);
      createTables(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
        .all()
        .map((row) => readName(row));

      expect(tables).toEqual(
        expect.arrayContaining([
          'checkpoints',
          'conversations',
          'cron_jobs',
          'cron_runs',
          'memory_items',
          'memory_items_fts',
          'messages',
          'pairings',
          'runs',
          'tasks',
          'telemetry_events',
          'ui_preferences'
        ])
      );
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('keeps optional message metadata available for context fence replay', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);

      const columns = db
        .prepare("PRAGMA table_info('messages')")
        .all()
        .map((row) => readName(row));

      expect(columns).toContain('metadata_json');
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('adds conversation pinning and activity metadata for old and new databases', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);

      const columns = db
        .prepare("PRAGMA table_info('conversations')")
        .all()
        .map((row) => readName(row));

      expect(columns).toContain('pinned_at');
      expect(columns).toContain('last_activity_at');
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('backfills conversation activity from visible messages and events', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      db.exec(`
        CREATE TABLE conversations (
          conversation_id TEXT PRIMARY KEY,
          session_key TEXT NOT NULL UNIQUE,
          platform TEXT NOT NULL,
          chat_type TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE messages (
          message_id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          source TEXT NOT NULL,
          platform TEXT,
          provider_message_id TEXT,
          run_id TEXT,
          text TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE events (
          event_id TEXT PRIMARY KEY,
          seq INTEGER NOT NULL,
          kind TEXT NOT NULL,
          conversation_id TEXT,
          message_id TEXT,
          run_id TEXT,
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      db.prepare(
        'INSERT INTO conversations (conversation_id, session_key, platform, chat_type, chat_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run('conv_1', 'linnsy:main:cli:private:local', 'cli', 'private', 'local', 1, 1);
      db.prepare(
        'INSERT INTO messages (message_id, conversation_id, role, source, text, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('msg_1', 'conv_1', 'user', 'inbound', 'hello', 20);
      db.prepare(
        'INSERT INTO events (event_id, seq, kind, conversation_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('evt_channel', 1, 'system.event', 'conv_1', '{"sourceKind":"channel_status"}', 40);
      db.prepare(
        'INSERT INTO events (event_id, seq, kind, conversation_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('evt_task', 2, 'system.event', 'conv_1', '{"sourceKind":"task_status_change"}', 30);
      db.prepare(
        'INSERT INTO events (event_id, seq, kind, conversation_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('evt_notice', 3, 'system.event', 'conv_1', '{"sourceKind":"task_execution_notice"}', 35);

      createTables(db);

      const row = db
        .prepare('SELECT last_activity_at FROM conversations WHERE conversation_id = ?')
        .get('conv_1');
      expect(readNumberColumn(row, 'last_activity_at')).toBe(35);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('enables required sqlite pragmas', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);

      expect(readPragmaValue(db.pragma('journal_mode', { simple: true }))).toBe('wal');
      expect(readPragmaValue(db.pragma('foreign_keys', { simple: true }))).toBe(1);
      expect(readPragmaValue(db.pragma('busy_timeout', { simple: true }))).toBe(5000);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('keeps telemetry_events aligned with docs/02b §2.10', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);

      const columns = db
        .prepare("PRAGMA table_info('telemetry_events')")
        .all()
        .map((row) => readName(row));

      expect(columns).toEqual(['ts', 'kind', 'scope_json', 'payload_json']);
      db.prepare(
        'INSERT INTO telemetry_events (ts, kind, scope_json, payload_json) VALUES (?, ?, ?, ?)'
      ).run(100, 'run_lifecycle', '{"runId":"run_1"}', '{"status":"completed"}');
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('keeps ui_preferences aligned with docs/02b §2.11', async () => {
    const home = await createTempLinnsyHome();
    const db = new Database(join(home, 'state.db'));

    try {
      createTables(db);

      const columns = db
        .prepare("PRAGMA table_info('ui_preferences')")
        .all()
        .map((row) => readName(row));

      expect(columns).toEqual(['key', 'value', 'updated_at']);
      db.prepare(
        'INSERT INTO ui_preferences (key, value, updated_at) VALUES (?, ?, ?)'
      ).run('theme.mode', '"dark"', 100);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});

function readName(row: unknown): string {
  if (typeof row === 'object' && row !== null && 'name' in row && typeof row.name === 'string') {
    return row.name;
  }

  throw new Error('Expected sqlite row with string name');
}

function readPragmaValue(value: unknown): string | number {
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }

  throw new Error('Expected sqlite pragma scalar');
}

function readNumberColumn(row: unknown, column: string): number {
  if (isRecord(row) && typeof row[column] === 'number') {
    return row[column];
  }

  throw new Error(`Expected sqlite row with numeric ${column}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
