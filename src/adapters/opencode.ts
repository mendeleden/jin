import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
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

interface FileSnapshot {
  size: number;
  mtimeMs: number;
}

interface GitInfo {
  remote: string;
  branch: string;
}

function findStorageDir(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "opencode", "storage");
  }
  const xdgData = process.env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(xdgData, "opencode", "storage");
}

export class OpenCodeAdapter implements Adapter, V2Adapter {
  id = "opencode";
  name = "OpenCode";
  icon = "○";

  private readonly storageDir: string;
  private readonly statCache = new Map<string, FileSnapshot>();
  private readonly gitCache = new Map<string, GitInfo>();

  constructor(storageDir = findStorageDir()) {
    this.storageDir = storageDir;
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
    return [this.storageDir, join(this.storageDir, "sessions")].filter((path, index, all) =>
      existsSync(path) && all.indexOf(path) === index,
    );
  }

  private findSessionFiles(): string[] {
    const files = new Set<string>();
    for (const dir of [this.storageDir, join(this.storageDir, "sessions")]) {
      if (!existsSync(dir)) {
        continue;
      }
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        try {
          const stats = statSync(fullPath);
          if (stats.isFile() && (entry.endsWith(".json") || entry.endsWith(".jsonl"))) {
            files.add(fullPath);
          }
        } catch {}
      }
    }
    return Array.from(files).sort();
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
    return filePath.endsWith(".jsonl")
      ? this.parseJsonlConversation(filePath)
      : this.parseJsonConversation(filePath);
  }

  private parseJsonConversation(filePath: string): ConversationBundle | null {
    const data = readJson(filePath);
    if (!data) {
      return null;
    }

    const fallbackTimestamp = fileTimestamp(filePath);
    const conversationId =
      asString(data.sessionId) ||
      asString(data.id) ||
      basename(filePath, ".json");
    const cwd =
      asString(data.cwd) ||
      asString(data.workingDirectory) ||
      asString(data.workspacePath);
    const turns = Array.isArray(data.messages)
      ? data.messages
      : Array.isArray(data.turns)
        ? data.turns
        : Array.isArray(data.conversation)
          ? data.conversation
          : [];

    return buildRootBundle({
      adapterId: this.id,
      conversationId,
      cwd,
      fallbackTimestamp,
      sourcePath: filePath,
      sourceFormat: "json",
      turns,
      git: this.resolveGit(cwd),
    });
  }

  private parseJsonlConversation(filePath: string): ConversationBundle | null {
    const records = readJsonl(filePath);
    if (records.length === 0) {
      return null;
    }

    let conversationId = basename(filePath, ".jsonl");
    let cwd = "";
    for (const record of records) {
      conversationId =
        asString(record.session_id) ||
        asString(record.thread_id) ||
        asString(record.id) ||
        conversationId;
      cwd = asString(record.cwd) || cwd;
    }

    return buildRootBundle({
      adapterId: this.id,
      conversationId,
      cwd,
      fallbackTimestamp: fileTimestamp(filePath),
      sourcePath: filePath,
      sourceFormat: "jsonl",
      turns: records,
      git: this.resolveGit(cwd),
    });
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

function buildRootBundle(options: {
  adapterId: string;
  conversationId: string;
  cwd: string;
  fallbackTimestamp: string;
  sourcePath: string;
  sourceFormat: "json" | "jsonl";
  turns: unknown[];
  git: GitInfo;
}): ConversationBundle | null {
  const messages: ParsedMessage[] = [];
  let currentTurn = -1;
  let startedAt = options.fallbackTimestamp;
  let endedAt = options.fallbackTimestamp;
  let firstUserMessage = "";
  const modelCounts = new Map<string, number>();

  for (let index = 0; index < options.turns.length; index += 1) {
    const turn = asObject(options.turns[index]);
    if (!turn) {
      continue;
    }

    const role = normalizeRole(asString(turn.role) || asString(turn.type));
    if (!role) {
      continue;
    }

    const timestamp = normalizeTimestamp(
      asString(turn.timestamp) || asString(turn.created_at) || asString(turn.createTime),
      options.fallbackTimestamp,
    );
    const content = flattenContent(turn.content ?? turn.message ?? turn.text ?? turn.body ?? turn.parts);
    const model = asString(turn.model);
    const messageId =
      asString(turn.uuid) ||
      asString(turn.id) ||
      stableHash(options.conversationId, role, timestamp, `${index}`);

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

  return {
    conversation: {
      id: options.conversationId,
      traceId: options.conversationId,
      parentId: "",
      relationship: "root",
      forkPoint: -1,
      adapterId: options.adapterId,
      name: formatConversationName(firstUserMessage, options.conversationId),
      cwd: options.cwd,
      gitRemote: options.git.remote,
      branch: options.git.branch,
      model: primaryModel(modelCounts),
      startedAt,
      endedAt,
      sourcePath: options.sourcePath,
      sourceFormat: options.sourceFormat,
    },
    messages,
  };
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line);
          return isObject(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
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

function normalizeRole(value: string): ParsedMessage["role"] | null {
  if (value === "user" || value === "assistant" || value === "system") {
    return value;
  }
  return null;
}

function nextTurnNumber(currentTurn: number, role: ParsedMessage["role"]): number {
  if (role === "user") {
    return currentTurn + 1;
  }
  return currentTurn < 0 ? 0 : currentTurn;
}

function flattenContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => flattenContent(asObject(entry)?.text ?? asObject(entry)?.content ?? entry))
      .filter(Boolean)
      .join("\n\n");
  }
  if (isObject(value)) {
    if (typeof value.content === "string") {
      return value.content;
    }
    if (typeof value.text === "string") {
      return value.text;
    }
    if (Array.isArray(value.parts)) {
      return flattenContent(value.parts);
    }
  }
  return "";
}

function formatConversationName(firstUserMessage: string, conversationId: string): string {
  const candidate = firstUserMessage.replace(/\s+/g, " ").trim();
  return candidate.slice(0, 120) || conversationId.slice(0, 8);
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
