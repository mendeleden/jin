import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
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

interface FileSnapshot {
  size: number;
  mtimeMs: number;
}

interface GitInfo {
  remote: string;
  branch: string;
}

export class GeminiCliAdapter implements Adapter, V2Adapter {
  id = "gemini-cli";
  name = "Gemini CLI";
  icon = "✦";

  private readonly baseDir: string;
  private readonly statCache = new Map<string, FileSnapshot>();
  private readonly gitCache = new Map<string, GitInfo>();

  constructor(baseDir = join(homedir(), ".gemini")) {
    this.baseDir = baseDir;
  }

  async detect(): Promise<boolean> {
    return this.findSessionFiles().length > 0;
  }

  async findChanged(hint?: ChangeHint): Promise<ConversationRef[]> {
    const files = this.findSessionFiles();
    const currentFiles = new Set(files);

    for (const cachedPath of Array.from(this.statCache.keys())) {
      if (!currentFiles.has(cachedPath)) {
        this.statCache.delete(cachedPath);
      }
    }

    let targetFiles = files;
    if (hint?.kind === "periodic-scan") {
      targetFiles = files.filter((filePath) => this.hasFileChanged(filePath));
    } else if (hint?.kind === "fs-change" && hint.changedPaths && hint.changedPaths.length > 0) {
      targetFiles = files.filter((filePath) => matchesChangedPaths(filePath, hint.changedPaths ?? []));
    }

    const refs: ConversationRef[] = [];
    for (const filePath of targetFiles) {
      this.updateSnapshot(filePath);
      const ref = this.buildRef(filePath);
      if (ref) {
        refs.push(ref);
      }
    }

    return refs;
  }

  async loadConversation(ref: ConversationRef): Promise<ConversationBundle | null> {
    if (!existsSync(ref.sourcePath)) {
      return null;
    }

    const bundle = this.parseConversation(ref.sourcePath);
    if (!bundle || bundle.conversation.id !== ref.id) {
      return null;
    }

    return bundle;
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
    const ref = sourcePath ? this.findRefInFile(sessionId, sourcePath) : this.findRef(sessionId);
    if (!ref) {
      return [];
    }

    const bundle = await this.loadConversation(ref);
    if (!bundle) {
      return [];
    }

    return bundle.messages.map((message) => this.toLegacyMessage(message));
  }

  watchPaths(): string[] {
    const paths = [join(this.baseDir, "tmp"), this.baseDir].filter((path, index, all) =>
      existsSync(path) && all.indexOf(path) === index,
    );
    return paths;
  }

  private findSessionFiles(): string[] {
    const files = new Set<string>();
    const tmpDir = join(this.baseDir, "tmp");

    if (existsSync(tmpDir)) {
      this.walkForSessions(tmpDir, files, 0);
    }

    if (existsSync(this.baseDir)) {
      for (const entry of readdirSync(this.baseDir)) {
        if (entry.startsWith("session-") && entry.endsWith(".json")) {
          files.add(join(this.baseDir, entry));
        }
      }
    }

    return Array.from(files).sort();
  }

