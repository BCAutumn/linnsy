import type Database from 'better-sqlite3';
import { join } from 'node:path';

import { openLinnsyDatabase } from '../../src/persistence/db.js';
import { createTempLinnsyHome } from './temp-home.js';

export interface TestDatabaseHarness {
  home: string;
  dbPath: string;
  db: Database.Database;
}

export async function createTestDatabase(): Promise<TestDatabaseHarness> {
  const home = await createTempLinnsyHome();
  const dbPath = join(home, 'state.db');
  const db = openLinnsyDatabase(dbPath);

  return {
    home,
    dbPath,
    db
  };
}
