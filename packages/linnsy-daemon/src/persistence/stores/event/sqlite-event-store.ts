import type Database from 'better-sqlite3';

import type { RuntimeEvent } from '../../../domains/observability/definitions/runtime-events.js';
import {
  isConversationVisibleSystemEventSourceKind,
  isRuntimeEventKind
} from '../../../domains/observability/definitions/runtime-events.js';
import { stringifyJsonValue } from '../../json.js';
import type {
  ConversationActivityMarker,
  EventStorePort,
  ListEventsOptions,
  ListEventsResult,
  StoredRuntimeEvent
} from './event-store-port.js';

export interface SqliteEventStoreOptions {
  conversations?: ConversationActivityMarker;
}

interface EventRow {
  event_id: string;
  seq: number;
  kind: string;
  conversation_id: string | null;
  message_id: string | null;
  run_id: string | null;
  payload_json: string;
  created_at: number;
}

export class SqliteEventStore implements EventStorePort {
  private readonly insertStatement: Database.Statement<[
    string,
    number,
    string,
    string | null,
    string | null,
    string | null,
    string,
    number
  ]>;
  private readonly listByConversationAfterStatement: Database.Statement<[string, number, number], EventRow>;
  private readonly listByConversationLatestStatement: Database.Statement<[string, number], EventRow>;
  private readonly listAllAfterStatement: Database.Statement<[number, number], EventRow>;
  private readonly listAllLatestStatement: Database.Statement<[number], EventRow>;
  private readonly maxSeqStatement: Database.Statement<[], { max_seq: number | null }>;

  public constructor(
    private readonly db: Database.Database,
    private readonly options: SqliteEventStoreOptions = {}
  ) {
    this.insertStatement = db.prepare(
      `INSERT INTO events (
         event_id,
         seq,
         kind,
         conversation_id,
         message_id,
         run_id,
         payload_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.listByConversationAfterStatement = db.prepare<[string, number, number], EventRow>(
      `SELECT event_id, seq, kind, conversation_id, message_id, run_id, payload_json, created_at
         FROM events
        WHERE conversation_id = ? AND seq > ?
        ORDER BY seq ASC
        LIMIT ?`
    );
    this.listByConversationLatestStatement = db.prepare<[string, number], EventRow>(
      `SELECT event_id, seq, kind, conversation_id, message_id, run_id, payload_json, created_at
         FROM events
        WHERE conversation_id = ?
        ORDER BY seq DESC
        LIMIT ?`
    );
    this.listAllAfterStatement = db.prepare<[number, number], EventRow>(
      `SELECT event_id, seq, kind, conversation_id, message_id, run_id, payload_json, created_at
         FROM events
        WHERE seq > ?
        ORDER BY seq ASC
        LIMIT ?`
    );
    this.listAllLatestStatement = db.prepare<[number], EventRow>(
      `SELECT event_id, seq, kind, conversation_id, message_id, run_id, payload_json, created_at
         FROM events
        ORDER BY seq DESC
        LIMIT ?`
    );
    this.maxSeqStatement = db.prepare<[], { max_seq: number | null }>(
      `SELECT MAX(seq) AS max_seq FROM events`
    );
  }

  public append(event: RuntimeEvent): void {
    this.insertStatement.run(
      event.eventId,
      event.seq,
      event.kind,
      event.conversationId ?? null,
      event.messageId ?? null,
      event.runId ?? null,
      stringifyJsonValue(event.payload),
      event.createdAt
    );
    markVisibleConversationActivity(event, this.options.conversations);
  }

  public readMaxSeq(): number {
    const row = this.maxSeqStatement.get();
    return row?.max_seq ?? 0;
  }

  public listByConversation(conversationId: string, options: ListEventsOptions = {}): ListEventsResult {
    const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
    const rows = options.sinceSeq === undefined
      ? this.listByConversationLatestStatement.all(conversationId, limit).reverse()
      : this.listByConversationAfterStatement.all(conversationId, options.sinceSeq, limit);
    return toResult(rows);
  }

  public list(options: ListEventsOptions = {}): ListEventsResult {
    const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
    const rows = options.sinceSeq === undefined
      ? this.listAllLatestStatement.all(limit).reverse()
      : this.listAllAfterStatement.all(options.sinceSeq, limit);
    return toResult(rows);
  }
}

function markVisibleConversationActivity(
  event: RuntimeEvent,
  conversations: ConversationActivityMarker | undefined
): void {
  if (conversations === undefined || event.conversationId === undefined) {
    return;
  }
  if (!isVisibleConversationActivity(event)) {
    return;
  }
  conversations.markActivity(event.conversationId, event.createdAt);
}

function isVisibleConversationActivity(event: RuntimeEvent): boolean {
  switch (event.kind) {
    case 'message.inbound':
    case 'message.complete':
    case 'subagent.summary':
      return true;
    case 'system.event':
      return isConversationVisibleSystemEventSourceKind(event.payload.sourceKind);
    default:
      return false;
  }
}

function toResult(rows: EventRow[]): ListEventsResult {
  const events: StoredRuntimeEvent[] = [];
  for (const row of rows) {
    const event = rowToEvent(row);
    if (event !== null) events.push(event);
  }
  const result: ListEventsResult = { events };
  const last = events.at(-1);
  if (last !== undefined) {
    result.nextCursor = String(last.seq);
  }
  return result;
}

function rowToEvent(row: EventRow): StoredRuntimeEvent | null {
  if (!isRuntimeEventKind(row.kind)) {
    // schema 漂移防御：库里出现共享类型不认识的 kind，跳过避免崩。
    return null;
  }
  const payload: unknown = parsePayload(row.payload_json);
  if (!isRecord(payload)) {
    return null;
  }
  const event: StoredRuntimeEvent = {
    eventId: row.event_id,
    seq: row.seq,
    kind: row.kind,
    createdAt: row.created_at,
    payload
  };
  if (row.conversation_id !== null) event.conversationId = row.conversation_id;
  if (row.message_id !== null) event.messageId = row.message_id;
  if (row.run_id !== null) event.runId = row.run_id;
  return event;
}

function parsePayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
