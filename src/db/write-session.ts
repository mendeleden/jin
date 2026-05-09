import type { Database } from "bun:sqlite";
import type {
  ParsedConversation,
  ParsedMessage,
  ParsedToolCall,
} from "../contracts/conversations";
import type {
  ConversationWriteSession,
  SyncStateRecord,
  WriteBundleResult,
} from "../contracts/store";
import { estimateCost } from "../pricing";
import {
  STAGED_MESSAGE_COPY_ORDER_BY,
  STAGED_TOOL_CALL_COPY_ORDER_BY,
  orderedToolCalls,
} from "./ordering";
import {
  persistConversationDerivedFields,
  upsertConversation,
} from "./conversations";
import { getMessageFtsRows } from "./messages";
import { refreshConversationFts } from "./search";
import {
  getSyncState,
  updateSyncIngestedAt,
  upsertSyncState,
} from "./sync";
import { allRows, runInTransaction } from "./statements";

type DerivedAccumulator = {
  messageCount: number;
  toolCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  estCost: number;
  stagedBytes: number;
};

type SessionState = "active" | "failed" | "finished" | "aborted";

const MB = 1024 * 1024;
const MAX_STAGED_WRITE_SESSION_BYTES = 256 * MB;
const STAGED_WRITE_WARNING_BYTES = 100 * 1024 * 1024;
const STAGED_WRITE_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

export function beginConversationWriteSession(
  db: Database,
  conversation: ParsedConversation,
): ConversationWriteSession {
  return new StagedConversationWriteSession(db, conversation);
}

export function abortConversationWriteSession(
  session: ConversationWriteSession | null,
  context: string,
): void {
  if (!session) {
    return;
  }

  try {
    session.abort();
  } catch (error) {
    console.error(`Failed to abort ${context}:`, error);
  }
}

class StagedConversationWriteSession implements ConversationWriteSession {
  private readonly db: Database;
  private readonly sessionId: string;
  private readonly conversation: ParsedConversation;
  private readonly derived: DerivedAccumulator;
  private readonly baselineSync: SyncStateRecord | null;
  private state: SessionState = "active";
  private warned = false;

  constructor(db: Database, conversation: ParsedConversation) {
    this.db = db;
    this.sessionId = crypto.randomUUID();
    this.conversation = conversation;
    const stagedBytes = estimateConversationBytes(conversation);
    if (stagedBytes > MAX_STAGED_WRITE_SESSION_BYTES) {
      throw new Error(
        `conversation write session for ${conversation.id} exceeded staged safety limit (${formatMegabytes(stagedBytes)} MB > ${formatMegabytes(MAX_STAGED_WRITE_SESSION_BYTES)} MB)`,
      );
    }
    this.derived = {
      messageCount: 0,
      toolCount: 0,
      turnCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      estCost: 0,
      stagedBytes,
    };
    this.baselineSync = getSyncState(db, conversation.id);

    initializeStagedSession(
      db,
      this.sessionId,
      conversation.id,
      this.derived.stagedBytes,
    );
  }

  appendMessage(message: ParsedMessage): void {
    this.assertActive();

    const messageBytes = estimateMessageBytes(message);
    const nextStagedBytes = this.derived.stagedBytes + messageBytes;
    if (nextStagedBytes > MAX_STAGED_WRITE_SESSION_BYTES) {
      this.state = "failed";
      throw new Error(
        `conversation write session for ${this.conversation.id} exceeded staged safety limit (${formatMegabytes(nextStagedBytes)} MB > ${formatMegabytes(MAX_STAGED_WRITE_SESSION_BYTES)} MB)`,
      );
    }

    try {
      runInTransaction(this.db, () => {
        stageMessage(this.db, this.sessionId, this.conversation.id, message);
        for (const toolCall of orderedToolCalls(message.toolUses)) {
          stageToolCall(
            this.db,
            this.sessionId,
            this.conversation.id,
            message.id,
            toolCall,
          );
        }
        updateStageSessionBytes(this.db, this.sessionId, nextStagedBytes);
      });
    } catch (error) {
      this.state = "failed";
      throw error;
    }

    this.derived.messageCount += 1;
    this.derived.toolCount += message.toolUses.length;
    this.derived.turnCount = Math.max(this.derived.turnCount, message.turn);
    this.derived.inputTokens += message.inputTokens;
    this.derived.outputTokens += message.outputTokens;
    this.derived.cacheRead += message.cacheRead;
    this.derived.cacheWrite += message.cacheWrite;
    this.derived.estCost += estimateCost(
      message.model || this.conversation.model,
      message.inputTokens,
      message.outputTokens,
      message.cacheRead,
      message.cacheWrite,
    );
    this.derived.stagedBytes = nextStagedBytes;

    if (!this.warned && this.derived.stagedBytes >= STAGED_WRITE_WARNING_BYTES) {
      this.warned = true;
      console.error(
        `[jin] staged write session ${this.conversation.id} exceeded ${Math.round(
          STAGED_WRITE_WARNING_BYTES / (1024 * 1024),
        )} MB; continuing with disk-backed staging`,
      );
    }
  }

