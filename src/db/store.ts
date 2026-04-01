import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import type {
  Conversation,
  ConversationBundle,
  Message,
  ToolCall,
} from "../contracts/conversations";
import type {
  ConversationStore,
  OrphanedConversation,
  RecordedPushResult,
} from "../contracts/store";
import { writeBundle as writeConversationBundle } from "./bundle";
import { getConversation } from "./conversations";
import { getMessages } from "./messages";
import {
  type SearchMessageResult,
  type SearchMessagesOptions,
  searchMessages,
} from "./search";
import { getRevision, conversationsNeedingPush, findConversationsMissingSync, findOrphanedConversations, recordPushResult } from "./sync";
import { runMigrations } from "./schema";
import { getToolCalls } from "./tool-calls";

const STORE_FILENAME = "store.db";
const storeCache = new Map<string, SqliteConversationStore>();

export class SqliteConversationStore implements ConversationStore {
  readonly database: Database;
  readonly dbPath: string;

  constructor(dbPath: string) {
    const resolvedPath = resolve(dbPath);
    const directory = dirname(resolvedPath);

    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }

    this.dbPath = resolvedPath;
    this.database = new Database(resolvedPath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec("PRAGMA foreign_keys = ON");
    runMigrations(this.database);
  }

  writeBundle(bundle: ConversationBundle) {
    return writeConversationBundle(this.database, bundle);
  }

  getConversation(id: string): Conversation | null {
    return getConversation(this.database, id);
  }

  getMessages(conversationId: string): Message[] {
    return getMessages(this.database, conversationId);
  }

  getToolCalls(conversationId: string): ToolCall[] {
    return getToolCalls(this.database, conversationId);
  }

  getRevision(conversationId: string): number {
    return getRevision(this.database, conversationId);
  }

  conversationsNeedingPush(sinkId: string): string[] {
    return conversationsNeedingPush(this.database, sinkId);
  }

  recordPushResult(
    conversationId: string,
    sinkId: string,
    attemptedRevision: number,
    result: RecordedPushResult,
  ): void {
    recordPushResult(
      this.database,
      conversationId,
      sinkId,
      attemptedRevision,
      result,
    );
  }

  findOrphanedConversations(): OrphanedConversation[] {
    return findOrphanedConversations(this.database);
  }

  findConversationsMissingSync(): string[] {
    return findConversationsMissingSync(this.database);
  }

  searchMessages(options: SearchMessagesOptions): SearchMessageResult[] {
    return searchMessages(this.database, options);
  }

  close(): void {
    try {
      this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Best-effort checkpoint so temp test directories can be removed cleanly.
    }

    this.database.close();
    storeCache.delete(this.dbPath);
  }
}

export function openStoreAtPath(dbPath: string): SqliteConversationStore {
  return new SqliteConversationStore(dbPath);
}

export function getStore(configDir: string): SqliteConversationStore {
  const dbPath = resolve(join(configDir, STORE_FILENAME));
  const existing = storeCache.get(dbPath);

  if (existing) {
    return existing;
  }

  const store = new SqliteConversationStore(dbPath);
  storeCache.set(dbPath, store);
  return store;
}
