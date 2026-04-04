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

export class PiAgentAdapter implements Adapter, V2Adapter {
  id = "piagent";
  name = "PiAgent";
  icon = "Π";

  private readonly sessionsDir: string;
  private readonly statCache = new Map<string, FileSnapshot>();
  private readonly gitCache = new Map<string, GitInfo>();

  constructor(sessionsDir = join(homedir(), ".pi", "agent", "sessions")) {
    this.sessionsDir = sessionsDir;
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
    return existsSync(this.sessionsDir) ? [this.sessionsDir] : [];
  }

  private findSessionFiles(): string[] {
    if (!existsSync(this.sessionsDir)) {
      return [];
    }

    return readdirSync(this.sessionsDir)
      .filter((fileName) => fileName.endsWith(".jsonl"))
      .sort()
      .map((fileName) => join(this.sessionsDir, fileName));
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
    const records = readJsonl(filePath);
    if (records.length === 0) {
      return null;
    }

    const fallbackTimestamp = fileTimestamp(filePath);
    let conversationId = basename(filePath, ".jsonl");
    let cwd = "";

    for (const record of records) {
      conversationId = asString(record.session_id) || conversationId;
      cwd = asString(record.cwd) || cwd;
    }

    const messages: ParsedMessage[] = [];
    let currentTurn = -1;
    let startedAt = fallbackTimestamp;
    let endedAt = fallbackTimestamp;
    let firstUserMessage = "";
    const modelCounts = new Map<string, number>();

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const role = normalizeRole(asString(record.role) || asString(record.type));
      if (!role) {
        continue;
      }

      const timestamp = normalizeTimestamp(asString(record.timestamp), fallbackTimestamp);
      const content = flattenContent(record.content ?? asObject(record.message)?.content);
      const model = asString(record.model) || asString(asObject(record.message)?.model);
      const usage = asObject(record.usage);
      const messageId =
        asString(record.uuid) ||
        asString(record.id) ||
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
        recordType: asString(record.type) || asString(record.role),
        model,
        sequence: messages.length,
        turn: currentTurn,
        isSidechain: false,
        parentMessageId: "",
        inputTokens: asNumber(usage?.input_tokens) ?? 0,
        outputTokens: asNumber(usage?.output_tokens) ?? 0,
        cacheRead: asNumber(usage?.cache_read_input_tokens) ?? 0,
        cacheWrite: asNumber(usage?.cache_creation_input_tokens) ?? 0,
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
        sourceFormat: "jsonl",
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
      })
        .toString()
        .trim();
      const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
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
    return value.map((entry) => flattenContent(entry)).filter(Boolean).join("\n\n");
  }
  if (isObject(value)) {
    if (typeof value.content === "string") {
      return value.content;
    }
    if (Array.isArray(value.content)) {
      return flattenContent(value.content);
    }
    if (typeof value.text === "string") {
      return value.text;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableHash(...parts: string[]): string {
  return createHash("sha1")
    .update(parts.join("\u241f"))
    .digest("hex");
}
