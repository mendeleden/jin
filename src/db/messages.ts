import type { Database } from "bun:sqlite";
import type {
  Message,
  ParsedMessage,
} from "../contracts/conversations";
import { allRows } from "./statements";
import { getToolCallsByMessage } from "./tool-calls";

export interface MessageFtsRow {
  rowid: number;
  content: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  record_type: string;
  model: string;
  sequence: number;
  turn: number;
  is_sidechain: number;
  parent_message_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  thinking_content: string;
  thinking_tokens: number;
  timestamp: string;
}

export function insertMessage(
  db: Database,
  conversationId: string,
  message: ParsedMessage,
): void {
  db.run(
    `INSERT INTO messages (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      conversationId,
      message.role,
      message.content,
      message.recordType,
      message.model,
      message.sequence,
      message.turn,
      message.isSidechain ? 1 : 0,
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

export function deleteMessagesForConversation(
  db: Database,
  conversationId: string,
): void {
  db.run("DELETE FROM messages WHERE conversation_id = ?", [conversationId]);
}

export function getMessages(
  db: Database,
  conversationId: string,
): Message[] {
  const toolCallsByMessage = getToolCallsByMessage(db, conversationId);
  const rows = allRows<MessageRow>(
    db,
    `SELECT *
     FROM messages
     WHERE conversation_id = ?
     ORDER BY sequence ASC, id ASC`,
    conversationId,
  );

  return rows.map((row) =>
    rowToMessage(row, toolCallsByMessage.get(row.id) ?? []),
  );
}

export function getMessageFtsRows(
  db: Database,
  conversationId: string,
): MessageFtsRow[] {
  return allRows<MessageFtsRow>(
    db,
    `SELECT rowid, content
     FROM messages
     WHERE conversation_id = ?`,
    conversationId,
  );
}

function rowToMessage(
  row: MessageRow,
  toolUses: ParsedMessage["toolUses"],
): Message {
  return {
    conversationId: row.conversation_id,
    id: row.id,
    role: row.role,
    content: row.content,
    recordType: row.record_type,
    model: row.model,
    sequence: row.sequence,
    turn: row.turn,
    isSidechain: !!row.is_sidechain,
    parentMessageId: row.parent_message_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheRead: row.cache_read,
    cacheWrite: row.cache_write,
    thinkingContent: row.thinking_content,
    thinkingTokens: row.thinking_tokens,
    timestamp: row.timestamp,
    toolUses,
  };
}
