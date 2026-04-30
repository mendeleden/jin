import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { Database } from "bun:sqlite";
import { existsSync, statSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import type {
  Adapter,
  ChangeHint,
  ConversationBundle,
  ConversationRef,
  Message,
  ParsedMessage,
  Session,
  ThinkingBlock,
  ToolUse,
  V2Adapter,
} from "./types";

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";
const SESSION_TABLE_CANDIDATES = ["conversations", "sessions", "chats"] as const;
const MESSAGE_TABLE_CANDIDATES = ["messages", "turns", "chat_messages"] as const;
const MESSAGE_KEY_CANDIDATES = ["conversation_id", "session_id", "chat_id"] as const;

interface GitInfo {
  remote: string;
  branch: string;
}

interface KiroLocator {
  refId: string;
  lookupValues: string[];
  name: string;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  model: string;
  messageCount: number;
  signature: string;
  messagesTable: string;
}

function findKiroDb(): string {
  const home = homedir();
  const candidates: string[] = [
    join(home, ".kiro", "data.sqlite3"),
  ];

  if (platform() === "darwin") {
    candidates.push(join(home, "Library", "Application Support", "kiro-cli", "data.sqlite3"));
  }
  if (platform() === "linux") {
    const xdgData = process.env.XDG_DATA_HOME || join(home, ".local", "share");
    candidates.push(join(xdgData, "kiro-cli", "data.sqlite3"));
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config");
    candidates.push(join(xdgConfig, "kiro-cli", "data.sqlite3"));
  }
  candidates.push(join(home, ".amazonq", "data.sqlite3"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] || "";
}

export class KiroAdapter implements Adapter, V2Adapter {
  id = "kiro";
  name = "Kiro";
  icon = "K";

  private readonly dbPath: string;
  private readonly signatureCache = new Map<string, string>();
  private readonly locatorCache = new Map<string, KiroLocator>();
  private readonly gitCache = new Map<string, GitInfo>();

  constructor(dbPath = findKiroDb()) {
    this.dbPath = dbPath;
  }

  async detect(): Promise<boolean> {
    return existsSync(this.dbPath);
  }

  async findChanged(hint?: ChangeHint): Promise<ConversationRef[]> {
    if (!existsSync(this.dbPath)) {
      return [];
    }

    let db: Database | null = null;
    try {
      db = new Database(this.dbPath, { readonly: true });
      const locators = this.listLocators(db);
      const activeIds = new Set(locators.map((locator) => locator.refId));

      for (const cachedId of Array.from(this.signatureCache.keys())) {
        if (!activeIds.has(cachedId)) {
          this.signatureCache.delete(cachedId);
          this.locatorCache.delete(cachedId);
        }
      }

      let changed = locators;
      if (hint?.kind === "periodic-scan") {
        changed = locators.filter((locator) => this.signatureCache.get(locator.refId) !== locator.signature);
      } else if (hint?.kind === "fs-change") {
        changed = hint.changedPaths && hint.changedPaths.length > 0 && matchesChangedPaths(this.dbPath, hint.changedPaths)
          ? locators
          : [];
      }

      for (const locator of locators) {
        this.signatureCache.set(locator.refId, locator.signature);
        this.locatorCache.set(locator.refId, locator);
      }

      return changed.map((locator) => ({
        id: locator.refId,
        sourcePath: this.dbPath,
        adapterId: this.id,
      }));
    } catch {
      return [];
    } finally {
      db?.close();
    }
  }

  async loadConversation(ref: ConversationRef): Promise<ConversationBundle | null> {
    if (!existsSync(ref.sourcePath)) {
      return null;
    }

    let db: Database | null = null;
    try {
      db = new Database(ref.sourcePath, { readonly: true });
      const locators = this.listLocators(db);
      const locator = locators.find((entry) => entry.refId === ref.id) ?? this.locatorCache.get(ref.id);
      if (!locator) {
        return null;
      }

      const messages = this.loadMessages(db, locator);
      const git = this.resolveGit(locator.cwd);
      const startedAt = messages[0]?.timestamp || locator.createdAt;
      const endedAt = messages[messages.length - 1]?.timestamp || locator.updatedAt;

      return {
        conversation: {
          id: locator.refId,
          traceId: locator.refId,
          parentId: "",
          relationship: "root",
          forkPoint: -1,
          adapterId: this.id,
          name: locator.name,
          cwd: locator.cwd,
          gitRemote: git.remote,
          branch: git.branch,
          model: primaryModel(messages) || locator.model,
          startedAt,
          endedAt,
          sourcePath: ref.sourcePath,
          sourceFormat: "sqlite",
        },
        messages,
      };
    } catch {
      return null;
    } finally {
      db?.close();
    }
  }

  async sessions(): Promise<Session[]> {
    const refs = await this.findChanged({ kind: "startup-scan" });
    const sessions: Session[] = [];

    for (const ref of refs) {
      const bundle = await this.loadConversation(ref);
      if (bundle) {
        sessions.push(this.toLegacySession(bundle));
      }
    }

    sessions.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return sessions;
  }

  async messages(sessionId: string, sourcePath?: string): Promise<Message[]> {
    const ref: ConversationRef = {
      id: sessionId,
      sourcePath: sourcePath || this.dbPath,
      adapterId: this.id,
    };

    const bundle = await this.loadConversation(ref);
    if (!bundle) {
      return [];
    }

    return bundle.messages.map((message) => this.toLegacyMessage(message));
  }

  watchPaths(): string[] {
    return existsSync(this.dbPath) ? [this.dbPath] : [];
  }

  private listLocators(db: Database): KiroLocator[] {
    const schema = this.discoverSchema(db);
    if (!schema.sessionsTable) {
      return [];
    }

    const fallbackTimestamp = fileTimestamp(this.dbPath);
    const rows = db
      .query(`SELECT rowid as _rowid, * FROM ${schema.sessionsTable} ORDER BY rowid ASC`)
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const rowId = String(asNumber(row._rowid) ?? 0);
      const lookupValues = Array.from(new Set([
        asString(row.id),
        asString(row.session_id),
        asString(row.conversation_id),
      ].filter(Boolean)));
      const createdAt = normalizeTimestamp(
        asString(row.created_at) || asString(row.createdAt),
        fallbackTimestamp,
      );
      const updatedAt = normalizeTimestamp(
        asString(row.updated_at) || asString(row.updatedAt),
        createdAt,
      );
      const refId =
        lookupValues[0] ||
        stableHash(this.id, schema.sessionsTable, rowId, createdAt, updatedAt, asString(row.title), asString(row.name));
      const name =
        asString(row.title) ||
        asString(row.name) ||
        refId.slice(0, 8);
      const messageCount = asNumber(row.message_count) ?? 0;

      return {
        refId,
        lookupValues,
        name,
        createdAt,
        updatedAt,
        cwd:
          asString(row.cwd) ||
          asString(row.working_directory) ||
          asString(row.workspace_path),
        model:
          asString(row.model) ||
          asString(row.model_name),
        messageCount,
        signature: `${updatedAt}|${messageCount}|${lookupValues.join(",")}`,
        messagesTable: schema.messagesTable,
      };
    });
  }

  private discoverSchema(db: Database): { sessionsTable: string; messagesTable: string } {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const names = new Set(tables.map((table) => table.name));

    return {
      sessionsTable: SESSION_TABLE_CANDIDATES.find((candidate) => names.has(candidate)) || "",
      messagesTable: MESSAGE_TABLE_CANDIDATES.find((candidate) => names.has(candidate)) || "",
    };
  }

  private loadMessages(db: Database, locator: KiroLocator): ParsedMessage[] {
    if (!locator.messagesTable || locator.lookupValues.length === 0) {
      return [];
    }

    let rows: Array<Record<string, unknown>> = [];
    for (const key of MESSAGE_KEY_CANDIDATES) {
      for (const value of locator.lookupValues) {
        try {
          const result = db
            .query(`SELECT rowid as _rowid, * FROM ${locator.messagesTable} WHERE ${key} = ? ORDER BY rowid ASC`)
            .all(value) as Array<Record<string, unknown>>;
          if (result.length > 0) {
            rows = result;
            break;
          }
        } catch {}
      }
      if (rows.length > 0) {
        break;
      }
    }

    const messages: ParsedMessage[] = [];
    let currentTurn = -1;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const role = normalizeSqlRole(asString(row.role));
      const timestamp = normalizeTimestamp(
        asString(row.created_at) || asString(row.createdAt) || asString(row.timestamp),
        locator.updatedAt,
      );
      const messageId =
        asString(row.id) ||
        asString(row.message_id) ||
        stableHash(locator.refId, role, timestamp, `${index}`);
      const model =
        asString(row.model) ||
        asString(row.model_name) ||
        locator.model;

      currentTurn = nextTurnNumber(currentTurn, role);
      messages.push({
        id: messageId,
        role,
        content:
          asString(row.content) ||
          asString(row.text) ||
          asString(row.body),
        recordType: "",
        model,
        sequence: messages.length,
        turn: currentTurn,
        isSidechain: false,
        parentMessageId: "",
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        thinkingContent: "",
        thinkingTokens: 0,
        timestamp,
        toolUses: [],
      });
    }

    return messages;
  }

  private resolveGit(cwd: string): GitInfo {
    if (!cwd) {
      return { remote: "", branch: "" };
    }

    const cached = this.gitCache.get(cwd);
    if (cached) {
      return cached;
    }

    try {
      const remote = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      })
        .toString()
        .trim();
      const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      })
        .toString()
        .trim();
      const resolved = { remote, branch };
      this.gitCache.set(cwd, resolved);
      return resolved;
    } catch {
      const resolved = { remote: "", branch: "" };
      this.gitCache.set(cwd, resolved);
      return resolved;
    }
  }

  private toLegacySession(bundle: ConversationBundle): Session {
    const totalTokens = bundle.messages.reduce(
      (sum, message) => sum + message.inputTokens + message.outputTokens,
      0,
    );

    return {
      id: bundle.conversation.id,
      name: bundle.conversation.name,
      adapterId: this.id,
      adapterName: this.name,
      createdAt: bundle.conversation.startedAt,
      updatedAt: bundle.conversation.endedAt,
      durationMs: Math.max(0, Date.parse(bundle.conversation.endedAt) - Date.parse(bundle.conversation.startedAt)),
      isActive: Date.now() - Date.parse(bundle.conversation.endedAt) < 5 * 60 * 1000,
      totalTokens,
      estCost: 0,
      messageCount: bundle.messages.length,
      sourcePath: bundle.conversation.sourcePath,
      isSubAgent: bundle.conversation.relationship === "spawned",
      parentSessionId: bundle.conversation.parentId,
      isCompacted: bundle.conversation.relationship === "compacted",
      metadata: {
        traceId: bundle.conversation.traceId,
        relationship: bundle.conversation.relationship,
        cwd: bundle.conversation.cwd,
      },
    };
  }

  private toLegacyMessage(message: ParsedMessage): Message {
    const thinkingBlocks: ThinkingBlock[] =
      message.thinkingContent || message.thinkingTokens > 0
        ? [{ content: message.thinkingContent, tokenCount: message.thinkingTokens }]
        : [];

    const toolUses: ToolUse[] = message.toolUses.map((tool) => ({
      id: tool.id,
      name: tool.name,
      input: tool.input,
      output: tool.output,
    }));

    return {
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      model: message.model,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      cacheRead: message.cacheRead,
      cacheWrite: message.cacheWrite,
      toolUses,
      thinkingBlocks,
      recordType: message.recordType,
    };
  }
}

