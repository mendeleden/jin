import { createHash, type Hash } from "crypto";
import type { Database } from "bun:sqlite";
import type {
  ConversationBundle,
  ParsedMessage,
  ParsedToolCall,
} from "../contracts/conversations";
import type { WriteBundleResult } from "../contracts/store";
import { orderedMessages, orderedToolCalls } from "./ordering";
import {
  abortConversationWriteSession,
  beginConversationWriteSession,
} from "./write-session";

export function computeBundleHash(bundle: ConversationBundle): string {
  const hash = createHash("sha256");
  const messages = orderedMessages(bundle.messages);

  hash.update("{");
  appendObjectProperty(hash, "conversation", () => {
    appendJsonObject(hash, (appendProperty) => {
      appendProperty("id", bundle.conversation.id);
      appendProperty("traceId", bundle.conversation.traceId);
      appendProperty("parentId", bundle.conversation.parentId);
      appendProperty("relationship", bundle.conversation.relationship);
      appendProperty("forkPoint", bundle.conversation.forkPoint);
      appendProperty("adapterId", bundle.conversation.adapterId);
      appendProperty("name", bundle.conversation.name);
      appendProperty("cwd", bundle.conversation.cwd);
      appendProperty("gitRemote", bundle.conversation.gitRemote);
      appendProperty("branch", bundle.conversation.branch);
      appendProperty("model", bundle.conversation.model);
      appendProperty("startedAt", bundle.conversation.startedAt);
      appendProperty("endedAt", bundle.conversation.endedAt);
      appendProperty("sourcePath", bundle.conversation.sourcePath);
      appendProperty("sourceFormat", bundle.conversation.sourceFormat);
    });
  });
  hash.update(",");
  appendObjectProperty(hash, "messages", () => {
    appendJsonArray(hash, messages, appendMessageHashEntry);
  });
  hash.update("}");

  return hash.digest("hex");
}

export function writeBundle(
  db: Database,
  bundle: ConversationBundle,
): WriteBundleResult {
  const session = beginConversationWriteSession(db, bundle.conversation);

  try {
    for (const message of orderedMessages(bundle.messages)) {
      session.appendMessage(message);
    }

    return session.finish(computeBundleHash(bundle));
  } catch (error) {
    abortConversationWriteSession(
      session,
      `store writeBundle(${bundle.conversation.id})`,
    );
    throw error;
  }
}

function appendMessageHashEntry(hash: Hash, message: ParsedMessage): void {
  appendJsonObject(hash, (appendProperty) => {
    appendProperty("id", message.id);
    appendProperty("role", message.role);
    appendProperty("content", message.content);
    appendProperty("recordType", message.recordType);
    appendProperty("model", message.model);
    appendProperty("sequence", message.sequence);
    appendProperty("turn", message.turn);
    appendProperty("isSidechain", message.isSidechain);
    appendProperty("parentMessageId", message.parentMessageId);
    appendProperty("inputTokens", message.inputTokens);
    appendProperty("outputTokens", message.outputTokens);
    appendProperty("cacheRead", message.cacheRead);
    appendProperty("cacheWrite", message.cacheWrite);
    appendProperty("thinkingContent", message.thinkingContent);
    appendProperty("thinkingTokens", message.thinkingTokens);
    appendProperty("timestamp", message.timestamp);
    appendProperty("toolUses", () => {
      appendJsonArray(hash, orderedToolCalls(message.toolUses), appendToolCallHashEntry);
    });
  });
}

function appendToolCallHashEntry(hash: Hash, toolCall: ParsedToolCall): void {
  appendJsonObject(hash, (appendProperty) => {
    appendProperty("id", toolCall.id);
    appendProperty("name", toolCall.name);
    appendProperty("input", toolCall.input);
    appendProperty("output", toolCall.output);
    appendProperty("isError", toolCall.isError);
    appendProperty("durationMs", toolCall.durationMs);
    appendProperty("timestamp", toolCall.timestamp);
  });
}

function appendJsonObject(
  hash: Hash,
  writeProperties: (
    appendProperty: (
      name: string,
      value: string | number | boolean | null | undefined | (() => void),
    ) => void,
  ) => void,
): void {
  let firstProperty = true;

  hash.update("{");
  writeProperties((name, value) => {
    if (value === undefined) {
      return;
    }

    if (!firstProperty) {
      hash.update(",");
    }
    firstProperty = false;
    appendObjectProperty(hash, name, value);
  });
  hash.update("}");
}

function appendJsonArray<T>(
  hash: Hash,
  values: ReadonlyArray<T>,
  appendValue: (hash: Hash, value: T) => void,
): void {
  hash.update("[");
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) {
      hash.update(",");
    }
    appendValue(hash, values[index]);
  }
  hash.update("]");
}

function appendObjectProperty(
  hash: Hash,
  name: string,
  value: string | number | boolean | null | (() => void),
): void {
  hash.update(JSON.stringify(name));
  hash.update(":");

  if (typeof value === "function") {
    value();
    return;
  }

  hash.update(JSON.stringify(value));
}
