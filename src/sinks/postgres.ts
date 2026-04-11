import { SQL } from "bun";
import type {
  PushPayload as LegacyPushPayload,
  PushResult as LegacyPushResult,
  Sink as LegacySink,
  SinkConfig as LegacySinkConfig,
  V2PushPayload as SnapshotPushPayload,
  V2PushResult as SnapshotPushResult,
  V2Sink as SnapshotSink,
  V2SinkConfig as SnapshotSinkConfig,
  V2SinkHealth as SnapshotSinkHealth,
} from "./types";

type PostgresSinkConfig = LegacySinkConfig | SnapshotSinkConfig;
type QueryRow = Record<string, unknown>;
type QueryRunner = (query: string, params?: unknown[]) => Promise<QueryRow[]>;
type SqlUnsafeExecutor = {
  unsafe(query: string, params?: any[]): Promise<unknown>;
};

type SchemaVersion = {
  raw: string;
  major: number;
  minor: number;
  patch: number;
};

const DEFAULT_SCHEMA = "public";
const DEFAULT_CONVERSATIONS_TABLE = "jin_conversations";
const DEFAULT_MESSAGES_TABLE = "jin_messages";
const DEFAULT_TOOL_CALLS_TABLE = "jin_tool_calls";
const META_TABLE = "jin_meta";
const LOCAL_SCHEMA_VERSION = "2.4";
const LEGACY_PAYLOAD_ERROR =
  "PostgresSink requires v2 push payloads with conversation, messages, and toolCalls.";
const REQUIRED_TOOL_CALLS_PRIMARY_KEY =
  "PRIMARY KEY (conversation_id, message_id, id)";

export class PostgresSink implements LegacySink, SnapshotSink {
  id = "postgres";
  name = "PostgreSQL";
  supportsDelta = false;

  private readonly connectionString: string;
  private readonly metaTable: string;
  private readonly conversationsTable: string;
  private readonly messagesTable: string;
  private readonly toolCallsTable: string;
  private conn: SQL | null = null;

  constructor(config: PostgresSinkConfig) {
    const connectionString = readOptionalString(config, "connectionString");
    if (!connectionString) {
      throw new Error("Postgres sink requires 'connectionString'");
    }

    this.connectionString = connectionString;
    this.id = readOptionalString(config, "id") ?? this.id;
    this.name = readOptionalString(config, "name") ?? this.name;

    const schema = readOptionalString(config, "schema") ?? DEFAULT_SCHEMA;
    const tableNames = resolveTableNames(schema, readOptionalString(config, "table"));

    this.metaTable = qualifyIdentifier(schema, META_TABLE);
    this.conversationsTable = tableNames.conversations;
    this.messagesTable = tableNames.messages;
    this.toolCallsTable = tableNames.toolCalls;
  }

  async healthCheck(): Promise<SnapshotSinkHealth> {
    return await this.checkSchemaCompatibility();
  }

  async push(payloads: LegacyPushPayload[]): Promise<LegacyPushResult>;
  async push(payloads: SnapshotPushPayload[]): Promise<SnapshotPushResult>;
  async push(
    payloads: LegacyPushPayload[] | SnapshotPushPayload[],
  ): Promise<LegacyPushResult | SnapshotPushResult> {
    if (isLegacyPayloadArray(payloads)) {
      return legacyPayloadFailure(payloads);
    }

    return await this.pushSnapshots(payloads);
  }

  async close(): Promise<void> {
    const conn = this.conn;
    this.conn = null;

    if (conn) {
      await conn.close();
    }
  }

  private async pushSnapshots(payloads: SnapshotPushPayload[]): Promise<SnapshotPushResult> {
    if (payloads.length === 0) {
      return { pushed: 0, failed: 0, errors: [] };
    }

    const readiness = await this.checkSchemaCompatibility();
    if (!readiness.ok) {
      return failAllPayloads(payloads, readiness.error ?? "Postgres sink is not ready.");
    }

    const errors: SnapshotPushResult["errors"] = [];
    let pushed = 0;

    for (const payload of payloads) {
      try {
        await this.pushSnapshot(payload);
        pushed += 1;
      } catch (error) {
        errors.push({
          conversationId: payload.conversation.id,
          error: toErrorMessage(error),
        });
      }
    }

    return {
      pushed,
      failed: payloads.length - pushed,
      errors,
    };
  }

