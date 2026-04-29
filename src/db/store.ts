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
  ConversationWriteSession,
  ConversationStore,
  OrphanedConversation,
  RecordedPushResult,
} from "../contracts/store";
import { writeBundle as writeConversationBundle } from "./bundle";
import { beginConversationWriteSession } from "./write-session";
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
const DEFAULT_SQLITE_CACHE_SIZE_KIB = 4096;
const POISONED_LOCAL_STORE_SIGNATURES = [
  "readonly database",
  "unable to open database file",
  "sqlite_readonly",
  "sqlite_cantopen",
];
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
    this.database.exec(`PRAGMA cache_size = -${DEFAULT_SQLITE_CACHE_SIZE_KIB}`);
  }

  writeBundle(bundle: ConversationBundle) {
    return writeConversationBundle(this.database, bundle);
  }

  hasLocalData(): boolean {
    try {
      const row = this.database
        .prepare("SELECT 1 AS present FROM _jin_sync LIMIT 1")
        .get() as { present?: number } | undefined;
      return row?.present === 1;
    } catch {
      return false;
    }
  }

  beginWrite(
    conversation: ConversationBundle["conversation"],
  ): ConversationWriteSession {
    return beginConversationWriteSession(this.database, conversation);
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

export function isPoisonedLocalStoreError(error: unknown): boolean {
  return collectErrorTexts(error).some((text) => {
    const normalized = text.toLowerCase();
    return POISONED_LOCAL_STORE_SIGNATURES.some((signature) =>
      normalized.includes(signature),
    );
  });
}

export function formatPoisonedLocalStoreResetGuidance(
  configDir: string,
): string[] {
  const displayPath = formatCliPath(configDir);
  return [
    "Experimental v2 local state is unrecoverable after the previous shutdown.",
    `Run \`jin stop || true\`, remove ${displayPath}, and restart jin.`,
    "Jin will not repair or delete the SQLite files automatically.",
  ];
}

export function printPoisonedLocalStoreResetGuidance(configDir: string): void {
  for (const line of formatPoisonedLocalStoreResetGuidance(configDir)) {
    console.error(`  ${line}`);
  }
}

function collectErrorTexts(error: unknown, seen = new Set<unknown>()): string[] {
  if (error === null || error === undefined) {
    return [];
  }

  if (typeof error === "string") {
    return [error];
  }

  if (typeof error !== "object") {
    return [String(error)];
  }

  if (seen.has(error)) {
    return [];
  }
  seen.add(error);

  const texts: string[] = [];
  const maybeError = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: unknown;
    errors?: unknown;
  };

  for (const value of [maybeError.name, maybeError.message, maybeError.code]) {
    if (typeof value === "string" || typeof value === "number") {
      texts.push(String(value));
    }
  }

  if (Array.isArray(maybeError.errors)) {
    for (const nested of maybeError.errors) {
      texts.push(...collectErrorTexts(nested, seen));
    }
  }

  if (maybeError.cause !== undefined) {
    texts.push(...collectErrorTexts(maybeError.cause, seen));
  }

  return texts;
}

function formatCliPath(pathValue: string): string {
  const resolvedPath = resolve(pathValue);
  const home = process.env.HOME;

  if (!home) {
    return resolvedPath;
  }

  const resolvedHome = resolve(home);
  if (resolvedPath === resolvedHome) {
    return "~";
  }

  if (resolvedPath.startsWith(`${resolvedHome}/`)) {
    return `~${resolvedPath.slice(resolvedHome.length)}`;
  }

  return resolvedPath;
}
