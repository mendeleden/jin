import type { Database } from "bun:sqlite";
import type {
  ParsedToolCall,
  ToolCall,
} from "../contracts/conversations";

interface ToolCallRow {
  conversation_id: string;
  message_id: string;
  id: string;
  name: string;
  input: string;
  output: string;
  is_error: number;
  duration_ms: number;
  timestamp: string;
}

export function insertToolCall(
  db: Database,
  conversationId: string,
  messageId: string,
  toolCall: ParsedToolCall,
): void {
  db.run(
    `INSERT INTO tool_calls (
      conversation_id,
      message_id,
      id,
      name,
      input,
      output,
      is_error,
      duration_ms,
      timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conversationId,
      messageId,
      toolCall.id,
      toolCall.name,
      toolCall.input,
      toolCall.output,
      toolCall.isError ? 1 : 0,
      toolCall.durationMs,
      toolCall.timestamp,
    ],
  );
}

export function deleteToolCallsForConversation(
  db: Database,
  conversationId: string,
): void {
  db.run("DELETE FROM tool_calls WHERE conversation_id = ?", [conversationId]);
}

export function getToolCalls(
  db: Database,
  conversationId: string,
): ToolCall[] {
  const rows = db
    .prepare(
      `SELECT tc.*
       FROM tool_calls tc
       LEFT JOIN messages m ON m.id = tc.message_id
       WHERE tc.conversation_id = ?
       ORDER BY COALESCE(m.sequence, 0) ASC, tc.id ASC`,
    )
    .all(conversationId) as ToolCallRow[];

  return rows.map((row) => rowToToolCall(row));
}

export function getToolCallsByMessage(
  db: Database,
  conversationId: string,
): Map<string, ParsedToolCall[]> {
  const grouped = new Map<string, ParsedToolCall[]>();

  for (const toolCall of getToolCalls(db, conversationId)) {
    const current = grouped.get(toolCall.messageId) ?? [];
    current.push({
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
      output: toolCall.output,
      isError: toolCall.isError,
      durationMs: toolCall.durationMs,
      timestamp: toolCall.timestamp,
    });
    grouped.set(toolCall.messageId, current);
  }

  return grouped;
}

function rowToToolCall(row: ToolCallRow): ToolCall {
  return {
    conversationId: row.conversation_id,
    messageId: row.message_id,
    id: row.id,
    name: row.name,
    input: row.input,
    output: row.output,
    isError: !!row.is_error,
    durationMs: row.duration_ms,
    timestamp: row.timestamp,
  };
}