  private async pushSnapshot(payload: SnapshotPushPayload): Promise<void> {
    await this.withSnapshotTransaction(async (query) => {
      await this.upsertConversation(payload, query);
      await query(
        `DELETE FROM ${this.toolCallsTable} WHERE conversation_id = $1`,
        [payload.conversation.id],
      );
      await query(
        `DELETE FROM ${this.messagesTable} WHERE conversation_id = $1`,
        [payload.conversation.id],
      );

      for (const message of payload.messages) {
        await this.insertMessage(message, query);
      }

      for (const toolCall of payload.toolCalls) {
        await this.insertToolCall(toolCall, query);
      }
    });
  }

  private async withSnapshotTransaction(work: (query: QueryRunner) => Promise<void>): Promise<void> {
    if (
      this.connectionString.startsWith("https://") ||
      this.connectionString.startsWith("http://")
    ) {
      await this.query("BEGIN");
      try {
        await work((query, params) => this.query(query, params));
        await this.query("COMMIT");
      } catch (error) {
        await this.safeRollback();
        throw error;
      }

      return;
    }

    await this.getConn().begin(async (transaction) => {
      await work((query, params) => this.queryPsqlWith(transaction, query, params));
    });
  }

  private async upsertConversation(payload: SnapshotPushPayload, query: QueryRunner): Promise<void> {
    const conversation = payload.conversation;

    await query(
      `INSERT INTO ${this.conversationsTable} (
         id,
         trace_id,
         parent_id,
         relationship,
         fork_point,
         adapter_id,
         name,
         cwd,
         git_remote,
         branch,
         model,
         started_at,
         ended_at,
         source_path,
         source_format,
         duration_ms,
         message_count,
         tool_count,
         turn_count,
         input_tokens,
         output_tokens,
         cache_read,
         cache_write,
         est_cost
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
       )
       ON CONFLICT (id) DO UPDATE SET
         trace_id = EXCLUDED.trace_id,
         parent_id = EXCLUDED.parent_id,
         relationship = EXCLUDED.relationship,
         fork_point = EXCLUDED.fork_point,
         adapter_id = EXCLUDED.adapter_id,
         name = EXCLUDED.name,
         cwd = EXCLUDED.cwd,
         git_remote = EXCLUDED.git_remote,
         branch = EXCLUDED.branch,
         model = EXCLUDED.model,
         started_at = EXCLUDED.started_at,
         ended_at = EXCLUDED.ended_at,
         source_path = EXCLUDED.source_path,
         source_format = EXCLUDED.source_format,
         duration_ms = EXCLUDED.duration_ms,
         message_count = EXCLUDED.message_count,
         tool_count = EXCLUDED.tool_count,
         turn_count = EXCLUDED.turn_count,
         input_tokens = EXCLUDED.input_tokens,
         output_tokens = EXCLUDED.output_tokens,
         cache_read = EXCLUDED.cache_read,
         cache_write = EXCLUDED.cache_write,
         est_cost = EXCLUDED.est_cost`,
      [
        conversation.id,
        conversation.traceId,
        conversation.parentId,
        conversation.relationship,
        conversation.forkPoint,
        conversation.adapterId,
        conversation.name,
        conversation.cwd,
        conversation.gitRemote,
        conversation.branch,
        conversation.model,
        conversation.startedAt,
        conversation.endedAt,
        conversation.sourcePath,
        conversation.sourceFormat,
        conversation.durationMs,
        conversation.messageCount,
        conversation.toolCount,
        conversation.turnCount,
        conversation.inputTokens,
        conversation.outputTokens,
        conversation.cacheRead,
        conversation.cacheWrite,
        conversation.estCost,
      ],
    );
  }

  private async insertMessage(
    message: SnapshotPushPayload["messages"][number],
    query: QueryRunner,
  ): Promise<void> {
    await query(
      `INSERT INTO ${this.messagesTable} (
         id,
         conversation_id,
         role,
         content,
         record_type,
         model,
         sequence,
         turn,
         is_sidechain,
         parent_message_id,
         input_tokens,
         output_tokens,
         cache_read,
         cache_write,
         thinking_content,
         thinking_tokens,
         timestamp
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
       )`,
      [
        message.id,
        message.conversationId,
        message.role,
        message.content,
        message.recordType,
        message.model,
        message.sequence,
        message.turn,
        message.isSidechain,
        message.parentMessageId,
        message.inputTokens,
        message.outputTokens,
        message.cacheRead,
        message.cacheWrite,
        message.thinkingContent,
        message.thinkingTokens,
        message.timestamp,
      ],
    );
  }

