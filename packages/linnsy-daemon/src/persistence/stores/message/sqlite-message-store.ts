import type { ToolCall } from '@linnlabs/linnkit/ports';
import type Database from 'better-sqlite3';

import { isRecord, parseJsonValue, stringifyJsonValue } from '../../json.js';
import type { SendTarget } from '../../../shared/messaging.js';
import type { ListMessagesOptions, MessageRecord, MessageStorePort } from './message-store-port.js';

interface MessageRow {
  message_id: string;
  conversation_id: string;
  role: string;
  source: string;
  platform: string | null;
  chat_type: string | null;
  chat_id: string | null;
  provider_message_id: string | null;
  text: string | null;
  attachments_json: string | null;
  tool_calls_json: string | null;
  tool_result_json: string | null;
  reply_to_id: string | null;
  run_id: string | null;
  metadata_json: string | null;
  created_at: number;
}

interface InboundTargetRow {
  platform: SendTarget['platform'];
  chat_type: SendTarget['chatType'];
  chat_id: string;
  provider_message_id: string | null;
}

type MessageInsertParams = [
  string,
  string,
  string,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  number
];

export class SqliteMessageStore implements MessageStorePort {
  private readonly insertStatement: Database.Statement<MessageInsertParams>;
  private readonly insertIfProviderMessageAbsentStatement: Database.Statement<MessageInsertParams>;
  private readonly getStatement: Database.Statement<[string], MessageRow>;
  private readonly findByProviderMessageStatement: Database.Statement<[string, string], MessageRow>;
  private readonly findLatestInboundTargetStatement: Database.Statement<[string], InboundTargetRow>;
  private readonly listByRunIdStatement: Database.Statement<[string], MessageRow>;
  private readonly listRecentLimitedByConversationStatement: Database.Statement<[string, number], MessageRow>;
  private readonly listAllByConversationStatement: Database.Statement<[string], MessageRow>;

