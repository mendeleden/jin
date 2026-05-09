import type { Database } from "bun:sqlite";
import type { MessageFtsRow } from "./messages";
import { allRows } from "./statements";

export interface SearchMessagesOptions {
  query: string;
  adapterId?: string;
  since?: string;
  limit?: number;
}

export interface SearchMessageResult {
  messageId: string;
  conversationId: string;
  adapterId: string;
  conversationName: string;
  timestamp: string;
  snippet: string;
  rank: number;
}

export function refreshConversationFts(
  db: Database,
  conversationId: string,
  previousRows: MessageFtsRow[],
): void {
  const deleteFtsRow = db.prepare(
    `INSERT INTO messages_fts(messages_fts, rowid, content)
     VALUES('delete', ?, ?)`,
  );

  try {
    for (const row of previousRows) {
      deleteFtsRow.run(row.rowid, row.content);
    }
  } finally {
    deleteFtsRow.finalize();
  }

  db.run(
    `INSERT INTO messages_fts(rowid, content)
     SELECT rowid, content
     FROM messages
     WHERE conversation_id = ?`,
    [conversationId],
  );
}

export function searchMessages(
  db: Database,
  options: SearchMessagesOptions,
): SearchMessageResult[] {
  const limit = options.limit ?? 20;
  let query = `
    SELECT
      m.id AS message_id,
      m.conversation_id,
      c.adapter_id,
      c.name AS conversation_name,
      m.timestamp,
      snippet(messages_fts, 0, '>>>', '<<<', '...', 20) AS snippet,
      bm25(messages_fts) AS rank
    FROM messages_fts
    JOIN messages m ON m.rowid = messages_fts.rowid
    JOIN conversations c ON c.id = m.conversation_id
    WHERE messages_fts MATCH ?
  `;
  const params: Array<string | number> = [options.query];

  if (options.adapterId) {
    query += " AND c.adapter_id = ?";
    params.push(options.adapterId);
  }

  if (options.since) {
    query += " AND COALESCE(NULLIF(c.ended_at, ''), c.started_at) >= ?";
    params.push(options.since);
  }

  query += " ORDER BY rank ASC, m.sequence ASC LIMIT ?";
  params.push(limit);

  const rows = allRows<{
    message_id: string;
    conversation_id: string;
    adapter_id: string;
    conversation_name: string;
    timestamp: string;
    snippet: string;
    rank: number;
  }>(db, query, ...params);

  return rows.map((row) => ({
    messageId: row.message_id,
    conversationId: row.conversation_id,
    adapterId: row.adapter_id,
    conversationName: row.conversation_name,
    timestamp: row.timestamp,
    snippet: row.snippet,
    rank: row.rank,
  }));
}