  private async insertToolCall(
    toolCall: SnapshotPushPayload["toolCalls"][number],
    query: QueryRunner,
  ): Promise<void> {
    await query(
      `INSERT INTO ${this.toolCallsTable} (
         id,
         conversation_id,
         message_id,
         name,
         input,
         output,
         is_error,
         duration_ms,
         timestamp
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9
       )`,
      [
        toolCall.id,
        toolCall.conversationId,
        toolCall.messageId,
        toolCall.name,
        toolCall.input,
        toolCall.output,
        toolCall.isError,
        toolCall.durationMs,
        toolCall.timestamp,
      ],
    );
  }

  private async checkSchemaCompatibility(): Promise<SnapshotSinkHealth> {
    const localVersion = parseSchemaVersion(LOCAL_SCHEMA_VERSION);
    if (!localVersion) {
      return { ok: false, error: `Invalid local schema version ${LOCAL_SCHEMA_VERSION}` };
    }

    try {
      const rows = await this.query(
        `SELECT value FROM ${this.metaTable} WHERE key = $1 LIMIT 1`,
        ["schema_version"],
      );
      const rawValue = rows[0]?.value;

      if (rawValue == null || rawValue === "") {
        return {
          ok: false,
          error: `Remote schema is not initialized: missing schema_version in ${this.metaTable}.`,
        };
      }

      const remoteVersion = parseSchemaVersion(rawValue);
      if (!remoteVersion) {
        return {
          ok: false,
          error: `Remote schema version ${String(rawValue)} is not a supported major.minor version.`,
        };
      }

      if (remoteVersion.major > localVersion.major) {
        return {
          ok: false,
          error:
            `Remote schema version ${remoteVersion.raw} is newer than local ${localVersion.raw}. ` +
            "Push paused until jin is upgraded.",
        };
      }

      if (remoteVersion.major < localVersion.major) {
        return {
          ok: false,
          error:
            `Remote schema version ${remoteVersion.raw} is older than local ${localVersion.raw}. ` +
            "Push paused until the remote schema is upgraded.",
        };
      }

      const toolCallConstraint = await this.readPrimaryKeyDefinition(
        this.toolCallsTable,
      );
      if (toolCallConstraint !== REQUIRED_TOOL_CALLS_PRIMARY_KEY) {
        return {
          ok: false,
          error:
            `Remote schema is incompatible: ${this.toolCallsTable} must use ` +
            `${REQUIRED_TOOL_CALLS_PRIMARY_KEY}. Run \`jin team schema apply\` ` +
            "to repair the Postgres integration schema.",
        };
      }

      return { ok: true };
    } catch (error) {
      if (looksLikeMissingMetaTable(error)) {
        return {
          ok: false,
          error: `Remote schema is not initialized: missing ${this.metaTable}.`,
        };
      }

      return { ok: false, error: toErrorMessage(error) };
    }
  }

  private getConn(): SQL {
    if (!this.conn) {
      this.conn = new SQL(this.connectionString);
    }

    return this.conn;
  }

  private async safeRollback(): Promise<void> {
    try {
      await this.query("ROLLBACK");
    } catch {
      // Best-effort rollback only; the original push error is the useful signal.
    }
  }

  private async query(sql: string, params?: unknown[]): Promise<QueryRow[]> {
    if (
      this.connectionString.startsWith("https://") ||
      this.connectionString.startsWith("http://")
    ) {
      return await this.queryHttp(sql, params);
    }

    return await this.queryPsql(sql, params);
  }

  private async queryHttp(sql: string, params?: unknown[]): Promise<QueryRow[]> {
    const response = await fetch(this.connectionString, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: sql,
        params: params ?? [],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Postgres HTTP error ${response.status}: ${text.slice(0, 200)}`);
    }

    const result = (await response.json()) as { rows?: QueryRow[] };
    return Array.isArray(result.rows) ? result.rows : [];
  }

  private async queryPsql(sql: string, params?: unknown[]): Promise<QueryRow[]> {
    return await this.getConn().begin(async (transaction) =>
      this.queryPsqlWith(transaction, sql, params),
    );
  }

  private async queryPsqlWith(
    executor: SqlUnsafeExecutor,
    query: string,
    params?: unknown[],
  ): Promise<QueryRow[]> {
    const rows = await executor.unsafe(query, (params ?? []) as any[]);
    return normalizeQueryRows(rows);
  }

  private async readPrimaryKeyDefinition(
    qualifiedTableName: string,
  ): Promise<string | null> {
    const rows = await this.query(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = to_regclass($1)
          AND contype = 'p'
        LIMIT 1`,
      [toRegclassName(qualifiedTableName)],
    );

    const definition = rows[0]?.definition;
    return typeof definition === "string" && definition.trim() !== ""
      ? definition
      : null;
  }
}

