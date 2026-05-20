import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';

import { createTables } from './schema/schema-provider.js';

export function openLinnsyDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(dbPath), 0o700);
  const db = new Database(dbPath);
  createTables(db);
  ensureSqliteFilePermissions(dbPath);
  return db;
}

function ensureSqliteFilePermissions(dbPath: string): void {
  for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(filePath)) {
      chmodSync(filePath, 0o600);
    }
  }
}
