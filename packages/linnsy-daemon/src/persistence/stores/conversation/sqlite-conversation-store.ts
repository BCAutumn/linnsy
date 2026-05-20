import type Database from 'better-sqlite3';

import { parseJsonObject, stringifyJsonValue } from '../../json.js';
import type {
  ConversationPermanentDeleteOptions,
  ConversationPermanentDeleteResult,
  ConversationRecord,
  ConversationStorePort,
  ConversationUpsertInput,
  ListConversationsFilter
} from './conversation-store-port.js';

interface ConversationRow {
  conversation_id: string;
  session_key: string;
  platform: string;
  chat_type: string;
  chat_id: string;
  user_id: string | null;
  title: string | null;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  pinned_at: number | null;
  archived_at: number | null;
  metadata_json: string | null;
}

export class SqliteConversationStore implements ConversationStorePort {
  private readonly upsertStatement: Database.Statement<[
    string,
    string,
    string,
    string,
    string,
    string | null,
    string | null,
    number,
    number,
    number,
    number | null,
    number | null,
    string | null
  ]>;
  private readonly getStatement: Database.Statement<[string], ConversationRow>;
  private readonly findBySessionKeyStatement: Database.Statement<[string], ConversationRow>;
  private readonly renameStatement: Database.Statement<[string | null, number, string]>;
  private readonly setPinnedStatement: Database.Statement<[number | null, number, string]>;
  private readonly archiveStatement: Database.Statement<[number, number, string]>;
  private readonly unarchiveStatement: Database.Statement<[number, string]>;
  private readonly markActivityStatement: Database.Statement<[number, number, number, string, number]>;
  private readonly purgeStatement: Database.Statement<[string]>;
  private readonly deleteEventsStatement: Database.Statement<[string]>;
  private readonly detachTaskParentsStatement: Database.Statement<[string]>;
  private readonly deleteTasksStatement: Database.Statement<[string]>;
  private readonly deleteRunsStatement: Database.Statement<[string]>;
  private readonly deleteCheckpointsStatement: Database.Statement<[string]>;
  private readonly deleteMessagesStatement: Database.Statement<[string]>;
  private readonly deleteConversationStatement: Database.Statement<[string]>;
  private readonly permanentDeleteShortTermDataTransaction: (
    conversationId: string,
    options: ConversationPermanentDeleteOptions
  ) => ConversationPermanentDeleteResult;

