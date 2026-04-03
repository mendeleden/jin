import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join, resolve, sep } from "path";
import { homedir } from "os";
import { estimateCost } from "../pricing";
import type { Adapter as ContractAdapter, ChangeHint } from "../contracts/adapters";
import type {
  ConversationBundle,
  ConversationRef,
  ConversationRelationship,
  ParsedMessage,
  ParsedToolCall,
} from "../contracts/conversations";
import type {
  ArtifactKind,
  ContextArtifact,
  Message as LegacyMessage,
  Session,
  ThinkingBlock,
} from "./types";

interface ClaudeCodeAdapterOptions {
  projectsDir?: string;
  claudeDir?: string;
  now?: () => Date;
}

interface RawLine {
  type: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  slug?: string;
  cwd?: string;
  gitBranch?: string;
  summary?: string;
  leafUuid?: string;
  isSidechain?: boolean;
  compactMetadata?: {
    trigger?: string;
    preTokens?: number;
  };
  message?: {
    id?: string;
    role?: string;
    content?: unknown;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface ParsedRecord {
  lineIndex: number;
  raw: RawLine;
}

interface ParentLinkInfo {
  relationship: ConversationRelationship;
  traceId: string;
  parentId: string;
  forkPoint: number;
}

interface SegmentBuilder {
  id: string;
  traceId: string;
  parentId: string;
  relationship: ConversationRelationship;
  forkPoint: number;
  messages: ParsedMessage[];
  toolRefs: Map<string, ParsedToolCall>;
  sequence: number;
  turn: number;
  firstUserText: string;
  startedAt: string;
  endedAt: string;
  cwd: string;
  gitBranchHint: string;
  modelCounts: Map<string, number>;
}

interface FileModel {
  sessionId: string;
  sourcePath: string;
  refs: ConversationRef[];
  bundles: ConversationBundle[];
}

interface ParsedFileCacheEntry {
  size: number;
  mtimeMs: number;
  model: FileModel;
}

interface GitInfo {
  remote: string;
  branch: string;
}

const HOME = homedir();

function defaultProjectsDir(): string {
  const xdg = join(HOME, ".config", "claude", "projects");
  if (existsSync(xdg)) return xdg;
  const legacy = join(HOME, ".claude", "projects");
  if (existsSync(legacy)) return legacy;
  return xdg;
}

function stableHash(...parts: string[]): string {
  return createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 24);
}

function normalizeIso(timestamp?: string): string {
  if (!timestamp) return "";
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? timestamp : new Date(parsed).toISOString();
}

function summarizeText(text: string, fallback: string): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  if (!flattened) return fallback;
  return flattened.length > 120 ? `${flattened.slice(0, 117)}...` : flattened;
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return JSON.stringify(part);
    })
    .filter(Boolean)
    .join("\n");
}

function cloneBundle(bundle: ConversationBundle): ConversationBundle {
  return {
    conversation: { ...bundle.conversation },
    messages: bundle.messages.map((message) => ({
      ...message,
      toolUses: message.toolUses.map((toolUse) => ({ ...toolUse })),
    })),
  };
}

function collectThinkingBlocks(message: ParsedMessage): ThinkingBlock[] {
  if (!message.thinkingContent) return [];
  return [
    {
      content: message.thinkingContent,
      tokenCount: message.thinkingTokens,
    },
  ];
}

export class ClaudeCodeAdapter implements ContractAdapter {
  id = "claude-code";
  name = "Claude Code";
  icon = "◆";

