// Postgres full-text search executor.
// Separate from PostgresSink (write-only). Reuses the same dual-mode connection pattern.

import { SQL } from "bun";

export interface PostgresSearchOptions {
  query: string;
  adapterId?: string;
  since?: string;
  limit?: number;
}

export interface PostgresSearchResult {
  messageId: string;
  sessionId: string;
  role: string;
  timestamp: string;
  adapterId: string;
  sessionName: string;
  developerId: string;
  createdAt: string;
  snippet: string;
  rank: number;
}

export class PostgresSearcher {
  private connectionString: string;
  private schema: string;
  private sessionsTable: string;
  private messagesTable: string;
  private conn: SQL | null = null;
  private hasTrgm = false;

  constructor(config: { connectionString: string; schema?: string; table?: string }) {
    this.connectionString = config.connectionString;
    this.schema = config.schema || "public";
    this.sessionsTable = `${this.schema}.${config.table || "jin_sessions"}`;
    this.messagesTable = `${this.schema}.${config.table ? config.table + "_messages" : "jin_messages"}`;
  }

  /** Idempotent migration: add tsvector column, GIN index, and trigger */
  async ensureSearchSchema(): Promise<void> {
    // Add tsvector column
    await this.query(
      `ALTER TABLE ${this.messagesTable} ADD COLUMN IF NOT EXISTS content_tsv tsvector`
    );

    // Create GIN index for FTS
    await this.query(
      `CREATE INDEX IF NOT EXISTS idx_jin_msg_fts ON ${this.messagesTable} USING GIN(content_tsv)`
    );

    // Create trigger function
    await this.query(`
      CREATE OR REPLACE FUNCTION jin_messages_tsv_trigger() RETURNS trigger AS $$
      BEGIN
        NEW.content_tsv := to_tsvector('english', COALESCE(NEW.content, ''));
        RETURN NEW;
      END; $$ LANGUAGE plpgsql
    `);

    // Create trigger (drop first to allow re-creation)
    await this.query(
      `DROP TRIGGER IF EXISTS jin_messages_tsv_update ON ${this.messagesTable}`
    );
    await this.query(`
      CREATE TRIGGER jin_messages_tsv_update BEFORE INSERT OR UPDATE OF content
        ON ${this.messagesTable} FOR EACH ROW EXECUTE FUNCTION jin_messages_tsv_trigger()
    `);

    // Try pg_trgm for fuzzy matching (not all providers support it)
    try {
      await this.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_jin_msg_trgm ON ${this.messagesTable} USING GIN(content gin_trgm_ops)`
      );
      this.hasTrgm = true;
    } catch {
      this.hasTrgm = false;
    }
  }

  /** Hybrid FTS + trigram search. Falls back to FTS-only if pg_trgm is unavailable. */
  async search(opts: PostgresSearchOptions): Promise<PostgresSearchResult[]> {
    const limit = opts.limit || 20;
    const params: unknown[] = [opts.query, opts.query, opts.query, limit];
    let paramIdx = 5;

    let whereExtra = "";
    if (opts.adapterId) {
      whereExtra += ` AND s.adapter_id = $${paramIdx}`;
      params.push(opts.adapterId);
      paramIdx++;
    }
    if (opts.since) {
      whereExtra += ` AND s.created_at >= $${paramIdx}`;
      params.push(opts.since);
      paramIdx++;
    }

    let sql: string;

    if (this.hasTrgm) {
      sql = `
        SELECT m.id AS message_id, m.session_id, m.role, m.timestamp,
               s.adapter_id, s.name AS session_name, s.developer_id, s.created_at,
               ts_rank(m.content_tsv, websearch_to_tsquery('english', $1)) AS fts_rank,
               similarity(m.content, $2) AS trgm_score,
               ts_headline('english', m.content, websearch_to_tsquery('english', $3),
                 'MaxWords=30, MinWords=10, StartSel=>>>, StopSel=<<<') AS snippet
        FROM ${this.messagesTable} m JOIN ${this.sessionsTable} s ON s.id = m.session_id
        WHERE (m.content_tsv @@ websearch_to_tsquery('english', $1)
               OR similarity(m.content, $2) > 0.1)
          ${whereExtra}
        ORDER BY (ts_rank(m.content_tsv, websearch_to_tsquery('english', $1)) * 2
                  + similarity(m.content, $2)) DESC
        LIMIT $4
      `;
    } else {
      // FTS-only fallback (no similarity)
      params.splice(1, 1); // remove the second $query param for similarity
      // Re-number: $1=query(fts), $2=query(headline), $3=limit, then filters
      const ftsParams: unknown[] = [opts.query, opts.query, limit];
      let ftsParamIdx = 4;
      let ftsWhereExtra = "";
      if (opts.adapterId) {
        ftsWhereExtra += ` AND s.adapter_id = $${ftsParamIdx}`;
        ftsParams.push(opts.adapterId);
        ftsParamIdx++;
      }
      if (opts.since) {
        ftsWhereExtra += ` AND s.created_at >= $${ftsParamIdx}`;
        ftsParams.push(opts.since);
        ftsParamIdx++;
      }

      sql = `
        SELECT m.id AS message_id, m.session_id, m.role, m.timestamp,
               s.adapter_id, s.name AS session_name, s.developer_id, s.created_at,
               ts_rank(m.content_tsv, websearch_to_tsquery('english', $1)) AS fts_rank,
               0.0 AS trgm_score,
               ts_headline('english', m.content, websearch_to_tsquery('english', $2),
                 'MaxWords=30, MinWords=10, StartSel=>>>, StopSel=<<<') AS snippet
        FROM ${this.messagesTable} m JOIN ${this.sessionsTable} s ON s.id = m.session_id
        WHERE m.content_tsv @@ websearch_to_tsquery('english', $1)
          ${ftsWhereExtra}
        ORDER BY fts_rank DESC
        LIMIT $3
      `;

      const rows = await this.query(sql, ftsParams) as any[];
      return rows.map(rowToSearchResult);
    }

    const rows = await this.query(sql, params) as any[];
    return rows.map(rowToSearchResult);
  }

  /** One-time backfill: populate content_tsv for existing rows */
  async backfillTsvector(): Promise<number> {
    const rows = await this.query(`
      UPDATE ${this.messagesTable}
      SET content_tsv = to_tsvector('english', COALESCE(content, ''))
      WHERE content_tsv IS NULL AND content IS NOT NULL
    `) as any;
    return typeof rows === "number" ? rows : 0;
  }

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
  }

  private getConn(): SQL {
    if (!this.conn) {
      this.conn = new SQL(this.connectionString);
    }
    return this.conn;
  }

  private async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    if (this.connectionString.startsWith("https://") || this.connectionString.startsWith("http://")) {
      return this.queryHttp(sql, params);
    }
    return this.queryPsql(sql, params);
  }

  private async queryHttp(sql: string, params?: unknown[]): Promise<unknown[]> {
    const resp = await fetch(this.connectionString, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, params: params || [] }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Postgres HTTP error ${resp.status}: ${text.slice(0, 200)}`);
    }
    const result = await resp.json() as any;
    return result.rows || [];
  }

  private async queryPsql(query: string, params?: unknown[]): Promise<unknown[]> {
    const db = this.getConn();
    const rows = await db.unsafe(query, params as any[]);
    return Array.from(rows);
  }
}

function toIsoString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  return String(val || "");
}

function rowToSearchResult(row: any): PostgresSearchResult {
  return {
    messageId: row.message_id,
    sessionId: row.session_id,
    role: row.role,
    timestamp: toIsoString(row.timestamp),
    adapterId: row.adapter_id,
    sessionName: row.session_name || "",
    developerId: row.developer_id || "",
    createdAt: toIsoString(row.created_at),
    snippet: row.snippet || "",
    rank: (Number(row.fts_rank) || 0) * 2 + (Number(row.trgm_score) || 0),
  };
}
