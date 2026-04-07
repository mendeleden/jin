import type { Database } from "bun:sqlite";
import {
  CONVERSATION_RELATIONSHIPS,
  CONVERSATION_SOURCE_FORMATS,
} from "../contracts/conversations";

export interface Migration {
  version: number;
  up(db: Database): void;
}

const RELATIONSHIP_CHECK = CONVERSATION_RELATIONSHIPS.map((value) => `'${value}'`).join(", ");
const SOURCE_FORMAT_CHECK = CONVERSATION_SOURCE_FORMATS.map((value) => `'${value}'`).join(", ");

export const migrations: Migration[] = [
  {
    version: 1,
    up(db) {
      prepareLegacyStoreForV2(db);
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          trace_id TEXT NOT NULL,
          parent_id TEXT NOT NULL DEFAULT '',
          relationship TEXT NOT NULL CHECK (relationship IN (${RELATIONSHIP_CHECK})),
          fork_point INTEGER NOT NULL DEFAULT -1,
          adapter_id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          cwd TEXT NOT NULL DEFAULT '',
          git_remote TEXT NOT NULL DEFAULT '',
          branch TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          started_at TEXT NOT NULL DEFAULT '',
          ended_at TEXT NOT NULL DEFAULT '',
          source_path TEXT NOT NULL DEFAULT '',
          source_format TEXT NOT NULL CHECK (source_format IN (${SOURCE_FORMAT_CHECK})),
          duration_ms INTEGER NOT NULL DEFAULT 0,
          message_count INTEGER NOT NULL DEFAULT 0,
          tool_count INTEGER NOT NULL DEFAULT 0,
          turn_count INTEGER NOT NULL DEFAULT 0,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read INTEGER NOT NULL DEFAULT 0,
          cache_write INTEGER NOT NULL DEFAULT 0,
          est_cost REAL NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL DEFAULT '',
          record_type TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL DEFAULT '',
          sequence INTEGER NOT NULL,
          turn INTEGER NOT NULL,
          is_sidechain INTEGER NOT NULL DEFAULT 0,
          parent_message_id TEXT NOT NULL DEFAULT '',
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read INTEGER NOT NULL DEFAULT 0,
          cache_write INTEGER NOT NULL DEFAULT 0,
          thinking_content TEXT NOT NULL DEFAULT '',
          thinking_tokens INTEGER NOT NULL DEFAULT 0,
          timestamp TEXT NOT NULL DEFAULT '',
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tool_calls (
          conversation_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          input TEXT NOT NULL DEFAULT '',
          output TEXT NOT NULL DEFAULT '',
          is_error INTEGER NOT NULL DEFAULT 0,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          timestamp TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (conversation_id, message_id, id),
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS _jin_sync (
          conversation_id TEXT PRIMARY KEY,
          bundle_hash TEXT NOT NULL,
          local_revision INTEGER NOT NULL,
          ingested_at TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS _jin_push_state (
          conversation_id TEXT NOT NULL,
          sink_id TEXT NOT NULL,
          last_attempted_revision INTEGER NOT NULL DEFAULT 0,
          last_successful_revision INTEGER NOT NULL DEFAULT 0,
          last_attempted_at TEXT NOT NULL DEFAULT '',
          last_successful_at TEXT NOT NULL DEFAULT '',
          last_error TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (conversation_id, sink_id),
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS _jin_push_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          sink_id TEXT NOT NULL,
          attempted_revision INTEGER NOT NULL,
          attempted_at TEXT NOT NULL,
          status INTEGER NOT NULL,
          response TEXT NOT NULL DEFAULT '',
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          content='messages',
          content_rowid='rowid'
        );

        CREATE INDEX IF NOT EXISTS idx_conv_trace ON conversations(trace_id);
        CREATE INDEX IF NOT EXISTS idx_conv_parent ON conversations(parent_id);
        CREATE INDEX IF NOT EXISTS idx_conv_remote ON conversations(git_remote);
        CREATE INDEX IF NOT EXISTS idx_conv_adapter ON conversations(adapter_id);
        CREATE INDEX IF NOT EXISTS idx_conv_ended ON conversations(ended_at);
        CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_msg_sequence ON messages(conversation_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_tc_conv ON tool_calls(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_tc_name ON tool_calls(name);
      `);
    },
  },
];

export const LATEST_USER_VERSION =
  migrations[migrations.length - 1]?.version ?? 0;

export function getUserVersion(db: Database): number {
  const row = db
    .prepare("PRAGMA user_version")
    .get() as { user_version?: number } | undefined;

  return row?.user_version ?? 0;
}

export function runMigrations(db: Database): void {
  const currentVersion = getUserVersion(db);

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    const applyMigration = db.transaction(() => {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });

    applyMigration();
  }
}

const LEGACY_MESSAGES_TABLE = "_jin_v1_messages";

function prepareLegacyStoreForV2(db: Database): void {
  if (!tableExists(db, "messages")) {
    return;
  }

  const columns = getTableColumns(db, "messages");
  if (columns.has("conversation_id")) {
    return;
  }

  // Legacy v1 store uses messages.session_id. Preserve the table for
  // compatibility/debugging and free the canonical messages table name for v2.
  if (columns.has("session_id")) {
    safeExec(db, "DROP TRIGGER IF EXISTS messages_fts_insert");
    safeExec(db, "DROP TRIGGER IF EXISTS messages_fts_delete");
    safeExec(db, "DROP TRIGGER IF EXISTS messages_fts_update");
    safeExec(db, "DROP TABLE IF EXISTS messages_fts");

    if (tableExists(db, LEGACY_MESSAGES_TABLE)) {
      safeExec(db, `DROP TABLE ${LEGACY_MESSAGES_TABLE}`);
    }

    db.exec(`ALTER TABLE messages RENAME TO ${LEGACY_MESSAGES_TABLE}`);
  }
}

function tableExists(db: Database, tableName: string): boolean {
  const row = db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = ?`,
    )
    .get(tableName) as { name?: string } | null;

  return !!row?.name;
}

function getTableColumns(db: Database, tableName: string): Set<string> {
  const rows = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name?: string }>;

  return new Set(
    rows
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

function safeExec(db: Database, statement: string): void {
  try {
    db.exec(statement);
  } catch {}
}
