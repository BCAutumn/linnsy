import type Database from 'better-sqlite3';

import type { TerminalBindingRecord, TerminalBindingStorePort } from './terminal-binding-store-port.js';

interface TerminalBindingRow {
  terminal_id: string;
  conversation_id: string;
  updated_at: number;
  updated_by: string;
}

export class SqliteTerminalBindingStore implements TerminalBindingStorePort {
  private readonly getStatement: Database.Statement<[string], TerminalBindingRow>;
  private readonly upsertStatement: Database.Statement<[string, string, number, string]>;

  public constructor(private readonly db: Database.Database) {
    this.getStatement = db.prepare<[string], TerminalBindingRow>(
      `SELECT
         terminal_id,
         conversation_id,
         updated_at,
         updated_by
       FROM terminal_bindings
       WHERE terminal_id = ?`
    );
    this.upsertStatement = db.prepare(
      `INSERT INTO terminal_bindings (
         terminal_id,
         conversation_id,
         updated_at,
         updated_by
       )
       VALUES (?, ?, ?, ?)
       ON CONFLICT(terminal_id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
    );
  }

  public get(terminalId: string): Promise<TerminalBindingRecord | null> {
    const row = this.getStatement.get(terminalId);
    return Promise.resolve(row === undefined ? null : toTerminalBindingRecord(row));
  }

  public upsert(record: TerminalBindingRecord): Promise<void> {
    this.upsertStatement.run(
      record.terminalId,
      record.conversationId,
      record.updatedAt,
      record.updatedBy
    );
    return Promise.resolve();
  }
}

function toTerminalBindingRecord(row: TerminalBindingRow): TerminalBindingRecord {
  return {
    terminalId: row.terminal_id,
    conversationId: row.conversation_id,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  };
}