  finish(bundleHash: string): WriteBundleResult {
    this.assertActive();

    try {
      const result = applyStagedConversationWrite(
        this.db,
        this.sessionId,
        this.conversation,
        this.derived,
        this.baselineSync,
        bundleHash,
      );
      this.state = "finished";
      return result;
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }

  abort(): void {
    if (this.state === "finished" || this.state === "aborted") {
      return;
    }

    runInTransaction(this.db, () => {
      clearStagedSession(this.db, this.sessionId);
    });
    this.state = "aborted";
  }

  private assertActive(): void {
    if (this.state !== "active") {
      throw new Error("conversation write session is no longer active");
    }
  }
}

function initializeStagedSession(
  db: Database,
  sessionId: string,
  conversationId: string,
  stagedBytes: number,
): void {
  const now = new Date().toISOString();
  const expiredBefore = new Date(
    Date.now() - STAGED_WRITE_ROW_RETENTION_MS,
  ).toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    clearExpiredStagedSessions(db, expiredBefore);
    db.run(
      `INSERT INTO _jin_stage_sessions (
        session_id,
        conversation_id,
        created_at,
        staged_bytes
      ) VALUES (?, ?, ?, ?)`,
      [sessionId, conversationId, now, stagedBytes],
    );
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Best-effort rollback for staging initialization.
    }
    throw error;
  }
}

function applyStagedConversationWrite(
  db: Database,
  sessionId: string,
  conversation: ParsedConversation,
  derived: DerivedAccumulator,
  baselineSync: SyncStateRecord | null,
  bundleHash: string,
): WriteBundleResult {
  const ingestedAt = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");

  try {
    const previousSync = getSyncState(db, conversation.id);
    const previousRevision = previousSync?.localRevision ?? 0;
    if (previousSync?.bundleHash === bundleHash) {
      clearStagedSession(db, sessionId);
      updateSyncIngestedAt(db, conversation.id, ingestedAt);
      db.exec("COMMIT");
      return {
        changed: false,
        revision: previousRevision,
      };
    }

    if (!sameSyncState(previousSync, baselineSync)) {
      clearStagedSession(db, sessionId);
      db.exec("COMMIT");
      return {
        changed: false,
        revision: previousRevision,
      };
    }

    upsertConversation(db, conversation);
    const previousRows = getMessageFtsRows(db, conversation.id);
    db.run("DELETE FROM tool_calls WHERE conversation_id = ?", [conversation.id]);
    db.run("DELETE FROM messages WHERE conversation_id = ?", [conversation.id]);

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
      )
      SELECT
        message_id,
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
      FROM _jin_stage_messages
      WHERE session_id = ?
      ORDER BY ${STAGED_MESSAGE_COPY_ORDER_BY}`,
      [sessionId],
    );

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
      )
      SELECT
        conversation_id,
        message_id,
        id,
        name,
        input,
        output,
        is_error,
        duration_ms,
      timestamp
      FROM _jin_stage_tool_calls
      WHERE session_id = ?
      ORDER BY ${STAGED_TOOL_CALL_COPY_ORDER_BY}`,
      [sessionId],
    );

    refreshConversationFts(db, conversation.id, previousRows);
    persistConversationDerivedFields(db, conversation.id, {
      durationMs: deriveDurationMs(conversation.startedAt, conversation.endedAt),
      messageCount: derived.messageCount,
      toolCount: derived.toolCount,
      turnCount: derived.turnCount,
      inputTokens: derived.inputTokens,
      outputTokens: derived.outputTokens,
      cacheRead: derived.cacheRead,
      cacheWrite: derived.cacheWrite,
      estCost: derived.estCost,
    });

    const revision = previousRevision + 1;
    upsertSyncState(db, {
      conversationId: conversation.id,
      bundleHash,
      localRevision: revision,
      ingestedAt,
    });
    clearStagedSession(db, sessionId);
    db.exec("COMMIT");
    return {
      changed: true,
      revision,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Best-effort rollback so partial writes do not leak rows.
    }
    throw error;
  }
}