  public constructor(private readonly db: Database.Database) {
    this.upsertStatement = db.prepare(
      `INSERT INTO conversations (
         conversation_id,
         session_key,
         platform,
         chat_type,
         chat_id,
         user_id,
         title,
         created_at,
         updated_at,
         last_activity_at,
         pinned_at,
         archived_at,
         metadata_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         session_key = excluded.session_key,
         platform = excluded.platform,
         chat_type = excluded.chat_type,
         chat_id = excluded.chat_id,
         user_id = excluded.user_id,
         title = excluded.title,
         updated_at = excluded.updated_at,
         last_activity_at = excluded.last_activity_at,
         pinned_at = excluded.pinned_at,
         archived_at = excluded.archived_at,
         metadata_json = excluded.metadata_json`
    );
    this.getStatement = db.prepare<[string], ConversationRow>(
      `SELECT
         conversation_id,
         session_key,
         platform,
         chat_type,
         chat_id,
         user_id,
         title,
         created_at,
         updated_at,
         last_activity_at,
         pinned_at,
         archived_at,
         metadata_json
       FROM conversations
       WHERE conversation_id = ?`
    );
    this.findBySessionKeyStatement = db.prepare<[string], ConversationRow>(
      `SELECT
         conversation_id,
         session_key,
         platform,
         chat_type,
         chat_id,
         user_id,
         title,
         created_at,
         updated_at,
         last_activity_at,
         pinned_at,
         archived_at,
         metadata_json
       FROM conversations
       WHERE session_key = ?`
    );
    this.renameStatement = db.prepare(
      `UPDATE conversations
         SET title = ?, updated_at = ?
       WHERE conversation_id = ?`
    );
    this.setPinnedStatement = db.prepare(
      `UPDATE conversations
         SET pinned_at = ?, updated_at = ?
       WHERE conversation_id = ?`
    );
    this.archiveStatement = db.prepare(
      `UPDATE conversations
         SET archived_at = ?, updated_at = ?
       WHERE conversation_id = ?`
    );
    this.unarchiveStatement = db.prepare(
      `UPDATE conversations
         SET archived_at = NULL, updated_at = ?
       WHERE conversation_id = ?`
    );
    this.markActivityStatement = db.prepare(
      `UPDATE conversations
         SET last_activity_at = ?,
             updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END
       WHERE conversation_id = ?
         AND last_activity_at < ?`
    );
    this.purgeStatement = db.prepare('DELETE FROM conversations WHERE conversation_id = ?');
    this.deleteEventsStatement = db.prepare('DELETE FROM events WHERE conversation_id = ?');
    this.detachTaskParentsStatement = db.prepare('UPDATE tasks SET parent_task_id = NULL WHERE conversation_id = ?');
    this.deleteTasksStatement = db.prepare('DELETE FROM tasks WHERE conversation_id = ?');
    this.deleteRunsStatement = db.prepare('DELETE FROM runs WHERE conversation_id = ?');
    this.deleteCheckpointsStatement = db.prepare('DELETE FROM checkpoints WHERE conversation_id = ?');
    this.deleteMessagesStatement = db.prepare('DELETE FROM messages WHERE conversation_id = ?');
    this.deleteConversationStatement = db.prepare('DELETE FROM conversations WHERE conversation_id = ?');
    const permanentDeleteShortTermData = (
      conversationId: string,
      options: ConversationPermanentDeleteOptions
    ): ConversationPermanentDeleteResult => (
      this.deleteShortTermDataInTransaction(conversationId, options)
    );
    this.permanentDeleteShortTermDataTransaction = db.transaction(permanentDeleteShortTermData);
  }

  public upsert(record: ConversationUpsertInput): Promise<void> {
    this.upsertStatement.run(
      record.conversationId,
      record.sessionKey,
      record.platform,
      record.chatType,
      record.chatId,
      record.userId ?? null,
      record.title ?? null,
      record.createdAt,
      record.updatedAt,
      record.lastActivityAt ?? record.updatedAt,
      record.pinnedAt ?? null,
      record.archivedAt ?? null,
      record.metadata === undefined ? null : stringifyJsonValue(record.metadata)
    );
    return Promise.resolve();
  }

  public get(conversationId: string): Promise<ConversationRecord | null> {
    const row = this.getStatement.get(conversationId);
    return Promise.resolve(row === undefined ? null : toConversationRecord(row));
  }

  public findBySessionKey(sessionKey: string): Promise<ConversationRecord | null> {
    const row = this.findBySessionKeyStatement.get(sessionKey);
    return Promise.resolve(row === undefined ? null : toConversationRecord(row));
  }

  public rename(conversationId: string, title: string | null, updatedAt: number): Promise<boolean> {
    const result = this.renameStatement.run(title, updatedAt, conversationId);
    return Promise.resolve(result.changes > 0);
  }

  public setPinned(conversationId: string, pinnedAt: number | null, updatedAt: number): Promise<boolean> {
    const result = this.setPinnedStatement.run(pinnedAt, updatedAt, conversationId);
    return Promise.resolve(result.changes > 0);
  }

  public archive(conversationId: string, archivedAt: number): Promise<boolean> {
    const result = this.archiveStatement.run(archivedAt, archivedAt, conversationId);
    return Promise.resolve(result.changes > 0);
  }

  public unarchive(conversationId: string, updatedAt: number): Promise<boolean> {
    const result = this.unarchiveStatement.run(updatedAt, conversationId);
    return Promise.resolve(result.changes > 0);
  }

  public markActivity(conversationId: string, activityAt: number): boolean {
    const result = this.markActivityStatement.run(activityAt, activityAt, activityAt, conversationId, activityAt);
    return result.changes > 0;
  }

  public purge(conversationId: string): Promise<boolean> {
    const result = this.purgeStatement.run(conversationId);
    return Promise.resolve(result.changes > 0);
  }