function normalizeQueryRows(rows: unknown): QueryRow[] {
  if (!rows) {
    return [];
  }

  if (Array.isArray(rows)) {
    return rows as QueryRow[];
  }

  if (typeof (rows as Iterable<unknown>)[Symbol.iterator] === "function") {
    return Array.from(rows as Iterable<QueryRow>);
  }

  return [];
}

function resolveTableNames(schema: string, configuredTable?: string): {
  conversations: string;
  messages: string;
  toolCalls: string;
} {
  if (!configuredTable) {
    return {
      conversations: qualifyIdentifier(schema, DEFAULT_CONVERSATIONS_TABLE),
      messages: qualifyIdentifier(schema, DEFAULT_MESSAGES_TABLE),
      toolCalls: qualifyIdentifier(schema, DEFAULT_TOOL_CALLS_TABLE),
    };
  }

  if (configuredTable.endsWith("_conversations")) {
    const stem = configuredTable.slice(0, -"_conversations".length);
    return {
      conversations: qualifyIdentifier(schema, configuredTable),
      messages: qualifyIdentifier(schema, `${stem}_messages`),
      toolCalls: qualifyIdentifier(schema, `${stem}_tool_calls`),
    };
  }

  if (configuredTable.endsWith("_sessions")) {
    const stem = configuredTable.slice(0, -"_sessions".length);
    return {
      conversations: qualifyIdentifier(schema, configuredTable),
      messages: qualifyIdentifier(schema, `${stem}_messages`),
      toolCalls: qualifyIdentifier(schema, `${stem}_tool_calls`),
    };
  }

  return {
    conversations: qualifyIdentifier(schema, configuredTable),
    messages: qualifyIdentifier(schema, `${configuredTable}_messages`),
    toolCalls: qualifyIdentifier(schema, `${configuredTable}_tool_calls`),
  };
}

function qualifyIdentifier(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function toRegclassName(qualifiedIdentifier: string): string {
  return qualifiedIdentifier.replaceAll('"', "");
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid Postgres identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function readOptionalString(config: PostgresSinkConfig, key: string): string | undefined {
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function parseSchemaVersion(value: unknown): SchemaVersion | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).trim().replace(/^v/i, "");
  if (!/^\d+(?:\.\d+){0,2}$/.test(normalized)) {
    return null;
  }

  const [major = 0, minor = 0, patch = 0] = normalized.split(".").map((part) => Number(part));

  return {
    raw: normalized,
    major,
    minor,
    patch,
  };
}

function isLegacyPayloadArray(
  payloads: LegacyPushPayload[] | SnapshotPushPayload[],
): payloads is LegacyPushPayload[] {
  const first = payloads[0] as Record<string, unknown> | undefined;
  return !!first && "session" in first;
}

function legacyPayloadFailure(payloads: LegacyPushPayload[]): LegacyPushResult {
  return {
    pushed: 0,
    failed: payloads.length,
    errors: payloads.map(({ session }) => `Conversation ${session.id}: ${LEGACY_PAYLOAD_ERROR}`),
  };
}

function failAllPayloads(
  payloads: SnapshotPushPayload[],
  error: string,
): SnapshotPushResult {
  return {
    pushed: 0,
    failed: payloads.length,
    errors: payloads.map((payload) => ({
      conversationId: payload.conversation.id,
      error,
    })),
  };
}

function looksLikeMissingMetaTable(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  if (!message.includes("jin_meta")) {
    return false;
  }

  const code = readPostgresErrorCode(error);
  return code === "42P01" || message.includes("does not exist") || message.includes("undefined table");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function readPostgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  const code =
    record.code ??
    record.sqlstate ??
    record.sqlState;

  return typeof code === "string" && code.trim() !== "" ? code : undefined;
}
