import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { LinnsyError } from '../../../../../shared/errors.js';
import { createTables } from '../../../../../persistence/schema/schema-provider.js';
import { UI_PREFERENCE_ERROR_CODES } from '../ui-preferences-store-port.js';
import {
  createDefaultUiPreferencesStore,
  SqliteUiPreferencesStore
} from '../sqlite-ui-preferences-store.js';

describe('sqlite ui preferences store', () => {
  test('returns registered defaults without prefilled table rows', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = createDefaultUiPreferencesStore(db, { now: () => 1_000 });

      await expect(store.get('theme.mode')).resolves.toBe('auto');
      await expect(store.getAll()).resolves.toMatchObject({
        'theme.mode': 'auto',
        'theme.primary_color': 'distant_sky',
        'font.size': 'medium',
        'sidebar.width_px': 260,
        'sidebar.archived_collapsed': true,
        last_opened_conversation_id: null,
        language: 'zh-CN'
      });
      expect(db.prepare('SELECT count(*) AS count FROM ui_preferences').get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('validates, persists, and resets JSON values by key', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = createDefaultUiPreferencesStore(db, { now: () => 1_234 });

      await store.set('theme.mode', 'dark');
      await store.set('sidebar.width_px', 320);
      await store.set('sidebar.width_px', 420);

      await expect(store.get('theme.mode')).resolves.toBe('dark');
      await expect(store.get('sidebar.width_px')).resolves.toBe(360);
      await store.set('sidebar.width_px', 180);
      await expect(store.get('sidebar.width_px')).resolves.toBe(200);
      expect(db.prepare('SELECT value, updated_at FROM ui_preferences WHERE key = ?').get('theme.mode'))
        .toEqual({ value: '"dark"', updated_at: 1_234 });

      await store.reset('theme.mode');
      await expect(store.get('theme.mode')).resolves.toBe('auto');
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('rejects unknown keys and invalid values with typed Linnsy errors', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = createDefaultUiPreferencesStore(db, { now: () => 1_000 });

      await expect(store.get('unknown.key')).rejects.toMatchObject({
        code: UI_PREFERENCE_ERROR_CODES.KEY_UNKNOWN,
        recoverable: false
      });
      await expect(store.set('theme.mode', 'neon')).rejects.toMatchObject({
        code: UI_PREFERENCE_ERROR_CODES.VALUE_INVALID,
        recoverable: false
      });
      await expect(store.set('theme.mode', 'neon')).rejects.toBeInstanceOf(LinnsyError);
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('maps legacy six-color theme values to current options', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = createDefaultUiPreferencesStore(db, { now: () => 1_234 });

      await store.set('theme.primary_color', 'gray');
      await expect(store.get('theme.primary_color')).resolves.toBe('distant_sky');

      await store.set('theme.primary_color', 'beige');
      await expect(store.get('theme.primary_color')).resolves.toBe('amber_yellow');
    } finally {
      db.close();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('supports registering a local strict schema', async () => {
    const { db, home } = await createStoreFixture();

    try {
      const store = new SqliteUiPreferencesStore(db, { now: () => 2_000 });
      store.register({
        key: 'custom.enabled',
        zod: (await import('zod')).z.boolean(),
        default: false
      });

      await expect(store.get('custom.enabled')).resolves.toBe(false);
      await store.set('custom.enabled', true);
      await expect(store.get('custom.enabled')).resolves.toBe(true);
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
