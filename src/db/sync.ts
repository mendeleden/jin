import type { Database } from "bun:sqlite";
import type {
  OrphanedConversation,
  RecordedPushResult,
  SyncStateRecord,
} from "../contracts/store";

interface SyncRow {
  conversation_id: string;
  bundle_hash: string;
  local_revision: number;
  ingested_at: string;
}

export interface ResetSinkPushStateResult {
  clearedStateRows: number;
  dirtyBefore: number;
  dirtyAfter: number;
}

export function getSyncState(
  db: Database,
  conversationId: string,
): SyncStateRecord | null {
  const row = db
    .prepare(
      `SELECT conversation_id, bundle_hash, local_revision, ingested_at
       FROM _jin_sync
       WHERE conversation_id = ?`,
    )
    .get(conversationId) as SyncRow | null;

  return row
    ? {
        conversationId: row.conversation_id,
        bundleHash: row.bundle_hash,
        localRevision: row.local_revision,
        ingestedAt: row.ingested_at,
      }
    : null;
}

export function upsertSyncState(
  db: Database,
  record: SyncStateRecord,
): void {
  db.run(
    `INSERT INTO _jin_sync (
      conversation_id,
      bundle_hash,
      local_revision,
      ingested_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET
      bundle_hash = excluded.bundle_hash,
      local_revision = excluded.local_revision,
      ingested_at = excluded.ingested_at`,
    [
      record.conversationId,
      record.bundleHash,
      record.localRevision,
      record.ingestedAt,
    ],
  );
}

export function updateSyncIngestedAt(
  db: Database,
  conversationId: string,
  ingestedAt: string,
): void {
  db.run(
    `UPDATE _jin_sync
     SET ingested_at = ?
     WHERE conversation_id = ?`,
    [ingestedAt, conversationId],
  );
}

export function getRevision(
  db: Database,
  conversationId: string,
): number {
  const row = db
    .prepare(
      `SELECT local_revision
       FROM _jin_sync
       WHERE conversation_id = ?`,
    )
    .get(conversationId) as { local_revision?: number } | null;

  return row?.local_revision ?? 0;
}

export function conversationsNeedingPush(
  db: Database,
  sinkId: string,
): string[] {
  const rows = db
    .prepare(
      `SELECT s.conversation_id
       FROM _jin_sync s
       LEFT JOIN _jin_push_state p
         ON p.conversation_id = s.conversation_id
        AND p.sink_id = ?
       WHERE COALESCE(p.last_successful_revision, 0) < s.local_revision
       ORDER BY s.conversation_id ASC`,
    )
    .all(sinkId) as Array<{ conversation_id: string }>;

  return rows.map((row) => row.conversation_id);
}

export function recordPushResult(
  db: Database,
  conversationId: string,
  sinkId: string,
  attemptedRevision: number,
  result: RecordedPushResult,
): void {
  const attemptedAt = new Date().toISOString();

  if (result.ok) {
    db.run(
      `INSERT INTO _jin_push_state (
        conversation_id,
        sink_id,
        last_attempted_revision,
        last_successful_revision,
        last_attempted_at,
        last_successful_at,
        last_error
      ) VALUES (?, ?, ?, ?, ?, ?, '')
      ON CONFLICT(conversation_id, sink_id) DO UPDATE SET
        last_attempted_revision = excluded.last_attempted_revision,
        last_successful_revision = excluded.last_successful_revision,
        last_attempted_at = excluded.last_attempted_at,
        last_successful_at = excluded.last_successful_at,
        last_error = ''`,
      [
        conversationId,
        sinkId,
        attemptedRevision,
        attemptedRevision,
        attemptedAt,
        attemptedAt,
      ],
    );
    return;
  }

  db.run(
    `INSERT INTO _jin_push_state (
      conversation_id,
      sink_id,
      last_attempted_revision,
      last_successful_revision,
      last_attempted_at,
      last_successful_at,
      last_error
    ) VALUES (?, ?, ?, 0, ?, '', ?)
    ON CONFLICT(conversation_id, sink_id) DO UPDATE SET
      last_attempted_revision = excluded.last_attempted_revision,
      last_attempted_at = excluded.last_attempted_at,
      last_error = excluded.last_error`,
    [
      conversationId,
      sinkId,
      attemptedRevision,
      attemptedAt,
      result.error,
    ],
  );
}

export function resetPushStateForSink(
  db: Database,
  sinkId: string,
): ResetSinkPushStateResult {
  const dirtyBefore = conversationsNeedingPush(db, sinkId).length;
  const clearedStateRows = countPushStateRows(db, sinkId);

  db.run(
    `DELETE FROM _jin_push_state
     WHERE sink_id = ?`,
    [sinkId],
  );

  return {
    clearedStateRows,
    dirtyBefore,
    dirtyAfter: conversationsNeedingPush(db, sinkId).length,
  };
}

export function findOrphanedConversations(
  db: Database,
): OrphanedConversation[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.parent_id, c.adapter_id, c.relationship
       FROM conversations c
       WHERE c.parent_id != ''
         AND NOT EXISTS (
           SELECT 1
           FROM conversations p
           WHERE p.id = c.parent_id
         )
       ORDER BY c.id ASC`,
    )
    .all() as Array<{
    id: string;
    parent_id: string;
    adapter_id: string;
    relationship: OrphanedConversation["relationship"];
  }>;

  return rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    adapterId: row.adapter_id,
    relationship: row.relationship,
  }));
}

export function findConversationsMissingSync(
  db: Database,
): string[] {
  const rows = db
    .prepare(
      `SELECT c.id
       FROM conversations c
       WHERE NOT EXISTS (
         SELECT 1
         FROM _jin_sync s
         WHERE s.conversation_id = c.id
       )
       ORDER BY c.id ASC`,
    )
    .all() as Array<{ id: string }>;

  return rows.map((row) => row.id);
}

function countPushStateRows(
  db: Database,
  sinkId: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM _jin_push_state
       WHERE sink_id = ?`,
    )
    .get(sinkId) as { count?: number } | null;

  return row?.count ?? 0;
}
