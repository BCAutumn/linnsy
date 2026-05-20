import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../__tests__/harness/temp-home.js';
import { openLinnsyDatabase } from '../db.js';

describe('openLinnsyDatabase', () => {
  test('opens the daemon database with schema and sqlite performance pragmas applied', async () => {
    const home = await createTempLinnsyHome();
    const dbPath = join(home, 'state.db');

    try {
      const db = openLinnsyDatabase(dbPath);
      try {
        const table = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'")
          .get();

        expect(table).toBeDefined();
        expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
        expect(db.pragma('synchronous', { simple: true })).toBe(1);
        await expect(fileMode(home)).resolves.toBe(0o700);
        await expect(fileMode(dbPath)).resolves.toBe(0o600);
        await expect(fileMode(`${dbPath}-wal`)).resolves.toBe(0o600);
        await expect(fileMode(`${dbPath}-shm`)).resolves.toBe(0o600);
      } finally {
        db.close();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

async function fileMode(path: string): Promise<number> {
  const stats = await stat(path);
  return stats.mode & 0o777;
}