  public constructor(private readonly db: Database.Database) {
    this.insertStatement = db.prepare(
      `INSERT INTO messages (
         message_id,
         conversation_id,
         role,
         source,
         platform,
         chat_type,
         chat_id,
         provider_message_id,
         text,
         attachments_json,
         tool_calls_json,
         tool_result_json,
         reply_to_id,
         run_id,
         metadata_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.insertIfProviderMessageAbsentStatement = db.prepare(
      `INSERT INTO messages (
         message_id,
         conversation_id,
         role,
         source,
         platform,
         chat_type,
         chat_id,
         provider_message_id,
         text,
         attachments_json,
         tool_calls_json,
         tool_result_json,
         reply_to_id,
         run_id,
         metadata_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, provider_message_id)
       WHERE platform IS NOT NULL AND provider_message_id IS NOT NULL
       DO NOTHING`
    );
    this.getStatement = db.prepare<[string], MessageRow>(
      `SELECT
         message_id,
         conversation_id,
         role,
         source,
         platform,
         chat_type,
         chat_id,
         provider_message_id,
         text,
         attachments_json,
         tool_calls_json,
         tool_result_json,
         reply_to_id,
         run_id,
         metadata_json,
         created_at
       FROM messages
       WHERE message_id = ?`
    );
    this.findByProviderMessageStatement = db.prepare<[string, string], MessageRow>(
      `SELECT
         message_id,
         conversation_id,
         role,
         source,
         platform,
         chat_type,
         chat_id,
         provider_message_id,
         text,
         attachments_json,
         tool_calls_json,
         tool_result_json,
         reply_to_id,
         run_id,
         metadata_json,
         created_at
       FROM messages
       WHERE platform = ? AND provider_message_id = ?`
    );
    this.findLatestInboundTargetStatement = db.prepare<[string], InboundTargetRow>(
      `SELECT
         messages.platform,
         messages.chat_type,
         messages.chat_id,
         messages.provider_message_id
       FROM messages
       WHERE messages.conversation_id = ?
         AND messages.source = 'inbound'
         AND messages.platform IS NOT NULL
         AND messages.chat_type IS NOT NULL
         AND messages.chat_id IS NOT NULL
       ORDER BY messages.created_at DESC, messages.message_id DESC
       LIMIT 1`
    );
    this.listByRunIdStatement = db.prepare<[string], MessageRow>(
      `SELECT
         message_id,
         conversation_id,
         role,
         source,
         platform,
         chat_type,
         chat_id,
         provider_message_id,
         text,
         attachments_json,
         tool_calls_json,
         tool_result_json,
         reply_to_id,
         run_id,
         metadata_json,
         created_at
       FROM messages
       WHERE run_id = ?
       ORDER BY created_at ASC, message_id ASC`
    );
    this.listRecentLimitedByConversationStatement = db.prepare<[string, number], MessageRow>(
      `SELECT *
       FROM (
         SELECT
           message_id,
           conversation_id,
           role,
           source,
           platform,
           chat_type,
           chat_id,
           provider_message_id,
           text,
           attachments_json,
           tool_calls_json,
           tool_result_json,
           reply_to_id,
           run_id,
           metadata_json,
           created_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC, message_id DESC
         LIMIT ?
       )
       ORDER BY created_at ASC, message_id ASC`
    );
    this.listAllByConversationStatement = db.prepare<[string], MessageRow>(
      `SELECT
         message_id,
         conversation_id,
         role,
         source,
         platform,
         chat_type,
         chat_id,
         provider_message_id,
         text,
         attachments_json,
         tool_calls_json,
         tool_result_json,
         reply_to_id,
         run_id,
         metadata_json,
         created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, message_id ASC`
    );
  }

  public insert(record: MessageRecord): Promise<void> {
    return Promise.resolve().then(() => {
      this.runInsert(this.insertStatement, record);
    });
  }

  public insertIfProviderMessageAbsent(record: MessageRecord): Promise<boolean> {
    return Promise.resolve().then(() => {
      return this.runInsert(this.insertIfProviderMessageAbsentStatement, record).changes > 0;
    });
  }

  public get(messageId: string): Promise<MessageRecord | null> {
    const row = this.getStatement.get(messageId);
    return Promise.resolve(row === undefined ? null : toMessageRecord(row));
  }

  public findByProviderMessage(platform: string, providerMessageId: string): Promise<MessageRecord | null> {
    const row = this.findByProviderMessageStatement.get(platform, providerMessageId);
    return Promise.resolve(row === undefined ? null : toMessageRecord(row));
  }

  public listByRunId(runId: string): Promise<MessageRecord[]> {
    const rows = this.listByRunIdStatement.all(runId);
    return Promise.resolve(rows.map(toMessageRecord));
  }

  public findLatestInboundTarget(conversationId: string): Promise<SendTarget | null> {
    const row = this.findLatestInboundTargetStatement.get(conversationId);
    if (row === undefined) {
      return Promise.resolve(null);
    }
    const target: SendTarget = {
      platform: row.platform,
      chatType: row.chat_type,
      chatId: row.chat_id
    };
    if (row.provider_message_id !== null) {
      target.replyToProviderMessageId = row.provider_message_id;
    }
    return Promise.resolve(target);
  }

  public listByConversation(
    conversationId: string,
    options: ListMessagesOptions = {}
  ): Promise<{ messages: MessageRecord[]; nextCursor?: string }> {
    const limit = options.limit ?? 100;
    const params: unknown[] = [conversationId];
    const clauses = ['conversation_id = ?'];

    const cursorRow = options.cursor === undefined ? undefined : this.getStatement.get(options.cursor);
    if (cursorRow !== undefined) {
      clauses.push('(created_at > ? OR (created_at = ? AND message_id > ?))');
      params.push(cursorRow.created_at, cursorRow.created_at, cursorRow.message_id);
    }

    params.push(limit + 1);

    const rows = this.db
      .prepare<unknown[], MessageRow>(
        `SELECT
           message_id,
           conversation_id,
           role,
           source,
           platform,
           chat_type,
           chat_id,
           provider_message_id,
           text,
           attachments_json,
           tool_calls_json,
           tool_result_json,
           reply_to_id,
           run_id,
           metadata_json,
           created_at
         FROM messages
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at ASC, message_id ASC
         LIMIT ?`
      )
      .all(...params);

    const pageRows = rows.slice(0, limit);
    const overflow = rows[limit];
    const result: { messages: MessageRecord[]; nextCursor?: string } = {
      messages: pageRows.map(toMessageRecord)
    };
    if (overflow !== undefined) {
      const lastPageRow = pageRows.at(-1);
      if (lastPageRow !== undefined) {
        result.nextCursor = lastPageRow.message_id;
      }
    }

    return Promise.resolve(result);
  }

  public listRecentByConversation(
    conversationId: string,
    options: Pick<ListMessagesOptions, 'limit'> = {}
  ): Promise<MessageRecord[]> {
    const rows = options.limit === undefined
      ? this.listAllByConversationStatement.all(conversationId)
      : this.listRecentLimitedByConversationStatement.all(conversationId, options.limit);
    return Promise.resolve(rows.map(toMessageRecord));
  }

  private runInsert(
    statement: Database.Statement<MessageInsertParams>,
    record: MessageRecord
  ): Database.RunResult {
    return statement.run(
      record.messageId,
      record.conversationId,
      record.role,
      record.source,
      record.platform ?? null,
      record.chatType ?? null,
      record.chatId ?? null,
      record.providerMessageId ?? null,
      record.text ?? null,
      record.attachments === undefined ? null : stringifyJsonValue(record.attachments),
      record.toolCalls === undefined ? null : stringifyJsonValue(record.toolCalls),
      record.toolResult === undefined ? null : stringifyJsonValue(record.toolResult),
      record.replyToId ?? null,
      record.runId ?? null,
      record.metadata === undefined ? null : stringifyJsonValue(record.metadata),
      record.createdAt
    );
  }
}

function toMessageRecord(row: MessageRow): MessageRecord {
  const record: MessageRecord = {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    role: row.role,
    source: row.source,
    createdAt: row.created_at
  };

  if (row.platform !== null) {
    record.platform = row.platform;
  }
  if (row.chat_type !== null) {
    record.chatType = row.chat_type;
  }
  if (row.chat_id !== null) {
    record.chatId = row.chat_id;
  }
  if (row.provider_message_id !== null) {
    record.providerMessageId = row.provider_message_id;
  }
  if (row.text !== null) {
    record.text = row.text;
  }
  if (row.reply_to_id !== null) {
    record.replyToId = row.reply_to_id;
  }
  if (row.run_id !== null) {
    record.runId = row.run_id;
  }

  const attachments = parseOptionalArray(row.attachments_json, 'message attachments');
  if (attachments !== undefined) {
    record.attachments = attachments;
  }

  const toolCalls = parseOptionalToolCalls(row.tool_calls_json);
  if (toolCalls !== undefined) {
    record.toolCalls = toolCalls;
  }

  const toolResult = parseOptionalRecord(row.tool_result_json, 'message tool result');
  if (toolResult !== undefined) {
    record.toolResult = toolResult;
  }

  const metadata = parseOptionalRecord(row.metadata_json, 'message metadata');
  if (metadata !== undefined) {
    record.metadata = metadata;
  }

  return record;
}

function parseOptionalArray(value: string | null, label: string): unknown[] | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = parseJsonValue(value, label);
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array`);
  }

  const values: unknown[] = [];
  for (const item of parsed) {
    values.push(item);
  }

  return values;
}

function parseOptionalRecord(value: string | null, label: string): Record<string, unknown> | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = parseJsonValue(value, label);
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return parsed;
}

function parseOptionalToolCalls(value: string | null): ToolCall[] | undefined {
  const parsed = parseOptionalArray(value, 'message tool calls');
  if (parsed === undefined) {
    return undefined;
  }

  return parsed.map(readToolCall);
}

function readToolCall(value: unknown): ToolCall {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || value.type !== 'function'
    || !isRecord(value.function)
    || typeof value.function.name !== 'string'
    || typeof value.function.arguments !== 'string') {
    throw new Error('message tool calls must contain valid function tool calls');
  }

  return {
    id: value.id,
    type: 'function',
    function: {
      name: value.function.name,
      arguments: value.function.arguments
    }
  };
}
