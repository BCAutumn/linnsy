import type { Database as SqliteDatabase } from 'better-sqlite3';

export function createTables(db: SqliteDatabase): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL,
      chat_type TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      user_id TEXT,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL,
      pinned_at INTEGER,
      archived_at INTEGER,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_conv_platform ON conversations(platform);
    CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
      role TEXT NOT NULL,
      source TEXT NOT NULL,
      platform TEXT,
      chat_type TEXT,
      chat_id TEXT,
      provider_message_id TEXT,
      text TEXT,
      attachments_json TEXT,
      tool_calls_json TEXT,
      tool_result_json TEXT,
      reply_to_id TEXT,
      run_id TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_msg_run ON messages(run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_provider_message
      ON messages(platform, provider_message_id)
      WHERE platform IS NOT NULL AND provider_message_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS terminal_bindings (
      terminal_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
      parent_run_id TEXT,
      status TEXT NOT NULL,
      current_node TEXT,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      iterations_used INTEGER,
      iter_budget_max INTEGER,
      iter_budget_refundable INTEGER,
      error_code TEXT,
      error_message TEXT,
      error_recoverable INTEGER,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_conv ON runs(conversation_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);

    CREATE TABLE IF NOT EXISTS checkpoints (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(conversation_id),
      state_json TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
      parent_run_id TEXT,
      parent_task_id TEXT REFERENCES tasks(task_id),
      kind TEXT NOT NULL DEFAULT 'external',
      attempt_count INTEGER NOT NULL DEFAULT 1,
      external_ref TEXT,
      external_kind TEXT,
      locator_json TEXT,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      due_at INTEGER,
      last_node TEXT,
      reported_at INTEGER,
      payload_json TEXT,
      result_json TEXT,
      workspace_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      paused_at INTEGER,
      completed_at INTEGER,
      cancelled_at INTEGER,
      cancel_reason TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_conv ON tasks(conversation_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);

    CREATE TABLE IF NOT EXISTS cron_jobs (
      job_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      schedule_json TEXT NOT NULL,
      next_run_at INTEGER NOT NULL,
      miss_grace_ms INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cron_jobs_due ON cron_jobs(enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS cron_runs (
      cron_run_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES cron_jobs(job_id),
      scheduled_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      status TEXT NOT NULL,
      run_id TEXT,
      error_code TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id, scheduled_at DESC);

    CREATE TABLE IF NOT EXISTS memory_items (
      memory_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mem_scope ON memory_items(scope, importance DESC, updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
      content,
      content='memory_items',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS memory_items_ai AFTER INSERT ON memory_items BEGIN
      INSERT INTO memory_items_fts(rowid, content) VALUES (new.rowid, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memory_items_ad AFTER DELETE ON memory_items BEGIN
      INSERT INTO memory_items_fts(memory_items_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memory_items_au AFTER UPDATE ON memory_items BEGIN
      INSERT INTO memory_items_fts(memory_items_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO memory_items_fts(rowid, content) VALUES (new.rowid, new.content);
    END;

    CREATE TABLE IF NOT EXISTS pairings (
      pairing_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      user_id TEXT,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pair_expire ON pairings(expires_at);

    CREATE TABLE IF NOT EXISTS telemetry_events (
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (ts, kind, scope_json)
    );

    CREATE INDEX IF NOT EXISTS idx_tele_ts ON telemetry_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_tele_kind ON telemetry_events(kind, ts DESC);

    CREATE TABLE IF NOT EXISTS ui_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_credentials (
      model_id TEXT PRIMARY KEY,
      encrypted_api_key TEXT NOT NULL,
      nonce TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- 对话流事件表（messages 的姊妹表）：
    --   - messages 存 user / assistant 文本气泡；
    --   - events 存"对话流元素"——工具调用 / 子 agent 汇报 / 系统事件 / message.delta / thought 等；
    -- 投影 reducer 在 hydrate 时按时间线把两张表合一，回放出与实时态等价的 ProjectionState。
    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      conversation_id TEXT,
      message_id TEXT,
      run_id TEXT,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_conv_seq ON events(conversation_id, seq);
    CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
    CREATE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
  `);
  ensureColumn(db, 'conversations', 'last_activity_at', 'INTEGER');
  ensureColumn(db, 'conversations', 'pinned_at', 'INTEGER');
  ensureColumn(db, 'messages', 'metadata_json', 'TEXT');
  ensureColumn(db, 'messages', 'platform', 'TEXT');
  ensureColumn(db, 'messages', 'chat_type', 'TEXT');
  ensureColumn(db, 'messages', 'chat_id', 'TEXT');
  ensureColumn(db, 'tasks', 'locator_json', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conv_last_activity ON conversations(last_activity_at DESC)');
  backfillConversationLastActivityAt(db);
}

function ensureColumn(db: SqliteDatabase, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info('${table}')`).all();
  const exists = rows.some((row) => {
    return typeof row === 'object' &&
      row !== null &&
      'name' in row &&
      row.name === column;
  });
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function backfillConversationLastActivityAt(db: SqliteDatabase): void {
  db.exec(`
    UPDATE conversations
       SET last_activity_at = COALESCE((
         SELECT MAX(activity_at)
           FROM (
             SELECT MAX(messages.created_at) AS activity_at
               FROM messages
              WHERE messages.conversation_id = conversations.conversation_id
             UNION ALL
             SELECT MAX(events.created_at) AS activity_at
               FROM events
              WHERE events.conversation_id = conversations.conversation_id
                AND (
                  events.kind IN ('message.inbound', 'message.complete', 'subagent.summary')
                  OR (
                    events.kind = 'system.event'
                    AND COALESCE(json_extract(events.payload_json, '$.sourceKind'), '')
                      IN ('cron', 'user_interjection', 'task_execution_notice')
                  )
                )
           )
       ), conversations.created_at)
     WHERE last_activity_at IS NULL
  `);
}
