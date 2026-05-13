import type { Database } from "bun:sqlite";
import type {
  Conversation,
  ParsedMessage,
  ParsedConversation,
} from "../contracts/conversations";
import { estimateCost } from "../pricing";
import { allRows, getRow } from "./statements";

interface ConversationRow {
  id: string;
  trace_id: string;
  parent_id: string;
  relationship: Conversation["relationship"];
  fork_point: number;
  adapter_id: string;
  name: string;
  cwd: string;
  git_remote: string;
  branch: string;
  model: string;
  started_at: string;
  ended_at: string;
  source_path: string;
  source_format: Conversation["sourceFormat"];
  duration_ms: number;
  message_count: number;
  tool_count: number;
  turn_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  est_cost: number;
}

interface MessageCostRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
}

export interface ConversationDerivedFields {
  durationMs: number;
  messageCount: number;
  toolCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  estCost: number;
}

export function upsertConversation(
  db: Database,
  conversation: ParsedConversation,
): void {
  db.run(
    `INSERT INTO conversations (
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
      source_format
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      trace_id = excluded.trace_id,
      parent_id = excluded.parent_id,
      relationship = excluded.relationship,
      fork_point = excluded.fork_point,
      adapter_id = excluded.adapter_id,
      name = excluded.name,
      cwd = excluded.cwd,
      git_remote = excluded.git_remote,
      branch = excluded.branch,
      model = excluded.model,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      source_path = excluded.source_path,
      source_format = excluded.source_format`,
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
    ],
  );
}

export function recomputeConversationDerivedFields(
  db: Database,
  conversationId: string,
): void {
  const conversationRow = getRow<{
    model: string;
    started_at: string;
    ended_at: string;
  }>(
    db,
    `SELECT model, started_at, ended_at
     FROM conversations
     WHERE id = ?`,
    conversationId,
  );

  if (!conversationRow) {
    return;
  }

  const messageCostRows = allRows<MessageCostRow>(
    db,
    `SELECT
      model,
      input_tokens,
      output_tokens,
      cache_read,
      cache_write
     FROM messages
     WHERE conversation_id = ?`,
    conversationId,
  );

  const rows = allRows<{
    turn: number;
    input_tokens: number;
    output_tokens: number;
    cache_read: number;
    cache_write: number;
  }>(
    db,
    `SELECT
      turn,
      input_tokens,
      output_tokens,
      cache_read,
      cache_write
     FROM messages
     WHERE conversation_id = ?`,
    conversationId,
  );

  const toolCount =
    getRow<{ tool_count: number }>(
      db,
      `SELECT COUNT(*) AS tool_count
       FROM tool_calls
       WHERE conversation_id = ?`,
      conversationId,
    )?.tool_count ?? 0;

  const derived = {
    durationMs: computeDurationMs(
      conversationRow.started_at,
      conversationRow.ended_at,
    ),
    messageCount: rows.length,
    toolCount,
    turnCount: rows.reduce((max, row) => Math.max(max, row.turn), 0),
    inputTokens: rows.reduce((sum, row) => sum + row.input_tokens, 0),
    outputTokens: rows.reduce((sum, row) => sum + row.output_tokens, 0),
    cacheRead: rows.reduce((sum, row) => sum + row.cache_read, 0),
    cacheWrite: rows.reduce((sum, row) => sum + row.cache_write, 0),
    estCost: estimateConversationCost(
      messageCostRows,
      conversationRow.model,
    ),
  };

  persistConversationDerivedFields(
    db,
    conversationId,
    derived,
  );
}

export function getConversation(
  db: Database,
  conversationId: string,
): Conversation | null {
  const row = getRow<ConversationRow>(
    db,
    "SELECT * FROM conversations WHERE id = ?",
    conversationId,
  );

  return row ? rowToConversation(row) : null;
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    traceId: row.trace_id,
    parentId: row.parent_id,
    relationship: row.relationship,
    forkPoint: row.fork_point,
    adapterId: row.adapter_id,
    name: row.name,
    cwd: row.cwd,
    gitRemote: row.git_remote,
    branch: row.branch,
    model: row.model,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    sourcePath: row.source_path,
    sourceFormat: row.source_format,
    durationMs: row.duration_ms,
    messageCount: row.message_count,
    toolCount: row.tool_count,
    turnCount: row.turn_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheRead: row.cache_read,
    cacheWrite: row.cache_write,
    estCost: row.est_cost,
  };
}

function computeDurationMs(startedAt: string, endedAt: string): number {
  if (!startedAt || !endedAt) {
    return 0;
  }

  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);

  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return 0;
  }

  return Math.max(0, ended - started);
}

function estimateConversationCost(
  rows: MessageCostRow[],
  fallbackModel: string,
): number {
  if (rows.length === 0) {
    return 0;
  }

  return rows.reduce((total, row) => {
    const model = row.model || fallbackModel;
    return (
      total +
      estimateCost(
        model,
        row.input_tokens,
        row.output_tokens,
        row.cache_read,
        row.cache_write,
      )
    );
  }, 0);
}

export function deriveConversationFields(
  conversation: ParsedConversation,
  messages: ReadonlyArray<ParsedMessage>,
): ConversationDerivedFields {
  return {
    durationMs: computeDurationMs(conversation.startedAt, conversation.endedAt),
    messageCount: messages.length,
    toolCount: messages.reduce(
      (sum, message) => sum + message.toolUses.length,
      0,
    ),
    turnCount: messages.reduce((max, message) => Math.max(max, message.turn), 0),
    inputTokens: messages.reduce(
      (sum, message) => sum + message.inputTokens,
      0,
    ),
    outputTokens: messages.reduce(
      (sum, message) => sum + message.outputTokens,
      0,
    ),
    cacheRead: messages.reduce((sum, message) => sum + message.cacheRead, 0),
    cacheWrite: messages.reduce((sum, message) => sum + message.cacheWrite, 0),
    estCost: messages.reduce((total, message) => {
      const model = message.model || conversation.model;
      return (
        total +
        estimateCost(
          model,
          message.inputTokens,
          message.outputTokens,
          message.cacheRead,
          message.cacheWrite,
        )
      );
    }, 0),
  };
}

export function persistConversationDerivedFields(
  db: Database,
  conversationId: string,
  fields: ConversationDerivedFields,
): void {
  db.run(
    `UPDATE conversations
     SET
       duration_ms = ?,
       message_count = ?,
       tool_count = ?,
       turn_count = ?,
       input_tokens = ?,
       output_tokens = ?,
       cache_read = ?,
       cache_write = ?,
       est_cost = ?
     WHERE id = ?`,
    [
      fields.durationMs,
      fields.messageCount,
      fields.toolCount,
      fields.turnCount,
      fields.inputTokens,
      fields.outputTokens,
      fields.cacheRead,
      fields.cacheWrite,
      fields.estCost,
      conversationId,
    ],
  );
}