  private projectsDir: string;
  private claudeDir: string;
  private now: () => Date;
  private parsedFileCache = new Map<string, ParsedFileCacheEntry>();
  private sessionIdToPath = new Map<string, string>();
  private gitCache = new Map<string, GitInfo>();

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.projectsDir = resolve(options.projectsDir ?? defaultProjectsDir());
    this.claudeDir = resolve(options.claudeDir ?? join(HOME, ".claude"));
    this.now = options.now ?? (() => new Date());
  }

  async detect(): Promise<boolean> {
    return this.collectSourceFiles().length > 0;
  }

  async findChanged(hint?: ChangeHint): Promise<ConversationRef[]> {
    const discoveredFiles = this.collectSourceFiles();
    const discoveredSet = new Set(discoveredFiles);
    const refs: ConversationRef[] = [];
    const seenRefs = new Set<string>();

    for (const cachedPath of [...this.parsedFileCache.keys()]) {
      if (!discoveredSet.has(cachedPath)) {
        this.parsedFileCache.delete(cachedPath);
        for (const [sessionId, indexedPath] of [...this.sessionIdToPath.entries()]) {
          if (indexedPath === cachedPath) {
            this.sessionIdToPath.delete(sessionId);
          }
        }
      }
    }

    const candidateFiles =
      hint?.kind === "fs-change"
        ? this.collectChangedPaths(hint.changedPaths ?? [])
        : discoveredFiles;

    const shouldReturnAll = !hint || hint.kind === "startup-scan";

    for (const filePath of candidateFiles) {
      if (!existsSync(filePath)) {
        this.parsedFileCache.delete(filePath);
        continue;
      }

      const stat = statSync(filePath);
      const cached = this.parsedFileCache.get(filePath);
      const changed =
        shouldReturnAll ||
        hint?.kind === "fs-change" ||
        !cached ||
        cached.size !== stat.size ||
        cached.mtimeMs !== stat.mtimeMs;

      if (!changed) continue;

      const model = this.getFileModel(filePath, true);
      if (!model) continue;

      for (const ref of model.refs) {
        const key = `${ref.sourcePath}::${ref.id}`;
        if (seenRefs.has(key)) continue;
        seenRefs.add(key);
        refs.push(ref);
      }
    }

    refs.sort((left, right) =>
      `${left.sourcePath}:${left.id}`.localeCompare(`${right.sourcePath}:${right.id}`),
    );
    return refs;
  }

  async loadConversation(ref: ConversationRef): Promise<ConversationBundle | null> {
    if (ref.adapterId !== this.id) return null;

    const model = this.getFileModel(ref.sourcePath);
    if (!model) return null;

    const bundle = model.bundles.find((candidate) => candidate.conversation.id === ref.id);
    if (!bundle) return null;

    const conversation = { ...bundle.conversation };
    const gitInfo = this.resolveGit(conversation.cwd);
    if (!conversation.gitRemote) conversation.gitRemote = gitInfo.remote;
    if (!conversation.branch) conversation.branch = gitInfo.branch;

    return cloneBundle({
      conversation,
      messages: bundle.messages,
    });
  }

  watchPaths(): string[] {
    return existsSync(this.projectsDir) ? [this.projectsDir] : [];
  }

  async sessions(): Promise<Session[]> {
    const sessions: Session[] = [];
    for (const filePath of this.collectSourceFiles()) {
      const model = this.getFileModel(filePath);
      if (!model) continue;
      for (const bundle of model.bundles) {
        sessions.push(this.toLegacySession(bundle));
      }
    }
    sessions.sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
    return sessions;
  }

  async sessionForFile(filePath: string): Promise<Session | null> {
    const model = this.getFileModel(filePath, true);
    if (!model || model.bundles.length === 0) return null;
    return this.toLegacySession(model.bundles[0]);
  }

  async messages(sessionId: string, sourcePath?: string): Promise<LegacyMessage[]> {
    const bundle = sourcePath
      ? this.getFileModel(sourcePath)?.bundles.find(
          (candidate) => candidate.conversation.id === sessionId,
        )
      : this.findBundleById(sessionId);

    if (!bundle) return [];
    return bundle.messages.map((message) => this.toLegacyMessage(message));
  }

  async newMessages(
    sessionId: string,
    sourcePath: string,
    afterIndex: number,
  ): Promise<LegacyMessage[]> {
    const allMessages = await this.messages(sessionId, sourcePath);
    return afterIndex > 0 && afterIndex < allMessages.length
      ? allMessages.slice(afterIndex)
      : allMessages;
  }

  async artifacts(): Promise<ContextArtifact[]> {
    const artifacts: ContextArtifact[] = [];

    const addFile = (
      path: string,
      kind: ArtifactKind,
      name: string,
      scope: ContextArtifact["scope"],
    ) => {
      if (!existsSync(path)) return;
      try {
        const stat = statSync(path);
        if (!stat.isFile()) return;
        const content = readFileSync(path, "utf8");
        const hash = stableHash(path, content);
        artifacts.push({
          id: `cc:${hash}:${basename(path)}`,
          adapterId: this.id,
          kind,
          name,
          path,
          scope,
          content:
            content.length > 100_000
              ? `${content.slice(0, 100_000)}\n...[truncated]`
              : content,
          contentHash: hash,
          updatedAt: stat.mtime.toISOString(),
          metadata: { size: stat.size },
        });
      } catch {
        // Skip unreadable files.
      }
    };

    const scanDir = (
      dir: string,
      kind: ArtifactKind,
      namePrefix: string,
      scope: ContextArtifact["scope"],
    ) => {
      if (!existsSync(dir)) return;
      try {
        for (const entry of readdirSync(dir)) {
          if (!entry.endsWith(".md") && !entry.endsWith(".json") && !entry.endsWith(".jsonl")) {
            continue;
          }
          addFile(join(dir, entry), kind, `${namePrefix}/${entry}`, scope);
        }
      } catch {
        // Skip unreadable directories.
      }
    };

    addFile(join(this.claudeDir, "CLAUDE.md"), "memory", "CLAUDE.md (global)", "global");
    addFile(
      join(this.claudeDir, "settings.json"),
      "config",
      "settings.json (global)",
      "global",
    );
    scanDir(join(this.claudeDir, "rules"), "rules", "rules (global)", "global");
    scanDir(join(this.claudeDir, "agents"), "agent-def", "agents (global)", "global");
    scanDir(join(this.claudeDir, "commands"), "skill", "commands (global)", "global");
    scanDir(join(this.claudeDir, "skills"), "skill", "skills (global)", "global");
    addFile(join(this.claudeDir, "history.jsonl"), "history", "history.jsonl", "global");
    addFile(join(this.claudeDir, "stats-cache.json"), "config", "stats-cache.json", "global");
    addFile(join(HOME, ".claude.json"), "mcp", ".claude.json (MCP + prefs)", "global");
    scanDir(join(this.claudeDir, "plans"), "plan", "plans", "global");

    if (existsSync(this.projectsDir)) {
      for (const projectDir of readdirSync(this.projectsDir)) {
        const memoryDir = join(this.projectsDir, projectDir, "memory");
        if (existsSync(memoryDir)) {
          scanDir(memoryDir, "memory", `memory (${projectDir})`, "project");
        }
      }
    }

    scanDir(join(this.claudeDir, "todos"), "todo", "todos", "session");

    const tasksDir = join(this.claudeDir, "tasks");
    if (existsSync(tasksDir)) {
      try {
        for (const taskDir of readdirSync(tasksDir)) {
          addFile(join(tasksDir, taskDir, "tasks.json"), "todo", `tasks/${taskDir}`, "session");
        }
      } catch {
        // Skip unreadable task directories.
      }
    }

    return artifacts;
  }

  private collectSourceFiles(rootDir = this.projectsDir): string[] {
    if (!existsSync(rootDir)) return [];

    const files: string[] = [];
    const stack = [resolve(rootDir)];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      let stat;
      try {
        stat = statSync(current);
      } catch {
        continue;
      }

      if (stat.isFile()) {
        if (current.endsWith(".jsonl")) files.push(current);
        continue;
      }

      try {
        for (const entry of readdirSync(current)) {
          stack.push(join(current, entry));
        }
      } catch {
        continue;
      }
    }

    files.sort();
    return files;
  }

  private collectChangedPaths(changedPaths: string[]): string[] {
    if (changedPaths.length === 0) return this.collectSourceFiles();

    const files = new Set<string>();

    for (const changedPath of changedPaths) {
      const resolvedPath = resolve(changedPath);

      if (!resolvedPath.startsWith(this.projectsDir)) {
        continue;
      }

      if (!existsSync(resolvedPath)) {
        if (resolvedPath.endsWith(".jsonl")) {
          this.parsedFileCache.delete(resolvedPath);
        }
        continue;
      }

      let stat;
      try {
        stat = statSync(resolvedPath);
      } catch {
        continue;
      }

      if (stat.isFile()) {
        if (resolvedPath.endsWith(".jsonl")) files.add(resolvedPath);
        continue;
      }

      for (const nestedFile of this.collectSourceFiles(resolvedPath)) {
        files.add(nestedFile);
      }
    }

    return [...files].sort();
  }

  private getFileModel(filePath: string, forceReload = false): FileModel | null {
    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
      this.parsedFileCache.delete(resolvedPath);
      return null;
    }

    const stat = statSync(resolvedPath);
    const cached = this.parsedFileCache.get(resolvedPath);
    if (
      !forceReload &&
      cached &&
      cached.size === stat.size &&
      cached.mtimeMs === stat.mtimeMs
    ) {
      return cached.model;
    }

    const model = this.buildFileModel(resolvedPath);
    if (!model) {
      this.parsedFileCache.delete(resolvedPath);
      return null;
    }

    this.parsedFileCache.set(resolvedPath, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      model,
    });
    this.sessionIdToPath.set(model.sessionId, resolvedPath);
    return model;
  }

  private buildFileModel(filePath: string): FileModel | null {
    const records = this.readRecords(filePath);
    if (records.length === 0) return null;

    const sessionId =
      records.find((record) => record.raw.sessionId)?.raw.sessionId ??
      basename(filePath, ".jsonl");
    const initialCwd =
      records.find((record) => typeof record.raw.cwd === "string" && record.raw.cwd.trim())?.raw
        .cwd ?? "";
    const initialGitBranch =
      records.find(
        (record) => typeof record.raw.gitBranch === "string" && record.raw.gitBranch.trim(),
      )?.raw.gitBranch ?? "";

    const parentLink = this.resolveParentLink(filePath, sessionId);
    const rootId = sessionId;

    const builders: SegmentBuilder[] = [
      this.createSegmentBuilder({
        id: rootId,
        traceId: parentLink.traceId || rootId,
        parentId: parentLink.parentId,
        relationship: parentLink.relationship,
        forkPoint: parentLink.forkPoint,
        cwd: initialCwd,
        gitBranchHint: initialGitBranch,
      }),
    ];

    let current = builders[0];
    let pendingCompactionSeed = "";

    for (const record of records) {
      const raw = record.raw;

      if (raw.type === "system" && raw.subtype === "compact_boundary") {
        pendingCompactionSeed = this.compactionSeed(rootId, raw, record.lineIndex);
        if (current.messages.length > 0) {
          current = this.createSegmentBuilder({
            id: this.compactedConversationId(rootId, pendingCompactionSeed),
            traceId: builders[0].traceId,
            parentId: current.id,
            relationship: "compacted",
            forkPoint: -1,
            cwd: current.cwd || initialCwd,
            gitBranchHint: current.gitBranchHint || initialGitBranch,
          });
          builders.push(current);
        }
      } else if (raw.type === "summary" && raw.summary) {
        const currentHasOnlySystemMessages =
          current.messages.length > 0 &&
          current.messages.every((message) => message.role === "system");

        if (current.messages.length > 0 && !currentHasOnlySystemMessages) {
          const seed =
            pendingCompactionSeed || this.compactionSeed(rootId, raw, record.lineIndex);
          current = this.createSegmentBuilder({
            id: this.compactedConversationId(rootId, seed),
            traceId: builders[0].traceId,
            parentId: current.id,
            relationship: "compacted",
            forkPoint: -1,
            cwd: current.cwd || initialCwd,
            gitBranchHint: current.gitBranchHint || initialGitBranch,
          });
          builders.push(current);
        }
        pendingCompactionSeed = "";
      }

      const message = this.parseMessageRecord(record, current, sessionId);
      if (!message) continue;
      current.messages.push(message);

      if (message.timestamp) {
        if (!current.startedAt) current.startedAt = message.timestamp;
        current.endedAt = message.timestamp;
      }
      if (!current.firstUserText && message.role === "user" && message.content) {
        current.firstUserText = message.content;
      }
      if (message.model) {
        current.modelCounts.set(
          message.model,
          (current.modelCounts.get(message.model) ?? 0) + 1,
        );
      }
      if (!current.cwd && raw.cwd) current.cwd = raw.cwd;
      if (!current.gitBranchHint && raw.gitBranch) current.gitBranchHint = raw.gitBranch;
    }

    const allBundles = builders
      .filter((builder) => builder.messages.length > 0)
      .map((builder) => this.finalizeBundle(builder, filePath, rootId));

    if (allBundles.length === 0) return null;

    return {
      sessionId,
      sourcePath: filePath,
      refs: allBundles.map((bundle) => ({
        id: bundle.conversation.id,
        sourcePath: filePath,
        adapterId: this.id,
      })),
      bundles: allBundles,
    };
  }

  private createSegmentBuilder(input: {
    id: string;
    traceId: string;
    parentId: string;
    relationship: ConversationRelationship;
    forkPoint: number;
    cwd: string;
    gitBranchHint: string;
  }): SegmentBuilder {
    return {
      id: input.id,
      traceId: input.traceId,
      parentId: input.parentId,
      relationship: input.relationship,
      forkPoint: input.forkPoint,
      messages: [],
      toolRefs: new Map<string, ParsedToolCall>(),
      sequence: 0,
      turn: 0,
      firstUserText: "",
      startedAt: "",
      endedAt: "",
      cwd: input.cwd,
      gitBranchHint: input.gitBranchHint,
      modelCounts: new Map<string, number>(),
    };
  }

  private parseMessageRecord(
    record: ParsedRecord,
    segment: SegmentBuilder,
    sessionId: string,
  ): ParsedMessage | null {
    const raw = record.raw;
    const timestamp = normalizeIso(raw.timestamp);
    const sequence = ++segment.sequence;

    if (raw.type === "summary" && raw.summary) {
      return {
        id: raw.uuid || stableHash(sessionId, "summary", String(record.lineIndex)),
        role: "system",
        content: raw.summary,
        recordType: "summary",
        model: "",
        sequence,
        turn: -1,
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
      };
    }

    if (raw.type === "system") {
      return {
        id: raw.uuid || stableHash(sessionId, "system", String(record.lineIndex)),
        role: "system",
        content:
          raw.subtype === "compact_boundary"
            ? JSON.stringify(raw.compactMetadata ?? {})
            : raw.subtype || "system",
        recordType: raw.subtype ? `system:${raw.subtype}` : "system",
        model: "",
        sequence,
        turn: -1,
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
      };
    }

    if ((raw.type !== "user" && raw.type !== "assistant") || !raw.message) {
      return null;
    }

    const role =
      raw.message.role === "assistant" || raw.type === "assistant"
        ? "assistant"
        : raw.message.role === "system"
          ? "system"
          : "user";
    const isSidechain = Boolean(raw.isSidechain);

    let turn = -1;
    if (!isSidechain && role !== "system") {
      if (role === "user") {
        segment.turn += 1;
      } else if (segment.turn === 0) {
        segment.turn = 1;
      }
      turn = segment.turn;
    }

    const toolUses: ParsedToolCall[] = [];
    const textParts: string[] = [];
    const thinkingParts: string[] = [];

    const content = raw.message.content;
    if (typeof content === "string") {
      textParts.push(content);
    } else if (Array.isArray(content)) {
      content.forEach((entry, blockIndex) => {
        const block = entry as ContentBlock;
        switch (block.type) {
          case "text":
            if (block.text) textParts.push(block.text);
            break;
          case "thinking":
            if (block.thinking) thinkingParts.push(block.thinking);
            break;
          case "tool_use": {
            const toolUse: ParsedToolCall = {
              id:
                block.id ||
                stableHash(
                  raw.uuid ?? raw.message?.id ?? sessionId,
                  block.name ?? "tool",
                  String(blockIndex),
                ),
              name: block.name || "unknown",
              input:
                block.input == null
                  ? ""
                  : typeof block.input === "string"
                    ? block.input
                    : JSON.stringify(block.input),
              output: "",
              isError: false,
              durationMs: -1,
              timestamp,
            };
            toolUses.push(toolUse);
            segment.toolRefs.set(toolUse.id, toolUse);
            break;
          }
          case "tool_result": {
            const output = extractToolResultText(block.content);
            if (output) textParts.push(output);
            const target = block.tool_use_id ? segment.toolRefs.get(block.tool_use_id) : undefined;
            if (target) {
              target.output = output;
              target.isError = Boolean(block.is_error);
            }
            break;
          }
          default:
            if (block.text) textParts.push(block.text);
            break;
        }
      });
    }

    const thinkingContent = thinkingParts.join("\n\n").trim();
    let messageContent = textParts.join("\n\n").trim();
    if (!messageContent && thinkingContent) messageContent = thinkingContent;
    if (!messageContent && toolUses.length > 0) {
      messageContent = toolUses.map((toolUse) => `[tool:${toolUse.name}]`).join("\n");
    }

    return {
      id:
        raw.uuid ||
        stableHash(
          sessionId,
          raw.message.id ?? raw.type,
          normalizeIso(raw.timestamp),
          String(record.lineIndex),
        ),
      role,
      content: messageContent,
      recordType: raw.type,
      model: raw.message.model || "",
      sequence,
      turn,
      isSidechain,
      parentMessageId: raw.parentUuid ?? "",
      inputTokens: raw.message.usage?.input_tokens || 0,
      outputTokens: raw.message.usage?.output_tokens || 0,
      cacheRead: raw.message.usage?.cache_read_input_tokens || 0,
      cacheWrite: raw.message.usage?.cache_creation_input_tokens || 0,
      thinkingContent,
      thinkingTokens: thinkingContent ? Math.max(1, Math.ceil(thinkingContent.length / 4)) : 0,
      timestamp,
      toolUses,
    };
  }

  private finalizeBundle(
    segment: SegmentBuilder,
    sourcePath: string,
    rootId: string,
  ): ConversationBundle {
    const primaryModel = [...segment.modelCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "";
    const name = summarizeText(
      segment.firstUserText,
      segment.relationship === "spawned"
        ? basename(sourcePath, ".jsonl")
        : rootId.slice(0, 8),
    );

    return {
      conversation: {
        id: segment.id,
        traceId: segment.traceId || rootId,
        parentId: segment.parentId,
        relationship: segment.relationship,
        forkPoint: segment.forkPoint,
        adapterId: this.id,
        name,
        cwd: segment.cwd,
        gitRemote: "",
        branch: segment.gitBranchHint || "",
        model: primaryModel,
        startedAt: segment.startedAt || segment.messages[0]?.timestamp || "",
        endedAt:
          segment.endedAt ||
          segment.messages[segment.messages.length - 1]?.timestamp ||
          segment.startedAt ||
          "",
        sourcePath,
        sourceFormat: "jsonl",
      },
      messages: segment.messages,
    };
  }

  private readRecords(filePath: string): ParsedRecord[] {
    try {
      const text = readFileSync(filePath, "utf8");
      return text
        .split("\n")
        .map((line, lineIndex) => ({ line, lineIndex }))
        .filter(({ line }) => line.trim().length > 0)
        .flatMap(({ line, lineIndex }) => {
          try {
            return [{ lineIndex, raw: JSON.parse(line) as RawLine }];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  private compactionSeed(rootId: string, raw: RawLine, lineIndex: number): string {
    return raw.leafUuid || raw.uuid || raw.timestamp || stableHash(rootId, String(lineIndex));
  }

  private compactedConversationId(rootId: string, boundarySeed: string): string {
    return stableHash(rootId, boundarySeed);
  }

  private resolveParentLink(filePath: string, sessionId: string): ParentLinkInfo {
    const parentSessionId = this.parentSessionIdFromPath(filePath);
    if (!parentSessionId) {
      return {
        relationship: "root",
        traceId: sessionId,
        parentId: "",
        forkPoint: -1,
      };
    }

    const parentPath = this.parentSourcePath(filePath, parentSessionId);
    if (!parentPath) {
      return {
        relationship: "root",
        traceId: sessionId,
        parentId: "",
        forkPoint: -1,
      };
    }

    const parentModel = this.getFileModel(parentPath);
    if (!parentModel || parentModel.bundles.length === 0) {
      return {
        relationship: "root",
        traceId: sessionId,
        parentId: "",
        forkPoint: -1,
      };
    }

    const needles = [sessionId, basename(filePath, ".jsonl"), basename(filePath)];
    let matchedParentId = parentModel.bundles[parentModel.bundles.length - 1]?.conversation.id ?? "";
    let forkPoint = -1;

    outer: for (const bundle of parentModel.bundles) {
      for (const message of bundle.messages) {
        for (const toolUse of message.toolUses) {
          const haystack = `${toolUse.name}\n${toolUse.input}\n${toolUse.output}`;
          if (needles.some((needle) => needle && haystack.includes(needle))) {
            matchedParentId = bundle.conversation.id;
            forkPoint = message.turn;
            break outer;
          }
        }
      }
    }

    return {
      relationship: "spawned",
      traceId: parentModel.bundles[0]?.conversation.traceId || parentSessionId,
      parentId: matchedParentId,
      forkPoint,
    };
  }

  private parentSessionIdFromPath(filePath: string): string {
    const normalized = resolve(filePath);
    const marker = `${sep}subagents${sep}`;
    if (!normalized.includes(marker)) return "";
    const parts = normalized.split(sep);
    const subagentsIndex = parts.lastIndexOf("subagents");
    return subagentsIndex > 0 ? parts[subagentsIndex - 1] : "";
  }

  private parentSourcePath(filePath: string, parentSessionId: string): string | null {
    const indexed = this.sessionIdToPath.get(parentSessionId);
    if (indexed && existsSync(indexed)) return indexed;

    const projectRoot = this.projectRootForPath(filePath);
    const canonicalPath = join(projectRoot, `${parentSessionId}.jsonl`);
    if (existsSync(canonicalPath)) return canonicalPath;

    const topLevelJsonl = this.collectSourceFiles(projectRoot).find(
      (candidate) => basename(candidate, ".jsonl") === parentSessionId,
    );
    return topLevelJsonl ?? null;
  }

  private projectRootForPath(filePath: string): string {
    const relative = resolve(filePath).slice(this.projectsDir.length + 1);
    const [projectSegment] = relative.split(sep);
    return projectSegment ? join(this.projectsDir, projectSegment) : this.projectsDir;
  }

  private resolveGit(cwd: string): GitInfo {
    if (!cwd) return { remote: "", branch: "" };

    const resolvedCwd = resolve(cwd);
    const cached = this.gitCache.get(resolvedCwd);
    if (cached) return cached;

    const runGit = (args: string[]): string => {
      try {
        return execFileSync("git", args, { cwd: resolvedCwd, encoding: "utf8" }).trim();
      } catch {
        return "";
      }
    };

    const info = {
      remote: runGit(["remote", "get-url", "origin"]),
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    };
    this.gitCache.set(resolvedCwd, info);
    return info;
  }

  private findBundleById(conversationId: string): ConversationBundle | null {
    const indexedPath = this.sessionIdToPath.get(conversationId);
    if (indexedPath) {
      const indexedBundle = this.getFileModel(indexedPath)?.bundles.find(
        (bundle) => bundle.conversation.id === conversationId,
      );
      if (indexedBundle) return indexedBundle;
    }

    for (const filePath of this.collectSourceFiles()) {
      const bundle = this.getFileModel(filePath)?.bundles.find(
        (candidate) => candidate.conversation.id === conversationId,
      );
      if (bundle) return bundle;
    }

    return null;
  }

  private toLegacySession(bundle: ConversationBundle): Session {
    const totalInputTokens = bundle.messages.reduce(
      (sum, message) => sum + message.inputTokens,
      0,
    );
    const totalOutputTokens = bundle.messages.reduce(
      (sum, message) => sum + message.outputTokens,
      0,
    );
    const totalCacheRead = bundle.messages.reduce((sum, message) => sum + message.cacheRead, 0);
    const totalCacheWrite = bundle.messages.reduce(
      (sum, message) => sum + message.cacheWrite,
      0,
    );

    const durationMs =
      bundle.conversation.startedAt && bundle.conversation.endedAt
        ? Math.max(
            0,
            new Date(bundle.conversation.endedAt).getTime() -
              new Date(bundle.conversation.startedAt).getTime(),
          )
        : 0;

    return {
      id: bundle.conversation.id,
      name: bundle.conversation.name,
      adapterId: this.id,
      adapterName: this.name,
      createdAt: bundle.conversation.startedAt,
      updatedAt: bundle.conversation.endedAt,
      durationMs,
      isActive:
        bundle.conversation.endedAt !== "" &&
        this.now().getTime() - new Date(bundle.conversation.endedAt).getTime() < 5 * 60 * 1000,
      totalTokens: totalInputTokens + totalOutputTokens,
      estCost: estimateCost(
        bundle.conversation.model,
        totalInputTokens,
        totalOutputTokens,
        totalCacheRead,
        totalCacheWrite,
      ),
      messageCount: bundle.messages.length,
      sourcePath: bundle.conversation.sourcePath,
      isSubAgent: bundle.conversation.relationship === "spawned",
      parentSessionId: bundle.conversation.parentId,
      isCompacted: bundle.conversation.relationship === "compacted",
      metadata: {
        cwd: bundle.conversation.cwd,
        traceId: bundle.conversation.traceId,
        relationship: bundle.conversation.relationship,
        forkPoint: bundle.conversation.forkPoint,
      },
    };
  }

  private toLegacyMessage(message: ParsedMessage): LegacyMessage {
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
      toolUses: message.toolUses.map((toolUse) => ({
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
        output: toolUse.output,
      })),
      thinkingBlocks: collectThinkingBlocks(message),
      recordType: message.recordType,
    };
  }
}
