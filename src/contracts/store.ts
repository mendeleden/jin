import type {
  Conversation,
  ConversationBundle,
  ConversationRelationship,
  Message,
  ParsedConversation,
  ParsedMessage,
  ToolCall,
} from "./conversations";

export interface WriteBundleResult {
  changed: boolean;
  revision: number;
}

export interface ConversationWriteSession {
  appendMessage(message: ParsedMessage): void;
  finish(bundleHash: string): WriteBundleResult;
  abort(): void;
}

export interface SyncStateRecord {
  conversationId: string;
  bundleHash: string;
  localRevision: number;
  ingestedAt: string;
}

export interface PushStateRecord {
  conversationId: string;
  sinkId: string;
  lastAttemptedRevision: number;
  lastSuccessfulRevision: number;
  lastAttemptedAt: string;
  lastSuccessfulAt: string;
  lastError: string;
}

export type RecordedPushResult =
  | { ok: true }
  | { ok: false; error: string };

export interface OrphanedConversation {
  id: string;
  parentId: string;
  adapterId: string;
  relationship: ConversationRelationship;
}

export interface ConversationStore {
  beginWrite(conversation: ParsedConversation): ConversationWriteSession;
  writeBundle(bundle: ConversationBundle): WriteBundleResult;
  getConversation(id: string): Conversation | null;
  getMessages(conversationId: string): Message[];
  getToolCalls(conversationId: string): ToolCall[];
  getRevision(conversationId: string): number;
  conversationsNeedingPush(sinkId: string): string[];
  recordPushResult(
    conversationId: string,
    sinkId: string,
    attemptedRevision: number,
    result: RecordedPushResult,
  ): void;
  findOrphanedConversations(): OrphanedConversation[];
  findConversationsMissingSync(): string[];
}
