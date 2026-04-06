import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { Session, Message, ContextArtifact } from "./adapters/types";

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

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT,
  path TEXT,
  scope TEXT DEFAULT 'project',
  content TEXT,
  content_hash TEXT,
  updated_at TEXT,
  ingested_at TEXT,
  metadata TEXT DEFAULT '{}'
);

-- Projects: derived from cwd/git, groups sessions across tools
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  directory TEXT,            -- canonical cwd path
  git_remote TEXT,           -- git remote origin URL (for cross-machine linking)
  git_branch TEXT,           -- default branch
  language TEXT,             -- primary language (auto-detected)
  first_seen TEXT,
  last_seen TEXT,
  session_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  metadata TEXT DEFAULT '{}'
);

-- Link sessions to projects (M:N because a session could touch multiple projects)
CREATE TABLE IF NOT EXISTS session_projects (
  session_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (session_id, project_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Tags: auto-generated and user-applied labels for sessions
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,     -- 'tool', 'model', 'project', 'language', 'branch', 'custom'
  color TEXT,                 -- hex color for UI
  UNIQUE(name, category)
);

-- Link tags to sessions (M:N)
CREATE TABLE IF NOT EXISTS session_tags (
  session_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  auto_applied INTEGER DEFAULT 1,  -- 1 = system-generated, 0 = user-applied
  PRIMARY KEY (session_id, tag_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Tool usage stats per session (for visualization)
CREATE TABLE IF NOT EXISTS tool_usage (
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  call_count INTEGER DEFAULT 0,
  total_input_chars INTEGER DEFAULT 0,
  total_output_chars INTEGER DEFAULT 0,
  PRIMARY KEY (session_id, tool_name),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_adapter ON sessions(adapter_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_artifacts_adapter ON artifacts(adapter_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind);
CREATE INDEX IF NOT EXISTS idx_session_projects_project ON session_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_session_tags_tag ON session_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_projects_last_seen ON projects(last_seen);
CREATE INDEX IF NOT EXISTS idx_tool_usage_tool ON tool_usage(tool_name);
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
    this.db.exec("PRAGMA busy_timeout=5000");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  upsertSession(session: Session): void {
    this.db.run(
      `INSERT INTO sessions (id, adapter_id, adapter_name, name, created_at, updated_at,
        duration_ms, is_active, total_tokens, est_cost, message_count, source_path,
        is_sub_agent, parent_session_id, is_compacted, metadata, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, updated_at=excluded.updated_at,
        duration_ms=excluded.duration_ms, is_active=excluded.is_active,
        total_tokens=excluded.total_tokens, est_cost=excluded.est_cost,
        message_count=excluded.message_count, source_path=excluded.source_path,
        is_sub_agent=excluded.is_sub_agent, parent_session_id=excluded.parent_session_id,
        is_compacted=excluded.is_compacted,
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
        session.parentSessionId || "",
        session.isCompacted ? 1 : 0,
        JSON.stringify(session.metadata),
        new Date().toISOString(),
      ]
    );
  }

  upsertMessages(sessionId: string, messages: Message[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO messages (id, session_id, role, content, timestamp, model,
        input_tokens, output_tokens, cache_read, cache_write, tool_uses, thinking_blocks,
        record_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        content=excluded.content, tool_uses=excluded.tool_uses,
        thinking_blocks=excluded.thinking_blocks, record_type=excluded.record_type`
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
          JSON.stringify(m.thinkingBlocks),
          m.recordType || "",
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
    const params: (string | number | null)[] = [];

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

  /** Count messages for a specific session */
  messageCountForSession(sessionId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?").get(sessionId) as any;
    return row?.cnt ?? 0;
  }

  /** Insert only new messages (no upsert — for append-only JSONL sources) */
  insertMessages(sessionId: string, messages: Message[]): void {
    if (messages.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO messages (id, session_id, role, content, timestamp, model,
        input_tokens, output_tokens, cache_read, cache_write, tool_uses, thinking_blocks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = this.db.transaction((msgs: Message[]) => {
      for (const m of msgs) {
        stmt.run(
          m.id, sessionId, m.role, m.content, m.timestamp, m.model,
          m.inputTokens, m.outputTokens, m.cacheRead, m.cacheWrite,
          JSON.stringify(m.toolUses), JSON.stringify(m.thinkingBlocks)
        );
      }
    });
    tx(messages);
  }

  searchMessages(opts: {
    query: string;
    adapterId?: string;
    since?: string;
    limit?: number;
  }): Array<{
    messageId: string;
    sessionId: string;
    role: string;
    timestamp: string;
    adapterId: string;
    sessionName: string;
    createdAt: string;
    snippet: string;
    rank: number;
  }> {
    const limit = opts.limit || 20;
    let query = `
      SELECT m.id AS message_id, m.session_id, m.role, m.timestamp,
             s.adapter_id, s.name AS session_name, s.created_at,
             snippet(messages_fts, 0, '>>>', '<<<', '...', 30) AS snippet,
             rank
      FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      JOIN sessions s ON s.id = m.session_id
      WHERE messages_fts MATCH ?
    `;
    const params: (string | number)[] = [opts.query];

    if (opts.adapterId) {
      query += " AND s.adapter_id = ?";
      params.push(opts.adapterId);
    }
    if (opts.since) {
      query += " AND s.updated_at >= ?";
      params.push(opts.since);
    }

    query += " ORDER BY rank LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => ({
      messageId: r.message_id,
      sessionId: r.session_id,
      role: r.role,
      timestamp: r.timestamp || "",
      adapterId: r.adapter_id,
      sessionName: r.session_name || "",
      createdAt: r.created_at || "",
      snippet: r.snippet || "",
      rank: r.rank || 0,
    }));
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

  /** Sessions that were never pushed OR changed since last successful push to this endpoint */
  sessionsNeedingPush(endpoint: string): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT s.id FROM sessions s
         WHERE s.id NOT IN (
           SELECT pl.session_id FROM push_log pl
           WHERE pl.endpoint = ? AND pl.status = 200
             AND pl.pushed_at >= s.ingested_at
         )`
      )
      .all(endpoint) as any[];
    return new Set(rows.map((r: any) => r.id));
  }

  logPush(sessionId: string, endpoint: string, status: number, response: string, messageCount?: number): void {
    this.db.run(
      `INSERT INTO push_log (session_id, endpoint, pushed_at, status, response, message_count) VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, endpoint, new Date().toISOString(), status, response, messageCount ?? 0]
    );
  }

  /** Get the number of messages last successfully pushed for a session+endpoint */
  lastPushedMessageCount(sessionId: string, endpoint: string): number {
    const row = this.db
      .prepare(
        `SELECT message_count FROM push_log
         WHERE session_id = ? AND endpoint = ? AND status = 200
         ORDER BY pushed_at DESC LIMIT 1`
      )
      .get(sessionId, endpoint) as any;
    return row?.message_count ?? 0;
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

  // --- Projects ---

  upsertProject(project: {
    id: string; name: string; directory?: string; gitRemote?: string;
    gitBranch?: string; language?: string;
  }): void {
    this.db.run(
      `INSERT INTO projects (id, name, directory, git_remote, git_branch, language, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, directory=COALESCE(excluded.directory, projects.directory),
        git_remote=COALESCE(excluded.git_remote, projects.git_remote),
        git_branch=COALESCE(excluded.git_branch, projects.git_branch),
        language=COALESCE(excluded.language, projects.language),
        last_seen=excluded.last_seen`,
      [project.id, project.name, project.directory || null, project.gitRemote || null,
       project.gitBranch || null, project.language || null,
       new Date().toISOString(), new Date().toISOString()]
    );
  }

  linkSessionToProject(sessionId: string, projectId: string): void {
    this.db.run(
      `INSERT OR IGNORE INTO session_projects (session_id, project_id) VALUES (?, ?)`,
      [sessionId, projectId]
    );
  }

  refreshProjectStats(): void {
    this.db.exec(`
      UPDATE projects SET
        session_count = (SELECT COUNT(*) FROM session_projects WHERE project_id = projects.id),
        total_tokens = COALESCE((
          SELECT SUM(s.total_tokens) FROM sessions s
          JOIN session_projects sp ON sp.session_id = s.id
          WHERE sp.project_id = projects.id
        ), 0),
        total_cost = COALESCE((
          SELECT SUM(s.est_cost) FROM sessions s
          JOIN session_projects sp ON sp.session_id = s.id
          WHERE sp.project_id = projects.id
        ), 0),
        last_seen = COALESCE((
          SELECT MAX(s.updated_at) FROM sessions s
          JOIN session_projects sp ON sp.session_id = s.id
          WHERE sp.project_id = projects.id
        ), projects.last_seen)
    `);
  }

  getSessionProjects(sessionId: string): Array<{
    id: string;
    name: string;
    directory?: string;
    gitRemote?: string;
  }> {
    const rows = this.db.prepare(
      `SELECT p.id, p.name, p.directory, p.git_remote
       FROM projects p
       JOIN session_projects sp ON sp.project_id = p.id
       WHERE sp.session_id = ?`
    ).all(sessionId) as any[];
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      directory: r.directory || undefined,
      gitRemote: r.git_remote || undefined,
    }));
  }

  listProjects(): any[] {
    return this.db.prepare(
      `SELECT p.*, GROUP_CONCAT(DISTINCT s.adapter_id) as tools
       FROM projects p
       LEFT JOIN session_projects sp ON sp.project_id = p.id
       LEFT JOIN sessions s ON s.id = sp.session_id
       GROUP BY p.id ORDER BY p.last_seen DESC`
    ).all() as any[];
  }

  // --- Tags ---

  ensureTag(name: string, category: string, color?: string): number {
    this.db.run(
      `INSERT OR IGNORE INTO tags (name, category, color) VALUES (?, ?, ?)`,
      [name, category, color || null]
    );
    const row = this.db.prepare(
      `SELECT id FROM tags WHERE name = ? AND category = ?`
    ).get(name, category) as any;
    return row.id;
  }

  tagSession(sessionId: string, tagId: number, auto: boolean = true): void {
    this.db.run(
      `INSERT OR IGNORE INTO session_tags (session_id, tag_id, auto_applied) VALUES (?, ?, ?)`,
      [sessionId, tagId, auto ? 1 : 0]
    );
  }

  getSessionTags(sessionId: string): Array<{ name: string; category: string; color: string }> {
    return this.db.prepare(
      `SELECT t.name, t.category, t.color FROM tags t
       JOIN session_tags st ON st.tag_id = t.id
       WHERE st.session_id = ? ORDER BY t.category, t.name`
    ).all(sessionId) as any[];
  }

  listTags(): Array<{ id: number; name: string; category: string; color: string; count: number }> {
    return this.db.prepare(
      `SELECT t.*, COUNT(st.session_id) as count FROM tags t
       LEFT JOIN session_tags st ON st.tag_id = t.id
       GROUP BY t.id ORDER BY count DESC`
    ).all() as any[];
  }

  // --- Tool usage stats ---

  upsertToolUsage(sessionId: string, toolName: string, callCount: number,
    inputChars: number, outputChars: number): void {
    this.db.run(
      `INSERT INTO tool_usage (session_id, tool_name, call_count, total_input_chars, total_output_chars)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, tool_name) DO UPDATE SET
        call_count=excluded.call_count, total_input_chars=excluded.total_input_chars,
        total_output_chars=excluded.total_output_chars`,
      [sessionId, toolName, callCount, inputChars, outputChars]
    );
  }

  analyzeToolUsage(): Array<{ tool_name: string; total_calls: number; session_count: number }> {
    return this.db.prepare(
      `SELECT tool_name, SUM(call_count) as total_calls, COUNT(DISTINCT session_id) as session_count
       FROM tool_usage GROUP BY tool_name ORDER BY total_calls DESC`
    ).all() as any[];
  }

  // --- Cross-tool queries for visualization ---

  /** Timeline: sessions per day, grouped by tool */
  timelineByDay(days: number = 30): any[] {
    return this.db.prepare(
      `SELECT DATE(created_at) as day, adapter_id, COUNT(*) as sessions,
       SUM(total_tokens) as tokens, SUM(est_cost) as cost
       FROM sessions
       WHERE created_at >= DATE('now', '-' || ? || ' days')
       GROUP BY day, adapter_id ORDER BY day ASC`
    ).all(days) as any[];
  }

  /** Cost breakdown by project and tool */
  costByProjectAndTool(): any[] {
    return this.db.prepare(
      `SELECT p.name as project_name, s.adapter_id, COUNT(*) as sessions,
       SUM(s.total_tokens) as tokens, SUM(s.est_cost) as cost
       FROM sessions s
       JOIN session_projects sp ON sp.session_id = s.id
       JOIN projects p ON p.id = sp.project_id
       GROUP BY p.id, s.adapter_id ORDER BY cost DESC`
    ).all() as any[];
  }

  /** Sessions with their tags and project, for dashboard listing */
  enrichedSessions(opts?: { limit?: number; projectId?: string; tagName?: string }): any[] {
    let query = `
      SELECT s.*,
        GROUP_CONCAT(DISTINCT t.name) as tag_names,
        GROUP_CONCAT(DISTINCT p.name) as project_names
      FROM sessions s
      LEFT JOIN session_tags st ON st.session_id = s.id
      LEFT JOIN tags t ON t.id = st.tag_id
      LEFT JOIN session_projects sp ON sp.session_id = s.id
      LEFT JOIN projects p ON p.id = sp.project_id
      WHERE 1=1`;
    const params: (string | number | null)[] = [];
    if (opts?.projectId) {
      query += " AND sp.project_id = ?";
      params.push(opts.projectId);
    }
    if (opts?.tagName) {
      query += " AND t.name = ?";
      params.push(opts.tagName);
    }
    query += " GROUP BY s.id ORDER BY s.updated_at DESC";
    if (opts?.limit) {
      query += " LIMIT ?";
      params.push(opts.limit);
    }
    return this.db.prepare(query).all(...params) as any[];
  }

  // --- Sub-agent relationships ---

  /** Get child sessions (sub-agents/tasks) of a parent session */
  getChildSessions(parentId: string): Session[] {
    const rows = this.db.prepare(
      `SELECT * FROM sessions WHERE parent_session_id = ? ORDER BY created_at ASC`
    ).all(parentId) as any[];
    return rows.map(rowToSession);
  }

  /** Get the full session tree: parent + all descendants */
  getSessionTree(sessionId: string): { parent: Session | null; children: Session[] } {
    const session = this.getSession(sessionId);
    if (!session) return { parent: null, children: [] };

    // If this is a sub-agent, find the parent
    let parent: Session | null = null;
    if (session.parentSessionId) {
      parent = this.getSession(session.parentSessionId);
    }

    // Find direct children
    const children = this.getChildSessions(sessionId);

    return { parent, children };
  }

  // --- Artifacts ---

  upsertArtifact(artifact: ContextArtifact): void {
    this.db.run(
      `INSERT INTO artifacts (id, adapter_id, kind, name, path, scope, content,
        content_hash, updated_at, ingested_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        content=excluded.content, content_hash=excluded.content_hash,
        updated_at=excluded.updated_at, ingested_at=excluded.ingested_at,
        metadata=excluded.metadata`,
      [
        artifact.id,
        artifact.adapterId,
        artifact.kind,
        artifact.name,
        artifact.path,
        artifact.scope,
        artifact.content,
        artifact.contentHash,
        artifact.updatedAt,
        new Date().toISOString(),
        JSON.stringify(artifact.metadata),
      ]
    );
  }

  listArtifacts(opts?: {
    adapterId?: string;
    kind?: string;
  }): ContextArtifact[] {
    let query = "SELECT * FROM artifacts WHERE 1=1";
    const params: (string | number | null)[] = [];
    if (opts?.adapterId) {
      query += " AND adapter_id = ?";
      params.push(opts.adapterId);
    }
    if (opts?.kind) {
      query += " AND kind = ?";
      params.push(opts.kind);
    }
    query += " ORDER BY updated_at DESC";
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(rowToArtifact);
  }

  artifactCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM artifacts").get() as any;
    return row.cnt;
  }

  /** Migrate schema for existing databases */
  migrate(): void {
    // Add new columns if they don't exist (safe for existing DBs)
    const pragmaColumns = (table: string) => {
      const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as any[];
      return new Set(rows.map((r: any) => r.name));
    };
    const sessionCols = pragmaColumns("sessions");
    if (!sessionCols.has("parent_session_id")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN parent_session_id TEXT DEFAULT ''");
    }
    if (!sessionCols.has("is_compacted")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN is_compacted INTEGER DEFAULT 0");
    }
    const msgCols = pragmaColumns("messages");
    if (!msgCols.has("record_type")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN record_type TEXT DEFAULT ''");
    }
    const pushLogCols = pragmaColumns("push_log");
    if (!pushLogCols.has("message_count")) {
      this.db.exec("ALTER TABLE push_log ADD COLUMN message_count INTEGER DEFAULT 0");
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_push_log_lookup ON push_log(session_id, endpoint, status)");

    // FTS5 virtual table for full-text search on message content
    const hasFts = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'"
    ).get();
    if (!hasFts) {
      this.db.exec(`CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid')`);
      // Triggers to keep FTS in sync
      this.db.exec(`
        CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER messages_fts_update AFTER UPDATE OF content ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
          INSERT INTO messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
        END
      `);
      // Backfill existing messages
      this.db.exec(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages WHERE content IS NOT NULL`);
    }
  }

  close(): void {
    // Checkpoint WAL before closing so Windows releases the memory-mapped .db-shm file
    try { this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (e) {
      if (process.env.DEBUG) console.warn("WAL checkpoint failed:", e);
    }
    this.db.close();
  }
}

// Explicit alias for the remaining compatibility surfaces that still read the
// legacy local SQLite schema directly. Canonical v2 read/write paths live
// under src/db/.
export { Store as LegacyStore };

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
    parentSessionId: row.parent_session_id || "",
    isCompacted: !!row.is_compacted,
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
    recordType: row.record_type || "",
  };
}

function rowToArtifact(row: any): ContextArtifact {
  return {
    id: row.id,
    adapterId: row.adapter_id,
    kind: row.kind,
    name: row.name || "",
    path: row.path || "",
    scope: row.scope || "project",
    content: row.content || "",
    contentHash: row.content_hash || "",
    updatedAt: row.updated_at || "",
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}