function fileTimestamp(filePath: string): string {
  try {
    return statSync(filePath).mtime.toISOString();
  } catch {
    return EPOCH_ISO;
  }
}

function normalizeTimestamp(value: string, fallback: string): string {
  return value && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

function normalizeSqlRole(value: string): ParsedMessage["role"] {
  if (value === "user" || value === "assistant" || value === "system") {
    return value;
  }
  if (value === "human") {
    return "user";
  }
  return "assistant";
}

function nextTurnNumber(currentTurn: number, role: ParsedMessage["role"]): number {
  if (role === "user") {
    return currentTurn + 1;
  }
  return currentTurn < 0 ? 0 : currentTurn;
}

function primaryModel(messages: ParsedMessage[]): string {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (!message.model) {
      continue;
    }
    counts.set(message.model, (counts.get(message.model) ?? 0) + 1);
  }

  let selected = "";
  let maxCount = 0;
  for (const [model, count] of Array.from(counts.entries())) {
    if (count > maxCount) {
      selected = model;
      maxCount = count;
    }
  }

  return selected;
}

function matchesChangedPaths(filePath: string, changedPaths: string[]): boolean {
  return changedPaths.some((changedPath) =>
    filePath === changedPath ||
    filePath.startsWith(`${changedPath}/`) ||
    changedPath.startsWith(`${filePath}/`)
  );
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stableHash(...parts: string[]): string {
  return createHash("sha1")
    .update(parts.join("\u241f"))
    .digest("hex");
}