  private walkForSessions(dir: string, out: Set<string>, depth: number): void {
    if (depth > 4) {
      return;
    }

    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          this.walkForSessions(fullPath, out, depth + 1);
        } else if (entry.name.startsWith("session-") && entry.name.endsWith(".json")) {
          out.add(fullPath);
        }
      }
    } catch {}
  }

  private findRef(sessionId: string): ConversationRef | null {
    for (const filePath of this.findSessionFiles()) {
      const ref = this.findRefInFile(sessionId, filePath);
      if (ref) {
        return ref;
      }
    }
    return null;
  }

  private findRefInFile(sessionId: string, sourcePath: string): ConversationRef | null {
    const ref = this.buildRef(sourcePath);
    return ref?.id === sessionId ? ref : null;
  }

  private buildRef(filePath: string): ConversationRef | null {
    const bundle = this.parseConversation(filePath);
    if (!bundle) {
      return null;
    }

    return {
      id: bundle.conversation.id,
      sourcePath: filePath,
      adapterId: this.id,
    };
  }

  private parseConversation(filePath: string): ConversationBundle | null {
    const data = readJson(filePath);
    if (!data) {
      return null;
    }

    const fallbackTimestamp = normalizeTimestamp(
      asString(data.startTime) || asString(data.lastUpdated),
      fileTimestamp(filePath),
    );
    const conversationId = asString(data.sessionId) || basename(filePath, ".json");
    const cwd =
      asString(data.cwd) ||
      asString(data.workingDirectory) ||
      asString(data.workspacePath) ||
      asString(data.projectPath);
    const turns = Array.isArray(data.turns)
      ? data.turns
      : Array.isArray(data.messages)
        ? data.messages
        : Array.isArray(data.conversation)
          ? data.conversation
          : [];

    const messages: ParsedMessage[] = [];
    let currentTurn = -1;
    let startedAt = fallbackTimestamp;
    let endedAt = normalizeTimestamp(asString(data.lastUpdated), fallbackTimestamp);
    let firstUserMessage = "";
    const modelCounts = new Map<string, number>();

    for (let index = 0; index < turns.length; index += 1) {
      const turn = asObject(turns[index]);
      if (!turn) {
        continue;
      }

      const role = normalizeGeminiRole(asString(turn.role) || asString(turn.type));
      if (!role) {
        continue;
      }

      const timestamp = normalizeTimestamp(
        asString(turn.timestamp) || asString(turn.createTime),
        fallbackTimestamp,
      );
      const content = flattenGeminiContent(turn);
      const model = asString(turn.model) || asString(data.model);
      const messageId =
        asString(turn.id) ||
        stableHash(conversationId, role, timestamp, `${index}`);

      currentTurn = nextTurnNumber(currentTurn, role);
      if (role === "user" && !firstUserMessage && content.trim()) {
        firstUserMessage = content.trim();
      }
      if (model) {
        modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
      }

      messages.push({
        id: messageId,
        role,
        content,
        recordType: asString(turn.type) || asString(turn.role),
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

      if (Date.parse(timestamp) < Date.parse(startedAt)) {
        startedAt = timestamp;
      }
      if (Date.parse(timestamp) > Date.parse(endedAt)) {
        endedAt = timestamp;
      }
    }

    if (messages.length === 0) {
      return null;
    }

    const git = this.resolveGit(cwd);

    return {
      conversation: {
        id: conversationId,
        traceId: conversationId,
        parentId: "",
        relationship: "root",
        forkPoint: -1,
        adapterId: this.id,
        name: formatConversationName(firstUserMessage, conversationId),
        cwd,
        gitRemote: git.remote,
        branch: git.branch,
        model: primaryModel(modelCounts),
        startedAt,
        endedAt,
        sourcePath: filePath,
        sourceFormat: "json",
      },
      messages,
    };
  }

  private hasFileChanged(filePath: string): boolean {
    try {
      const stats = statSync(filePath);
      const previous = this.statCache.get(filePath);
      if (!previous) {
        return true;
      }
      return previous.size !== stats.size || previous.mtimeMs !== stats.mtimeMs;
    } catch {
      return false;
    }
  }

  private updateSnapshot(filePath: string): void {
    try {
      const stats = statSync(filePath);
      this.statCache.set(filePath, { size: stats.size, mtimeMs: stats.mtimeMs });
    } catch {
      this.statCache.delete(filePath);
    }
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

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
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

function normalizeGeminiRole(value: string): ParsedMessage["role"] | null {
  if (value === "user") {
    return "user";
  }
  if (value === "model" || value === "assistant") {
    return "assistant";
  }
  if (value === "system") {
    return "system";
  }
  return null;
}

function nextTurnNumber(currentTurn: number, role: ParsedMessage["role"]): number {
  if (role === "user") {
    return currentTurn + 1;
  }
  return currentTurn < 0 ? 0 : currentTurn;
}

function flattenGeminiContent(turn: Record<string, unknown>): string {
  if (typeof turn.content === "string") {
    return turn.content;
  }
  if (Array.isArray(turn.content)) {
    return turn.content
      .map((entry) => asString(asObject(entry)?.text))
      .filter(Boolean)
      .join("\n\n");
  }
  if (Array.isArray(turn.parts)) {
    return turn.parts
      .map((entry) => asString(asObject(entry)?.text))
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof turn.text === "string") {
    return turn.text;
  }
  return "";
}

function formatConversationName(firstUserMessage: string, conversationId: string): string {
  const candidate = firstUserMessage.replace(/\s+/g, " ").trim();
  return candidate.slice(0, 120) || conversationId;
}

function primaryModel(modelCounts: Map<string, number>): string {
  let selected = "";
  let maxCount = 0;

  for (const [model, count] of Array.from(modelCounts.entries())) {
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

function asObject(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableHash(...parts: string[]): string {
  return createHash("sha1")
    .update(parts.join("\u241f"))
    .digest("hex");
}
