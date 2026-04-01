import { createHash } from "crypto";
import type { Database } from "bun:sqlite";
import type {
  ConversationBundle,
  ParsedConversation,
  ParsedMessage,
  ParsedToolCall,
} from "../contracts/conversations";
import type { WriteBundleResult } from "../contracts/store";
import {
  recomputeConversationDerivedFields,
  upsertConversation,
} from "./conversations";
import {
  deleteMessagesForConversation,
  getMessageFtsRows,
  insertMessage,
} from "./messages";
import { refreshConversationFts } from "./search";
import {
  getSyncState,
  updateSyncIngestedAt,
  upsertSyncState,
} from "./sync";
import {
  deleteToolCallsForConversation,
  insertToolCall,
} from "./tool-calls";

export function computeBundleHash(bundle: ConversationBundle): string {
  const canonicalConversation = {
    id: bundle.conversation.id,
    traceId: bundle.conversation.traceId,
    parentId: bundle.conversation.parentId,
    relationship: bundle.conversation.relationship,
    forkPoint: bundle.conversation.forkPoint,
    adapterId: bundle.conversation.adapterId,
    name: bundle.conversation.name,
    cwd: bundle.conversation.cwd,
    gitRemote: bundle.conversation.gitRemote,
    branch: bundle.conversation.branch,
    model: bundle.conversation.model,
    startedAt: bundle.conversation.startedAt,
    endedAt: bundle.conversation.endedAt,
    sourcePath: bundle.conversation.sourcePath,
    sourceFormat: bundle.conversation.sourceFormat,
  } satisfies ParsedConversation;

  const canonicalMessages = [...bundle.messages]
    .sort((left, right) => left.sequence - right.sequence)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      recordType: message.recordType,
      model: message.model,
      sequence: message.sequence,
      turn: message.turn,
      isSidechain: message.isSidechain,
      parentMessageId: message.parentMessageId,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      cacheRead: message.cacheRead,
      cacheWrite: message.cacheWrite,
      thinkingContent: message.thinkingContent,
      thinkingTokens: message.thinkingTokens,
      timestamp: message.timestamp,
      toolUses: [...message.toolUses]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
          output: toolCall.output,
          isError: toolCall.isError,
          durationMs: toolCall.durationMs,
          timestamp: toolCall.timestamp,
        } satisfies ParsedToolCall)),
    } satisfies ParsedMessage));

  return createHash("sha256")
    .update(
      JSON.stringify({
        conversation: canonicalConversation,
        messages: canonicalMessages,
      } satisfies ConversationBundle),
    )
    .digest("hex");
}

export function writeBundle(
  db: Database,
  bundle: ConversationBundle,
): WriteBundleResult {
  const write = db.transaction((input: ConversationBundle) => {
    const conversationId = input.conversation.id;
    const nextHash = computeBundleHash(input);
    const previousSync = getSyncState(db, conversationId);
    const ingestedAt = new Date().toISOString();

    if (previousSync && previousSync.bundleHash === nextHash) {
      updateSyncIngestedAt(db, conversationId, ingestedAt);
      return {
        changed: false,
        revision: previousSync.localRevision,
      };
    }

    upsertConversation(db, input.conversation);

    const previousMessageRows = getMessageFtsRows(db, conversationId);
    deleteToolCallsForConversation(db, conversationId);
    deleteMessagesForConversation(db, conversationId);

    for (const message of sortMessages(input.messages)) {
      insertMessage(db, conversationId, message);

      for (const toolCall of sortToolCalls(message.toolUses)) {
        insertToolCall(db, conversationId, message.id, toolCall);
      }
    }

    refreshConversationFts(db, conversationId, previousMessageRows);
    recomputeConversationDerivedFields(db, conversationId);

    const revision = previousSync ? previousSync.localRevision + 1 : 1;
    upsertSyncState(db, {
      conversationId,
      bundleHash: nextHash,
      localRevision: revision,
      ingestedAt,
    });

    return {
      changed: true,
      revision,
    };
  });

  return write(bundle);
}

function sortMessages(messages: ConversationBundle["messages"]): ParsedMessage[] {
  return [...messages].sort((left, right) => left.sequence - right.sequence);
}

function sortToolCalls(toolCalls: ParsedToolCall[]): ParsedToolCall[] {
  return [...toolCalls].sort((left, right) => left.id.localeCompare(right.id));
}
