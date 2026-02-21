import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { Session, Message } from "./adapters/types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL,
  adapter_name TEXT NOT NULL,
  name TEXT,
  created_at TEXT,
  updated_at TEXT,
  duration_ms INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  est_cost REAL DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  source_path TEXT,
  raw_copy_path TEXT,
  file_hash TEXT,
  ingested_at TEXT,
  pushed_at TEXT,
  is_sub_agent INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  timestamp TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read INTEGER DEFAULT 0,
  cache_write INTEGER DEFAULT 0,
  tool_uses TEXT DEFAULT '[]',
  thinking_blocks TEXT DEFAULT '[]',
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  pushed_at TEXT,
  status INTEGER,
  response TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_adapter ON sessions(adapter_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
`;

export class Store {
  private db: Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec(SCHEMA);
  }

  upsertSession(session: Session): void {
    this.db.run(
      `INSERT INTO sessions (id, adapter_id, adapter_name, name, created_at, updated_at,
        duration_ms, is_active, total_tokens, est_cost, message_count, source_path,
        is_sub_agent, metadata, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, updated_at=excluded.updated_at,
        duration_ms=excluded.duration_ms, is_active=excluded.is_active,
        total_tokens=excluded.total_tokens, est_cost=excluded.est_cost,
        message_count=excluded.message_count, source_path=excluded.source_path,
        metadata=excluded.metadata, ingested_at=excluded.ingested_at`,
      [
        session.id,
        session.adapterId,
        session.adapterName,
        session.name,
        session.createdAt,
        session.updatedAt,
        session.durationMs,
        session.isActive ? 1 : 0,
        session.totalTokens,
        session.estCost,
        session.messageCount,
        session.sourcePath,
        session.isSubAgent ? 1 : 0,
        JSON.stringify(session.metadata),
        new Date().toISOString(),
      ]
    );
  }

  upsertMessages(sessionId: string, messages: Message[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO messages (id, session_id, role, content, timestamp, model,
        input_tokens, output_tokens, cache_read, cache_write, tool_uses, thinking_blocks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        content=excluded.content, tool_uses=excluded.tool_uses,
        thinking_blocks=excluded.thinking_blocks`
    );

    const tx = this.db.transaction((msgs: Message[]) => {
      for (const m of msgs) {
        stmt.run(
          m.id,
          sessionId,
          m.role,
          m.content,
          m.timestamp,
          m.model,
          m.inputTokens,
          m.outputTokens,
          m.cacheRead,
          m.cacheWrite,
          JSON.stringify(m.toolUses),
          JSON.stringify(m.thinkingBlocks)
        );
      }
    });
    tx(messages);
  }

  listSessions(opts?: {
    adapterId?: string;
    since?: string;
    limit?: number;
  }): Session[] {
    let query = "SELECT * FROM sessions WHERE 1=1";
    const params: unknown[] = [];

    if (opts?.adapterId) {
      query += " AND adapter_id = ?";
      params.push(opts.adapterId);
    }
    if (opts?.since) {
      query += " AND updated_at >= ?";
      params.push(opts.since);
    }
    query += " ORDER BY updated_at DESC";
    if (opts?.limit) {
      query += " LIMIT ?";
      params.push(opts.limit);
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(rowToSession);
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
    return row ? rowToSession(row) : null;
  }

  getMessages(sessionId: string): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC")
      .all(sessionId) as any[];
    return rows.map(rowToMessage);
  }

  sessionCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM sessions").get() as any;
    return row.cnt;
  }

  messageCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM messages").get() as any;
    return row.cnt;
  }

  unpushedSessions(endpoint: string, limit: number): Session[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM sessions s
         WHERE s.id NOT IN (SELECT session_id FROM push_log WHERE endpoint = ? AND status = 200)
         ORDER BY s.updated_at DESC LIMIT ?`
      )
      .all(endpoint, limit) as any[];
    return rows.map(rowToSession);
  }

  logPush(sessionId: string, endpoint: string, status: number, response: string): void {
    this.db.run(
      `INSERT INTO push_log (session_id, endpoint, pushed_at, status, response) VALUES (?, ?, ?, ?, ?)`,
      [sessionId, endpoint, new Date().toISOString(), status, response]
    );
  }

  /** Aggregate stats for analyze command */
  analyzeByAdapter(): Record<string, { sessions: number; messages: number; tokens: number; cost: number }> {
    const rows = this.db
      .prepare(
        `SELECT adapter_id, COUNT(*) as sessions, SUM(message_count) as messages,
         SUM(total_tokens) as tokens, SUM(est_cost) as cost
         FROM sessions GROUP BY adapter_id ORDER BY sessions DESC`
      )
      .all() as any[];

    const result: Record<string, { sessions: number; messages: number; tokens: number; cost: number }> = {};
    for (const r of rows) {
      result[r.adapter_id] = {
        sessions: r.sessions,
        messages: r.messages || 0,
        tokens: r.tokens || 0,
        cost: r.cost || 0,
      };
    }
    return result;
  }

  analyzeByModel(): Record<string, { messages: number; inputTokens: number; outputTokens: number }> {
    const rows = this.db
      .prepare(
        `SELECT model, COUNT(*) as messages, SUM(input_tokens) as input_tokens,
         SUM(output_tokens) as output_tokens
         FROM messages WHERE model != '' GROUP BY model ORDER BY messages DESC`
      )
      .all() as any[];

    const result: Record<string, { messages: number; inputTokens: number; outputTokens: number }> = {};
    for (const r of rows) {
      result[r.model || "unknown"] = {
        messages: r.messages,
        inputTokens: r.input_tokens || 0,
        outputTokens: r.output_tokens || 0,
      };
    }
    return result;
  }

  close(): void {
    this.db.close();
  }
}

function rowToSession(row: any): Session {
  return {
    id: row.id,
    name: row.name || "",
    adapterId: row.adapter_id,
    adapterName: row.adapter_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    durationMs: row.duration_ms,
    isActive: !!row.is_active,
    totalTokens: row.total_tokens,
    estCost: row.est_cost,
    messageCount: row.message_count,
    sourcePath: row.source_path || "",
    isSubAgent: !!row.is_sub_agent,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    role: row.role,
    content: row.content || "",
    timestamp: row.timestamp,
    model: row.model || "",
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheRead: row.cache_read,
    cacheWrite: row.cache_write,
    toolUses: row.tool_uses ? JSON.parse(row.tool_uses) : [],
    thinkingBlocks: row.thinking_blocks ? JSON.parse(row.thinking_blocks) : [],
  };
}
