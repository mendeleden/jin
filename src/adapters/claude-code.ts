import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join, resolve, sep } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import { estimateCost } from "../pricing";
import type { Adapter as ContractAdapter, ChangeHint } from "../contracts/adapters";
import type {
  DiscoveryCacheJsonValue,
  DiscoveryCacheState,
} from "./discovery-cache";
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
  homeDir?: string;
  xdgConfigHome?: string;
  appDataDir?: string;
  platform?: NodeJS.Platform;
  now?: () => Date;
}

interface RawLine {
  type: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  requestId?: string;
  sessionId?: string;
  agentId?: string;
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
  seenUsageFingerprints: Set<string>;
  messageIdentityCounts: Map<string, number>;
  lastMessageIdByUuid: Map<string, string>;
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

interface FileIndex {
  sessionId: string;
  refs: ConversationRef[];
}

interface FileIndexCacheEntry {
  size: number;
  mtimeMs: number;
  index: FileIndex;
}

interface LoadedFileCacheEntry {
  path: string;
  size: number;
  mtimeMs: number;
  model: FileModel;
}

interface FileMetadata {
  conversationId: string;
  traceSessionId: string;
  parentLookupNeedles: string[];
  initialCwd: string;
  initialGitBranch: string;
}

interface IndexedSegment {
  id: string;
  messageCount: number;
  hasOnlySystemMessages: boolean;
}

interface GitInfo {
  remote: string;
  branch: string;
}

interface MessageUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}

const HOME = homedir();

function hasJsonlSource(rootDir: string): boolean {
  if (!existsSync(rootDir)) return false;

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
      if (current.endsWith(".jsonl")) {
        return true;
      }
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

  return false;
}

function defaultProjectsDirCandidates(input: {
  homeDir: string;
  currentPlatform: NodeJS.Platform;
  xdgConfigHome?: string;
  appDataDir?: string;
}): string[] {
  const candidates: string[] = [];

  if (input.currentPlatform === "win32") {
    const appDataDir = input.appDataDir ?? join(input.homeDir, "AppData", "Roaming");
    candidates.push(join(appDataDir, "Claude", "projects"));
    candidates.push(join(input.homeDir, ".claude", "projects"));
    candidates.push(join(input.homeDir, ".config", "claude", "projects"));
  } else {
    const xdgConfigHome = input.xdgConfigHome ?? join(input.homeDir, ".config");
    candidates.push(join(xdgConfigHome, "claude", "projects"));
    candidates.push(join(input.homeDir, ".claude", "projects"));
  }

  return [...new Set(candidates.map((candidate) => resolve(candidate)))];
}

