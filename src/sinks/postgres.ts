import { SQL } from "bun";
import type { Sink, SinkConfig, PushPayload, PushResult } from "./types";

/**
 * PostgreSQL sink.
 *
 * Supports two connection modes:
 * 1. Standard postgres:// — uses Bun's built-in SQL driver (zero dependencies)
 * 2. HTTP endpoints (Neon/Supabase) — uses SQL-over-HTTP via fetch
 */
export class PostgresSink implements Sink {
  id = "postgres";
  name = "PostgreSQL";
  supportsDelta = true;
  private connectionString: string;
  private schema: string;
  private sessionsTable: string;
  private messagesTable: string;
  private teamId: string;
  private developerId: string;
  private conn: SQL | null = null;
  private tablesEnsured = false;

  constructor(config: SinkConfig) {
    if (!config.connectionString) {
      throw new Error("Postgres sink requires 'connectionString'");
    }
    this.connectionString = config.connectionString;
    this.schema = config.schema || "public";
    this.sessionsTable = `${this.schema}.${config.table || "jin_sessions"}`;
    this.messagesTable = `${this.schema}.${config.table ? config.table + "_messages" : "jin_messages"}`;
    this.teamId = config.teamId || "";
    this.developerId = config.developerId || "";
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.query("SELECT 1");
      // Ensure tables on first successful connection, not on every push
      if (!this.tablesEnsured) {
        await this.ensureTables();
        this.tablesEnsured = true;
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async push(data: PushPayload[]): Promise<PushResult> {
    let pushed = 0;
    let failed = 0;
    const errors: string[] = [];

    // Ensure tables exist (only runs once, on first healthCheck)
    if (!this.tablesEnsured) {
      try {
        await this.ensureTables();
        this.tablesEnsured = true;
      } catch (err) {
        return { pushed: 0, failed: data.length, errors: [`Table creation failed: ${err}`] };
      }
    }

    for (const { session, messages } of data) {
      try {
        // Upsert session
        await this.query(
          `INSERT INTO ${this.sessionsTable}
           (id, adapter_id, adapter_name, name, created_at, updated_at, duration_ms,
            is_active, total_tokens, est_cost, message_count, source_path,
            is_sub_agent, metadata, team_id, developer_id, ingested_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (id) DO UPDATE SET
            name=EXCLUDED.name, updated_at=EXCLUDED.updated_at,
            total_tokens=EXCLUDED.total_tokens, est_cost=EXCLUDED.est_cost,
            message_count=EXCLUDED.message_count, metadata=EXCLUDED.metadata,
            ingested_at=EXCLUDED.ingested_at`,
          [
            session.id, session.adapterId, session.adapterName, session.name,
            session.createdAt, session.updatedAt, session.durationMs,
            session.isActive, session.totalTokens, session.estCost,
            session.messageCount, session.sourcePath, session.isSubAgent,
            JSON.stringify(session.metadata), this.teamId, this.developerId,
            new Date().toISOString(),
          ]
        );

        // Batch upsert messages (100 per INSERT to stay within Postgres param limits)
        const BATCH_SIZE = 100;
        const COLS_PER_ROW = 12;
        for (let i = 0; i < messages.length; i += BATCH_SIZE) {
          const batch = messages.slice(i, i + BATCH_SIZE);
          const valueClauses: string[] = [];
          const params: unknown[] = [];

          for (let j = 0; j < batch.length; j++) {
            const msg = batch[j];
            const offset = j * COLS_PER_ROW;
            valueClauses.push(
              `($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10},$${offset+11},$${offset+12})`
            );
            params.push(
              msg.id, session.id, msg.role, msg.content, msg.timestamp,
              msg.model, msg.inputTokens, msg.outputTokens,
              msg.cacheRead, msg.cacheWrite,
              JSON.stringify(msg.toolUses), JSON.stringify(msg.thinkingBlocks),
            );
          }

          await this.query(
            `INSERT INTO ${this.messagesTable}
             (id, session_id, role, content, timestamp, model,
              input_tokens, output_tokens, cache_read, cache_write,
              tool_uses, thinking_blocks)
             VALUES ${valueClauses.join(",")}
             ON CONFLICT (id) DO UPDATE SET
              content=EXCLUDED.content, tool_uses=EXCLUDED.tool_uses`,
            params
          );
        }

        pushed++;
      } catch (err) {
        failed++;
        errors.push(`Session ${session.id}: ${err}`);
      }
    }

    return { pushed, failed, errors };
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

  private async ensureTables(): Promise<void> {
    await this.query(`
      CREATE TABLE IF NOT EXISTS ${this.sessionsTable} (
        id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        adapter_name TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ,
        duration_ms BIGINT DEFAULT 0,
        is_active BOOLEAN DEFAULT FALSE,
        total_tokens INTEGER DEFAULT 0,
        est_cost DOUBLE PRECISION DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        source_path TEXT,
        is_sub_agent BOOLEAN DEFAULT FALSE,
        metadata JSONB DEFAULT '{}',
        team_id TEXT DEFAULT '',
        developer_id TEXT DEFAULT '',
        ingested_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS ${this.messagesTable} (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES ${this.sessionsTable}(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT,
        timestamp TIMESTAMPTZ,
        model TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read INTEGER DEFAULT 0,
        cache_write INTEGER DEFAULT 0,
        tool_uses JSONB DEFAULT '[]',
        thinking_blocks JSONB DEFAULT '[]'
      )
    `);

    await this.query(
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_jin_sess_team ON ${this.sessionsTable}(team_id)`
    );
    await this.query(
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_jin_sess_dev ON ${this.sessionsTable}(developer_id)`
    );
    await this.query(
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_jin_msg_sess ON ${this.messagesTable}(session_id)`
    );

    // Full-text search support: tsvector column + GIN index + auto-populate trigger
    await this.query(
      `ALTER TABLE ${this.messagesTable} ADD COLUMN IF NOT EXISTS content_tsv tsvector`
    );
    await this.query(
      `CREATE INDEX IF NOT EXISTS idx_${this.schema}_jin_msg_fts ON ${this.messagesTable} USING GIN(content_tsv)`
    );
    await this.query(`
      CREATE OR REPLACE FUNCTION jin_messages_tsv_trigger() RETURNS trigger AS $$
      BEGIN
        NEW.content_tsv := to_tsvector('english', COALESCE(NEW.content, ''));
        RETURN NEW;
      END; $$ LANGUAGE plpgsql
    `);
    await this.query(
      `DROP TRIGGER IF EXISTS jin_messages_tsv_update ON ${this.messagesTable}`
    );
    await this.query(`
      CREATE TRIGGER jin_messages_tsv_update BEFORE INSERT OR UPDATE OF content
        ON ${this.messagesTable} FOR EACH ROW EXECUTE FUNCTION jin_messages_tsv_trigger()
    `);

    // pg_trgm for fuzzy matching (optional — not all providers support it)
    try {
      await this.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.schema}_jin_msg_trgm ON ${this.messagesTable} USING GIN(content gin_trgm_ops)`
      );
    } catch {
      // pg_trgm not available — fuzzy search will be skipped
    }
  }

  /**
   * Execute SQL against Postgres.
   *
   * Supports two modes:
   * 1. Neon/Supabase serverless HTTP (if connectionString is https://)
   * 2. Standard pg wire protocol via Bun's built-in SQL driver
   */
  private async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    // For Neon serverless / Supabase — HTTP-based SQL
    if (this.connectionString.startsWith("https://") || this.connectionString.startsWith("http://")) {
      return this.queryHttp(sql, params);
    }

    // For standard postgres:// connections, use Bun's built-in SQL driver
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