  public permanentDeleteShortTermData(
    conversationId: string,
    options: ConversationPermanentDeleteOptions
  ): Promise<ConversationPermanentDeleteResult> {
    return Promise.resolve(this.permanentDeleteShortTermDataTransaction(conversationId, options));
  }

  public list(filter: ListConversationsFilter = {}): Promise<ConversationRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.includeArchived !== true) {
      clauses.push('archived_at IS NULL');
    }
    if (filter.platform !== undefined) {
      clauses.push('platform = ?');
      params.push(filter.platform);
    }
    if (filter.activeWithinMs !== undefined) {
      const referenceNow = filter.now ?? Date.now();
      clauses.push('last_activity_at >= ?');
      params.push(referenceNow - filter.activeWithinMs);
    }

    const whereClause = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const limit = filter.limit ?? 200;
    params.push(limit);

    const rows = this.db
      .prepare<unknown[], ConversationRow>(
        `SELECT
           conversation_id,
           session_key,
           platform,
           chat_type,
           chat_id,
           user_id,
           title,
           created_at,
           updated_at,
           last_activity_at,
           pinned_at,
           archived_at,
           metadata_json
         FROM conversations
         ${whereClause}
         ORDER BY last_activity_at DESC
         LIMIT ?`
      )
      .all(...params);

    return Promise.resolve(rows.map(toConversationRecord));
  }

  private deleteShortTermDataInTransaction(
    conversationId: string,
    options: ConversationPermanentDeleteOptions
  ): ConversationPermanentDeleteResult {
    const existing = this.getStatement.get(conversationId);
    if (existing === undefined) {
      return { status: 'not_found' };
    }
    if (this.hasActiveWork(conversationId, options)) {
      return { status: 'has_active_work' };
    }

    this.deleteEventsStatement.run(conversationId);
    // 同一对话内的子任务可能互相引用，删除前先断开父子边，避免 FK 卡住整批删除。
    this.detachTaskParentsStatement.run(conversationId);
    this.deleteTasksStatement.run(conversationId);
    this.deleteRunsStatement.run(conversationId);
    this.deleteCheckpointsStatement.run(conversationId);
    this.deleteMessagesStatement.run(conversationId);
    const result = this.deleteConversationStatement.run(conversationId);
    return result.changes > 0 ? { status: 'deleted' } : { status: 'not_found' };
  }

  private hasActiveWork(conversationId: string, options: ConversationPermanentDeleteOptions): boolean {
    const runs = this.countRowsByStatuses('runs', conversationId, options.activeRunStatuses);
    const tasks = this.countRowsByStatuses('tasks', conversationId, options.activeTaskStatuses);
    return runs > 0 || tasks > 0;
  }

  private countRowsByStatuses(
    tableName: 'runs' | 'tasks',
    conversationId: string,
    statuses: readonly string[]
  ): number {
    if (statuses.length === 0) {
      return 0;
    }
    const row = this.db
      .prepare<unknown[], { count: number }>(
        `SELECT COUNT(*) AS count
           FROM ${tableName}
          WHERE conversation_id = ?
            AND status IN (${buildSqlPlaceholders(statuses.length)})`
      )
      .get(conversationId, ...statuses);
    return row?.count ?? 0;
  }
}

function buildSqlPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function toConversationRecord(row: ConversationRow): ConversationRecord {
  const record: ConversationRecord = {
    conversationId: row.conversation_id,
    sessionKey: row.session_key,
    platform: row.platform,
    chatType: row.chat_type,
    chatId: row.chat_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at
  };

  if (row.user_id !== null) {
    record.userId = row.user_id;
  }
  if (row.title !== null) {
    record.title = row.title;
  }
  if (row.pinned_at !== null) {
    record.pinnedAt = row.pinned_at;
  }
  if (row.archived_at !== null) {
    record.archivedAt = row.archived_at;
  }

  const metadata = parseJsonObject(row.metadata_json, 'conversation metadata');
  if (metadata !== undefined) {
    record.metadata = metadata;
  }

  return record;
}
