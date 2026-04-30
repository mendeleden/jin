import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { basename, join } from "path";
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

interface GitInfo {
  remote: string;
  branch: string;
}

interface WarpLocator {
  refId: string;
  workingDirectory: string;
  createdAt: string;
  updatedAt: string;
  queryCount: number;
  signature: string;
}

function findWarpDb(): string {
  const home = homedir();
  const currentPlatform = platform();
  const candidates: string[] = [];

  if (currentPlatform === "darwin") {
    candidates.push(
      join(
        home,
        "Library",
        "Group Containers",
        "2BBY89MBSN.dev.warp",
        "Library",
        "Application Support",
        "dev.warp.Warp-Stable",
        "warp.sqlite",
      ),
    );
  }
  if (currentPlatform === "linux") {
    const xdgState = process.env.XDG_STATE_HOME || join(home, ".local", "state");
    candidates.push(join(xdgState, "warp-terminal", "warp.sqlite"));
  }
  if (currentPlatform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    candidates.push(join(localAppData, "warp", "Warp", "data", "warp.sqlite"));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] || "";
}

export class WarpAdapter implements Adapter, V2Adapter {
  id = "warp";
  name = "Warp Terminal";
  icon = "⌘";

  private readonly dbPath: string;
  private readonly signatureCache = new Map<string, string>();
  private readonly locatorCache = new Map<string, WarpLocator>();
  private readonly gitCache = new Map<string, GitInfo>();

  constructor(dbPath = findWarpDb()) {
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
      const git = this.resolveGit(locator.workingDirectory);
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
          name: basename(locator.workingDirectory) || "Warp Session",
          cwd: locator.workingDirectory,
          gitRemote: git.remote,
          branch: git.branch,
          model: primaryModel(messages),
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

  private listLocators(db: Database): WarpLocator[] {
    const rows = db.query(
      `SELECT
         COALESCE(working_directory, '') as working_directory,
         MIN(created_at) as first_at,
         MAX(created_at) as last_at,
         COUNT(*) as query_count
       FROM ai_queries
       GROUP BY COALESCE(working_directory, '')
       ORDER BY last_at DESC`,
    ).all() as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const workingDirectory = asString(row.working_directory);
      const createdAt = normalizeTimestamp(asString(row.first_at), EPOCH_ISO);
      const updatedAt = normalizeTimestamp(asString(row.last_at), createdAt);
      const queryCount = asNumber(row.query_count) ?? 0;
      const refId = stableHash(this.id, workingDirectory || "<empty-workdir>");

      return {
        refId,
        workingDirectory,
        createdAt,
        updatedAt,
        queryCount,
        signature: `${updatedAt}|${queryCount}`,
      };
    });
  }

  private loadMessages(db: Database, locator: WarpLocator): ParsedMessage[] {
    const rows = db.query(
      `SELECT query, response, created_at, model
       FROM ai_queries
       WHERE COALESCE(working_directory, '') = ?
       ORDER BY created_at ASC`,
    ).all(locator.workingDirectory) as Array<Record<string, unknown>>;

    const messages: ParsedMessage[] = [];
    let currentTurn = -1;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const timestamp = normalizeTimestamp(asString(row.created_at), locator.updatedAt);

      const query = stripAnsi(asString(row.query));
      if (query) {
        currentTurn = nextTurnNumber(currentTurn, "user");
        messages.push({
          id: stableHash(locator.refId, "query", timestamp, `${index}`),
          role: "user",
          content: query,
          recordType: "query",
          model: "",
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

      const response = stripAnsi(asString(row.response));
      if (response) {
        currentTurn = nextTurnNumber(currentTurn, "assistant");
        messages.push({
          id: stableHash(locator.refId, "response", timestamp, `${index}`),
          role: "assistant",
          content: response,
          recordType: "response",
          model: asString(row.model),
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

function normalizeTimestamp(value: string, fallback: string): string {
  return value && !Number.isNaN(Date.parse(value)) ? value : fallback;
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

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
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