function defaultProjectsDir(input: {
  homeDir: string;
  currentPlatform: NodeJS.Platform;
  xdgConfigHome?: string;
  appDataDir?: string;
}): string {
  const candidates = defaultProjectsDirCandidates(input);

  for (const candidate of candidates) {
    if (hasJsonlSource(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? resolve(input.homeDir, ".claude", "projects");
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

function messageUsageTotals(raw: RawLine): MessageUsageTotals {
  return {
    inputTokens: raw.message?.usage?.input_tokens || 0,
    outputTokens: raw.message?.usage?.output_tokens || 0,
    cacheRead: raw.message?.usage?.cache_read_input_tokens || 0,
    cacheWrite: raw.message?.usage?.cache_creation_input_tokens || 0,
  };
}

function usageFingerprint(raw: RawLine, usage: MessageUsageTotals): string {
  const requestId = raw.requestId?.trim();
  const messageId = raw.message?.id?.trim();
  if (!requestId || !messageId) {
    return "";
  }

  return [
    requestId,
    messageId,
    String(usage.inputTokens),
    String(usage.outputTokens),
    String(usage.cacheRead),
    String(usage.cacheWrite),
  ].join("\u001f");
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
  private static readonly DISCOVERY_RECLAIM_INTERVAL = 25;
  discoveryCacheContractVersion = 1;
  discoveryCachePayloadVersion = 1;

  private homeDir: string;
  private projectsDir: string;
  private claudeDir: string;
  private now: () => Date;
  private fileIndexCache = new Map<string, FileIndexCacheEntry>();
  private loadedFileCache: LoadedFileCacheEntry | null = null;
  private sessionIdToPath = new Map<string, string>();
  private gitCache = new Map<string, GitInfo>();

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    const homeDir = resolve(options.homeDir ?? HOME);
    const currentPlatform = options.platform ?? process.platform;

    this.homeDir = homeDir;
    this.projectsDir = resolve(
      options.projectsDir ??
        defaultProjectsDir({
          homeDir,
          currentPlatform,
          xdgConfigHome: options.xdgConfigHome,
          appDataDir: options.appDataDir,
        }),
    );
    this.claudeDir = resolve(options.claudeDir ?? join(homeDir, ".claude"));
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

    for (const cachedPath of [...this.fileIndexCache.keys()]) {
      if (!discoveredSet.has(cachedPath)) {
        this.clearCachedPath(cachedPath);
      }
    }
    if (this.loadedFileCache && !discoveredSet.has(this.loadedFileCache.path)) {
      this.clearCachedPath(this.loadedFileCache.path);
    }

    const candidateFiles =
      hint?.kind === "fs-change"
        ? this.collectChangedPaths(hint.changedPaths ?? [])
        : discoveredFiles;

    const shouldReturnAll =
      !hint ||
      (hint.kind === "startup-scan" && this.fileIndexCache.size === 0);

    for (let fileIndex = 0; fileIndex < candidateFiles.length; fileIndex += 1) {
      const filePath = candidateFiles[fileIndex];
      if (!existsSync(filePath)) {
        this.clearCachedPath(filePath);
        continue;
      }

      const stat = statSync(filePath);
      const cached = this.fileIndexCache.get(filePath);
      const changed =
        shouldReturnAll ||
        hint?.kind === "fs-change" ||
        !cached ||
        cached.size !== stat.size ||
        cached.mtimeMs !== stat.mtimeMs;

      if (!changed) continue;

      const index = await this.getFileIndex(filePath, true);
      if (!index) continue;

      for (const ref of index.refs) {
        const key = `${ref.sourcePath}::${ref.id}`;
        if (seenRefs.has(key)) continue;
        seenRefs.add(key);
        refs.push(ref);
      }

      if (
        shouldReturnAll &&
        (fileIndex + 1) % ClaudeCodeAdapter.DISCOVERY_RECLAIM_INTERVAL === 0
      ) {
        await this.reclaimDiscoveryLoopMemory();
      }
    }

    refs.sort((left, right) =>
      `${left.sourcePath}:${left.id}`.localeCompare(`${right.sourcePath}:${right.id}`),
    );
    return refs;
  }

  async loadConversation(ref: ConversationRef): Promise<ConversationBundle | null> {
    if (ref.adapterId !== this.id) return null;

    const model = await this.getLoadedFileModel(ref.sourcePath);
    if (!model) return null;

    const bundle = model.bundles.find((candidate) => candidate.conversation.id === ref.id);
    if (!bundle) return null;

    const conversation = { ...bundle.conversation };
    const gitInfo = this.resolveGit(conversation.cwd);
    if (!conversation.gitRemote) conversation.gitRemote = gitInfo.remote;
    if (!conversation.branch) conversation.branch = gitInfo.branch;
    const messages = bundle.messages;
    if (this.loadedFileCache?.path === resolve(ref.sourcePath)) {
      this.loadedFileCache = null;
    }

    // Keep the parsed message tree immutable-by-convention, but release the
    // full-file cache immediately after materializing the bundle so the runtime
    // does not pin an extra Claude transcript between batches.
    return {
      conversation,
      messages,
    };
  }

  releaseTransientMemory(): void {
    this.sessionIdToPath.clear();
    this.loadedFileCache = null;
  }

  releaseDiscoveryMemory(): void {
    // Keep the lightweight discovery index so periodic scans can still compare
    // size/mtime and avoid replaying every Claude transcript as "changed".
    this.loadedFileCache = null;
  }

  exportDiscoveryState(): DiscoveryCacheState {
    return {
      sources: Array.from(this.fileIndexCache.entries())
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([sourcePath, entry]) => ({
          sourcePath,
          sourceKind: "jsonl",
          sizeBytes: entry.size,
          mtimeMs: entry.mtimeMs,
          signature: `${entry.size}:${entry.mtimeMs}`,
          payload: {
            sessionId: entry.index.sessionId,
            refIds: entry.index.refs.map((ref) => ref.id),
          },
        })),
    };
  }

  importDiscoveryState(state: DiscoveryCacheState): void {
    const nextFileIndexCache = new Map<string, FileIndexCacheEntry>();
    const nextSessionIdToPath = new Map<string, string>();

    for (const source of state.sources) {
      if (source.sourceKind !== "jsonl") {
        continue;
      }

      const payload = source.payload as {
        sessionId?: unknown;
        refIds?: unknown;
      };
      const sessionId =
        typeof payload.sessionId === "string" ? payload.sessionId : "";
      const refIds = Array.isArray(payload.refIds)
        ? payload.refIds.filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          )
        : [];
      if (!sessionId || refIds.length === 0) {
        continue;
      }

      const refs = refIds.map((id) => ({
        id,
        sourcePath: source.sourcePath,
        adapterId: this.id,
      }));

      nextFileIndexCache.set(source.sourcePath, {
        size: source.sizeBytes,
        mtimeMs: source.mtimeMs,
        index: {
          sessionId,
          refs,
        },
      });

      for (const id of refIds) {
        nextSessionIdToPath.set(id, source.sourcePath);
      }
    }

    this.fileIndexCache = nextFileIndexCache;
    this.sessionIdToPath = nextSessionIdToPath;
  }

  watchPaths(): string[] {
    return existsSync(this.projectsDir) ? [this.projectsDir] : [];
  }

  async sessions(): Promise<Session[]> {
    const sessions: Session[] = [];
    for (const filePath of this.collectSourceFiles()) {
      const model = await this.getLoadedFileModel(filePath);
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
    const model = await this.getLoadedFileModel(filePath, true);
    if (!model || model.bundles.length === 0) return null;
    return this.toLegacySession(model.bundles[0]);
  }

  async messages(sessionId: string, sourcePath?: string): Promise<LegacyMessage[]> {
    const bundle = sourcePath
      ? (await this.getLoadedFileModel(sourcePath))?.bundles.find(
          (candidate) => candidate.conversation.id === sessionId,
        )
      : await this.findBundleById(sessionId);

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
    addFile(join(this.homeDir, ".claude.json"), "mcp", ".claude.json (MCP + prefs)", "global");
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
          this.clearCachedPath(resolvedPath);
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

  private clearCachedPath(filePath: string): void {
    const resolvedPath = resolve(filePath);
    this.fileIndexCache.delete(resolvedPath);
    if (this.loadedFileCache?.path === resolvedPath) {
      this.loadedFileCache = null;
    }
    this.clearSessionPathIndex(resolvedPath);
  }

  private clearSessionPathIndex(filePath: string): void {
    for (const [sessionId, indexedPath] of [...this.sessionIdToPath.entries()]) {
      if (indexedPath === filePath) {
        this.sessionIdToPath.delete(sessionId);
      }
    }
  }

  private async getFileIndex(filePath: string, forceReload = false): Promise<FileIndex | null> {
    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
      this.clearCachedPath(resolvedPath);
      return null;
    }

    const stat = statSync(resolvedPath);
    const cached = this.fileIndexCache.get(resolvedPath);
    if (
      !forceReload &&
      cached &&
      cached.size === stat.size &&
      cached.mtimeMs === stat.mtimeMs
    ) {
      return cached.index;
    }

    const index = await this.buildFileIndex(resolvedPath);
    if (!index) {
      this.clearCachedPath(resolvedPath);
      return null;
    }

    this.fileIndexCache.set(resolvedPath, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      index,
    });
    this.replaceSessionPathIndex(resolvedPath, index.refs.map((ref) => ref.id));
    return index;
  }

  private async getLoadedFileModel(
    filePath: string,
    forceReload = false,
  ): Promise<FileModel | null> {
    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
      this.clearCachedPath(resolvedPath);
      return null;
    }

    const stat = statSync(resolvedPath);
    const cached = this.loadedFileCache;
    if (
      !forceReload &&
      cached &&
      cached.path === resolvedPath &&
      cached.size === stat.size &&
      cached.mtimeMs === stat.mtimeMs
    ) {
      return cached.model;
    }

    const model = await this.buildFileModel(resolvedPath);
    if (!model) {
      if (this.loadedFileCache?.path === resolvedPath) {
        this.loadedFileCache = null;
      }
      this.clearSessionPathIndex(resolvedPath);
      return null;
    }

    this.loadedFileCache = {
      path: resolvedPath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      model,
    };
    this.replaceSessionPathIndex(
      resolvedPath,
      model.bundles.map((bundle) => bundle.conversation.id),
    );
    return model;
  }

  private async buildFileIndex(filePath: string): Promise<FileIndex | null> {
    const metadata = await this.inspectFile(filePath);
    if (!metadata) return null;

    const sessionId = metadata.conversationId;
    const rootId = sessionId;
    const segments: IndexedSegment[] = [
      {
        id: rootId,
        messageCount: 0,
        hasOnlySystemMessages: true,
      },
    ];

    let current = segments[0];
    let pendingCompactionSeed = "";

    await this.forEachParsedRecord(filePath, (record) => {
      const raw = record.raw;

      if (raw.type === "system" && raw.subtype === "compact_boundary") {
        pendingCompactionSeed = this.compactionSeed(rootId, raw, record.lineIndex);
        if (current.messageCount > 0) {
          current = {
            id: this.compactedConversationId(rootId, pendingCompactionSeed),
            messageCount: 0,
            hasOnlySystemMessages: true,
          };
          segments.push(current);
        }
      } else if (raw.type === "summary" && raw.summary) {
        const currentHasOnlySystemMessages =
          current.messageCount > 0 && current.hasOnlySystemMessages;

        if (current.messageCount > 0 && !currentHasOnlySystemMessages) {
          const seed =
            pendingCompactionSeed || this.compactionSeed(rootId, raw, record.lineIndex);
          current = {
            id: this.compactedConversationId(rootId, seed),
            messageCount: 0,
            hasOnlySystemMessages: true,
          };
          segments.push(current);
        }
        pendingCompactionSeed = "";
      }

      const role = this.recordRole(raw);
      if (!role) return;

      current.messageCount += 1;
      if (role !== "system") {
        current.hasOnlySystemMessages = false;
      }
    });

    const refs = segments
      .filter((segment) => segment.messageCount > 0)
      .map((segment) => ({
        id: segment.id,
        sourcePath: filePath,
        adapterId: this.id,
      }));

    if (refs.length === 0) return null;

    return {
      sessionId,
      refs,
    };
  }

  private async buildFileModel(filePath: string): Promise<FileModel | null> {
    const metadata = await this.inspectFile(filePath);
    if (!metadata) return null;

    const sessionId = metadata.conversationId;
    const traceSessionId = metadata.traceSessionId;
    const initialCwd = metadata.initialCwd;
    const initialGitBranch = metadata.initialGitBranch;

    const parentLink = await this.resolveParentLink(
      filePath,
      sessionId,
      traceSessionId,
      metadata.parentLookupNeedles,
    );
    const rootId = sessionId;

    const builders: SegmentBuilder[] = [
      this.createSegmentBuilder({
        id: rootId,
        traceId: parentLink.traceId || traceSessionId || rootId,
        parentId: parentLink.parentId,
        relationship: parentLink.relationship,
        forkPoint: parentLink.forkPoint,
        cwd: initialCwd,
        gitBranchHint: initialGitBranch,
      }),
    ];

    let current = builders[0];
    let pendingCompactionSeed = "";

    await this.forEachParsedRecord(filePath, (record) => {
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
      if (!message) return;
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
    });

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
      seenUsageFingerprints: new Set<string>(),
      messageIdentityCounts: new Map<string, number>(),
      lastMessageIdByUuid: new Map<string, string>(),
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
    const parentMessageId = raw.parentUuid
      ? segment.lastMessageIdByUuid.get(raw.parentUuid) ?? ""
      : "";

    if (raw.type === "summary" && raw.summary) {
      const message: ParsedMessage = {
        id: this.nextMessageId(
          segment,
          this.messageIdentitySeed(record, sessionId, "summary", timestamp),
        ),
        role: "system",
        content: raw.summary,
        recordType: "summary",
        model: "",
        sequence,
        turn: -1,
        isSidechain: false,
        parentMessageId,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        thinkingContent: "",
        thinkingTokens: 0,
        timestamp,
        toolUses: [],
      };
      this.recordParsedMessageId(segment, raw.uuid, message.id);
      return message;
    }

    if (raw.type === "system") {
      const message: ParsedMessage = {
        id: this.nextMessageId(
          segment,
          this.messageIdentitySeed(record, sessionId, "system", timestamp),
        ),
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
        parentMessageId,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        thinkingContent: "",
        thinkingTokens: 0,
        timestamp,
        toolUses: [],
      };
      this.recordParsedMessageId(segment, raw.uuid, message.id);
      return message;
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

    const usage = messageUsageTotals(raw);
    const fingerprint = role === "assistant" ? usageFingerprint(raw, usage) : "";
    const isDuplicateUsage = Boolean(fingerprint) && segment.seenUsageFingerprints.has(fingerprint);
    if (fingerprint && !isDuplicateUsage) {
      // Claude can replay identical billed usage across multiple assistant rows
      // for one logical turn. Count each exact fingerprint once per segment.
      segment.seenUsageFingerprints.add(fingerprint);
    }
    const normalizedUsage = isDuplicateUsage
      ? { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 }
      : usage;

    const message: ParsedMessage = {
      id: this.nextMessageId(
        segment,
        this.messageIdentitySeed(record, sessionId, raw.type, timestamp),
      ),
      role,
      content: messageContent,
      recordType: raw.type,
      model: raw.message.model || "",
      sequence,
      turn,
      isSidechain,
      parentMessageId,
      inputTokens: normalizedUsage.inputTokens,
      outputTokens: normalizedUsage.outputTokens,
      cacheRead: normalizedUsage.cacheRead,
      cacheWrite: normalizedUsage.cacheWrite,
      thinkingContent,
      thinkingTokens: thinkingContent ? Math.max(1, Math.ceil(thinkingContent.length / 4)) : 0,
      timestamp,
      toolUses,
    };
    this.recordParsedMessageId(segment, raw.uuid, message.id);
    return message;
  }

  private recordRole(raw: RawLine): ParsedMessage["role"] | null {
    if (raw.type === "summary" && raw.summary) return "system";
    if (raw.type === "system") return "system";
    if ((raw.type !== "user" && raw.type !== "assistant") || !raw.message) {
      return null;
    }

    if (raw.message.role === "assistant" || raw.type === "assistant") {
      return "assistant";
    }
    if (raw.message.role === "system") {
      return "system";
    }
    return "user";
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

  private async forEachParsedRecord(
    filePath: string,
    visit: (record: ParsedRecord) => boolean | void | Promise<boolean | void>,
  ): Promise<boolean> {
    try {
      const stream = createReadStream(filePath, { encoding: "utf8" });
      const reader = createInterface({
        input: stream,
        crlfDelay: Infinity,
      });
      let lineIndex = 0;
      let sawRecord = false;
      try {
        for await (const line of reader) {
          if (line.trim().length > 0) {
            try {
              sawRecord = true;
              const shouldContinue = await visit({
                lineIndex,
                raw: JSON.parse(line) as RawLine,
              });
              if (shouldContinue === false) {
                return true;
              }
            } catch {
              // Skip malformed JSONL rows from partial writes.
            }
          }

          lineIndex += 1;
        }
      } finally {
        reader.close();
        stream.destroy();
      }
      return sawRecord;
    } catch {
      return false;
    }
  }

  private compactionSeed(rootId: string, raw: RawLine, lineIndex: number): string {
    return raw.leafUuid || raw.uuid || raw.timestamp || stableHash(rootId, String(lineIndex));
  }

  private compactedConversationId(rootId: string, boundarySeed: string): string {
    return stableHash(rootId, boundarySeed);
  }

  private subagentConversationId(
    parentScopeId: string,
    sourceConversationId: string,
    filePath: string,
  ): string {
    const fileStem = basename(filePath, ".jsonl");
    return `agent-${stableHash(parentScopeId || fileStem, sourceConversationId || fileStem, fileStem)}`;
  }

  private async resolveParentLink(
    filePath: string,
    sessionId: string,
    traceSessionId: string,
    parentLookupNeedles: string[] = [],
  ): Promise<ParentLinkInfo> {
    const parentSessionId = this.parentSessionIdFromPath(filePath);
    if (!parentSessionId) {
      return {
        relationship: "root",
        traceId: sessionId,
        parentId: "",
        forkPoint: -1,
      };
    }

    const fallbackLink = {
      relationship: "spawned" as const,
      traceId: traceSessionId || parentSessionId,
      parentId: parentSessionId,
      forkPoint: -1,
    };
    const parentPath = this.parentSourcePath(filePath, parentSessionId);
    if (!parentPath) {
      return fallbackLink;
    }
    if (resolve(parentPath) === resolve(filePath)) {
      return fallbackLink;
    }

    const parentModel = await this.getLoadedFileModel(parentPath);
    if (!parentModel || parentModel.bundles.length === 0) {
      return fallbackLink;
    }

    const needles = [
      ...new Set([
        ...parentLookupNeedles,
        sessionId,
        basename(filePath, ".jsonl"),
        basename(filePath),
      ]),
    ].filter(Boolean);
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
      traceId: parentModel.bundles[0]?.conversation.traceId || fallbackLink.traceId,
      parentId: matchedParentId || fallbackLink.parentId,
      forkPoint,
    };
  }

  private parentSessionIdFromPath(filePath: string): string {
    const normalized = resolve(filePath);
    const marker = `${sep}subagents${sep}`;
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex < 0) return "";
    return basename(normalized.slice(0, markerIndex));
  }

  private parentSourcePath(filePath: string, parentSessionId: string): string | null {
    const structuralPath = this.structuralParentSourcePath(filePath, parentSessionId);
    if (structuralPath && existsSync(structuralPath)) {
      return structuralPath;
    }

    const indexed = this.sessionIdToPath.get(parentSessionId);
    if (indexed && existsSync(indexed) && resolve(indexed) !== resolve(filePath)) return indexed;

    const projectRoot = this.projectRootForPath(filePath);
    const canonicalPath = join(projectRoot, `${parentSessionId}.jsonl`);
    if (existsSync(canonicalPath) && resolve(canonicalPath) !== resolve(filePath)) {
      return canonicalPath;
    }

    const topLevelJsonl = this.collectSourceFiles(projectRoot).find(
      (candidate) =>
        resolve(candidate) !== resolve(filePath) && basename(candidate, ".jsonl") === parentSessionId,
    );
    return topLevelJsonl ?? null;
  }

  private structuralParentSourcePath(filePath: string, parentSessionId: string): string | null {
    const normalized = resolve(filePath);
    const marker = `${sep}subagents${sep}`;
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex < 0) return null;

    const parentStem = normalized.slice(0, markerIndex);
    if (basename(parentStem) !== parentSessionId) {
      return null;
    }

    return `${parentStem}.jsonl`;
  }

  private projectRootForPath(filePath: string): string {
    const relative = resolve(filePath).slice(this.projectsDir.length + 1);
    const [projectSegment] = relative.split(sep);
    return projectSegment ? join(this.projectsDir, projectSegment) : this.projectsDir;
  }

  private async inspectFile(filePath: string): Promise<FileMetadata | null> {
    const expectsAgentId = this.isSubagentPath(filePath);
    const parentSessionId = this.parentSessionIdFromPath(filePath);
    let traceSessionId = "";
    let agentId = "";
    let initialCwd = "";
    let initialGitBranch = "";

    const sawRecord = await this.forEachParsedRecord(filePath, (record) => {
      if (!traceSessionId && typeof record.raw.sessionId === "string" && record.raw.sessionId.trim()) {
        traceSessionId = record.raw.sessionId.trim();
      }
      if (!agentId && typeof record.raw.agentId === "string" && record.raw.agentId.trim()) {
        agentId = record.raw.agentId.trim();
      }
      if (!initialCwd && typeof record.raw.cwd === "string" && record.raw.cwd.trim()) {
        initialCwd = record.raw.cwd;
      }
      if (
        !initialGitBranch &&
        typeof record.raw.gitBranch === "string" &&
        record.raw.gitBranch.trim()
      ) {
        initialGitBranch = record.raw.gitBranch;
      }

      const hasConversationId = expectsAgentId
        ? Boolean(agentId) || Boolean(traceSessionId)
        : Boolean(traceSessionId);
      const hasInitialHints = Boolean(initialCwd) && Boolean(initialGitBranch);
      return !(hasConversationId && hasInitialHints);
    });

    if (!sawRecord) {
      return null;
    }

    const fallbackId = basename(filePath, ".jsonl");
    const sourceConversationId = expectsAgentId
      ? agentId || traceSessionId || fallbackId
      : traceSessionId || fallbackId;
    const conversationId = expectsAgentId
      ? this.subagentConversationId(
          parentSessionId || traceSessionId || fallbackId,
          sourceConversationId,
          filePath,
        )
      : sourceConversationId;
    const parentLookupNeedles = [
      sourceConversationId,
      basename(filePath, ".jsonl"),
      basename(filePath),
      basename(filePath, ".jsonl").replace(/^agent-/, ""),
    ].filter(Boolean);

    return {
      conversationId,
      traceSessionId: traceSessionId || parentSessionId || fallbackId,
      parentLookupNeedles: [...new Set(parentLookupNeedles)],
      initialCwd,
      initialGitBranch,
    };
  }

  private isSubagentPath(filePath: string): boolean {
    return resolve(filePath).includes(`${sep}subagents${sep}`);
  }

  private replaceSessionPathIndex(filePath: string, ids: string[]): void {
    this.clearSessionPathIndex(filePath);
    for (const id of ids) {
      if (id) {
        this.sessionIdToPath.set(id, filePath);
      }
    }
  }

  private messageIdentitySeed(
    record: ParsedRecord,
    sessionId: string,
    kind: string,
    timestamp: string,
  ): string {
    const raw = record.raw;
    if (typeof raw.uuid === "string" && raw.uuid.trim()) {
      return raw.uuid.trim();
    }

    return stableHash(
      sessionId,
      kind,
      raw.message?.id ?? "",
      raw.subtype ?? "",
      raw.summary ?? "",
      timestamp,
      String(record.lineIndex),
    );
  }

  private nextMessageId(segment: SegmentBuilder, seed: string): string {
    const occurrence = (segment.messageIdentityCounts.get(seed) ?? 0) + 1;
    segment.messageIdentityCounts.set(seed, occurrence);
    return stableHash(segment.id, seed, String(occurrence));
  }

  private recordParsedMessageId(
    segment: SegmentBuilder,
    rawUuid: string | undefined,
    parsedMessageId: string,
  ): void {
    if (typeof rawUuid === "string" && rawUuid.trim()) {
      segment.lastMessageIdByUuid.set(rawUuid.trim(), parsedMessageId);
    }
  }

  private resolveGit(cwd: string): GitInfo {
    if (!cwd) return { remote: "", branch: "" };

    const resolvedCwd = resolve(cwd);
    const cached = this.gitCache.get(resolvedCwd);
    if (cached) return cached;

    const runGit = (args: string[]): string => {
      try {
        return execFileSync("git", args, {
          cwd: resolvedCwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        }).trim();
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

  private async reclaimDiscoveryLoopMemory(): Promise<void> {
    this.loadedFileCache = null;
    Bun.gc?.(true);
    await Bun.sleep(0);
  }

  private async findBundleById(conversationId: string): Promise<ConversationBundle | null> {
    const indexedPath = this.sessionIdToPath.get(conversationId);
    if (indexedPath) {
      const indexedBundle = (await this.getLoadedFileModel(indexedPath))?.bundles.find(
        (bundle) => bundle.conversation.id === conversationId,
      );
      if (indexedBundle) return indexedBundle;
    }

    for (const filePath of this.collectSourceFiles()) {
      const bundle = (await this.getLoadedFileModel(filePath))?.bundles.find(
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