function stageMessage(
  db: Database,
  sessionId: string,
  conversationId: string,
  message: ParsedMessage,
): void {
  db.run(
    `INSERT INTO _jin_stage_messages (
      session_id,
      message_id,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
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

function stageToolCall(
  db: Database,
  sessionId: string,
  conversationId: string,
  messageId: string,
  toolCall: ParsedToolCall,
): void {
  db.run(
    `INSERT INTO _jin_stage_tool_calls (
      session_id,
      conversation_id,
      message_id,
      id,
      name,
      input,
      output,
      is_error,
      duration_ms,
      timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
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

function updateStageSessionBytes(
  db: Database,
  sessionId: string,
  stagedBytes: number,
): void {
  db.run(
    `UPDATE _jin_stage_sessions
     SET staged_bytes = ?
     WHERE session_id = ?`,
    [stagedBytes, sessionId],
  );
}

function clearExpiredStagedSessions(db: Database, expiredBefore: string): void {
  const expired = allRows<{ session_id: string }>(
    db,
    `SELECT session_id
     FROM _jin_stage_sessions
     WHERE created_at < ?`,
    expiredBefore,
  );

  for (const row of expired) {
    clearStagedSession(db, row.session_id);
  }
}

function clearStagedSession(db: Database, sessionId: string): void {
  db.run("DELETE FROM _jin_stage_tool_calls WHERE session_id = ?", [sessionId]);
  db.run("DELETE FROM _jin_stage_messages WHERE session_id = ?", [sessionId]);
  db.run("DELETE FROM _jin_stage_sessions WHERE session_id = ?", [sessionId]);
}

function deriveDurationMs(startedAt: string, endedAt: string): number {
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

function sameSyncState(
  left: SyncStateRecord | null,
  right: SyncStateRecord | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.conversationId === right.conversationId &&
    left.bundleHash === right.bundleHash &&
    left.localRevision === right.localRevision
  );
}

function estimateMessageBytes(message: ParsedMessage): number {
  let total =
    256 +
    byteLength(message.id) +
    byteLength(message.role) +
    byteLength(message.content) +
    byteLength(message.recordType) +
    byteLength(message.model) +
    byteLength(message.parentMessageId) +
    byteLength(message.thinkingContent) +
    byteLength(message.timestamp) +
    8 * 8;

  for (const toolCall of message.toolUses) {
    total +=
      128 +
      byteLength(toolCall.id) +
      byteLength(toolCall.name) +
      byteLength(toolCall.input) +
      byteLength(toolCall.output) +
      byteLength(toolCall.timestamp) +
      4 * 8;
  }

  return total;
}

function estimateConversationBytes(conversation: ParsedConversation): number {
  return (
    256 +
    byteLength(conversation.id) +
    byteLength(conversation.traceId) +
    byteLength(conversation.parentId) +
    byteLength(conversation.relationship) +
    byteLength(conversation.adapterId) +
    byteLength(conversation.name) +
    byteLength(conversation.cwd) +
    byteLength(conversation.gitRemote) +
    byteLength(conversation.branch) +
    byteLength(conversation.model) +
    byteLength(conversation.startedAt) +
    byteLength(conversation.endedAt) +
    byteLength(conversation.sourcePath) +
    byteLength(conversation.sourceFormat)
  );
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function formatMegabytes(bytes: number): number {
  return Math.round((bytes / MB) * 10) / 10;
}
