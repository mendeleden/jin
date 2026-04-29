import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { createInterface } from "readline";
import { estimateCost } from "../pricing";
import type { DiscoveryCacheState } from "./discovery-cache";
import type {
  Adapter,
  ChangeHint,
  ConversationBundle,
  ConversationRef,
  Message,
  ParsedConversation,
  ParsedMessage,
  ParsedToolCall,
  Session,
  ThinkingBlock,
  ToolUse,
  V2Adapter,
} from "./types";

const DEFAULT_CODEX_HOME = join(homedir(), ".codex");
const EMPTY_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheRead: 0,
  reasoningTokens: 0,
};

type JsonObject = Record<string, unknown>;

interface FileSnapshot {
  size: number;
  mtimeMs: number;
}

interface CachedFileIndex {
  snapshot: FileSnapshot;
  sessionId: string;
  refIds: string[];
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  reasoningTokens: number;
}

interface GitInfo {
  remote: string;
  branch: string;
}

interface LocalSegment {
  id: string;
  messages: ParsedMessage[];
  startedAt: string;
  endedAt: string;
  modelCounts: Map<string, number>;
}

interface LocalFileModel {
  sessionId: string;
  sourcePath: string;
  cwd: string;
  gitRemote: string;
  branch: string;
  rootName: string;
  agentNickname: string;
  parentThreadId: string;
  sessionTimestamp: string;
  segments: LocalSegment[];
}

interface ResolvedBase {
  traceId: string;
  parentId: string;
  relationship: ParsedConversation["relationship"];
  forkPoint: number;
}

interface LoadedFileModel {
  snapshot: FileSnapshot;
  model: LocalFileModel;
  base: ResolvedBase;
  git: GitInfo;
}

export class CodexAdapter implements Adapter, V2Adapter {
  id = "codex";
  name = "Codex";
  icon = "▶";
  discoveryCacheContractVersion = 1;
  discoveryCachePayloadVersion = 1;

  private readonly codexHome: string;
  private readonly sessionsDir: string;
  private readonly archivedSessionsDir: string;
  private readonly statCache = new Map<string, FileSnapshot>();
  private readonly fileIndexCache = new Map<string, CachedFileIndex>();
  private readonly gitCache = new Map<string, GitInfo>();
  private loadedFileCache:
    | {
        filePath: string;
        entry: LoadedFileModel;
      }
    | null = null;

  constructor(codexHome = process.env.CODEX_HOME || DEFAULT_CODEX_HOME) {
    this.codexHome = codexHome;
    this.sessionsDir = join(this.codexHome, "sessions");
    this.archivedSessionsDir = join(this.codexHome, "archived_sessions");
  }

  async detect(): Promise<boolean> {
    return this.findAllSessionFiles().length > 0;
  }

  async findChanged(hint?: ChangeHint): Promise<ConversationRef[]> {
    const files = this.findAllSessionFiles();
    const currentFiles = new Set(files);
    const warmStartupScan =
      hint?.kind === "startup-scan" &&
      (this.statCache.size > 0 || this.fileIndexCache.size > 0);

    for (const cachedPath of this.statCache.keys()) {
      if (!currentFiles.has(cachedPath)) {
        this.statCache.delete(cachedPath);
        this.fileIndexCache.delete(cachedPath);
        if (this.loadedFileCache?.filePath === cachedPath) {
          this.loadedFileCache = null;
        }
      }
    }

    let targetFiles: string[] = files;
    if (hint?.kind === "periodic-scan" || warmStartupScan) {
      targetFiles = files.filter((filePath) => this.hasFileChanged(filePath));
    } else if (hint?.kind === "fs-change" && hint.changedPaths && hint.changedPaths.length > 0) {
      targetFiles = files.filter((filePath) => this.matchesChangedPaths(filePath, hint.changedPaths ?? []));
    }

    const refs: ConversationRef[] = [];
    for (const filePath of targetFiles) {
      const snapshot = this.readSnapshot(filePath);
      if (!snapshot) {
        continue;
      }

      this.statCache.set(filePath, snapshot);
      refs.push(...(await this.refsForFile(filePath, snapshot)));
      await this.reclaimScanMemory();
    }

    return refs;
  }

  async loadConversation(ref: ConversationRef): Promise<ConversationBundle | null> {
    if (!existsSync(ref.sourcePath)) {
      return null;
    }

    const loaded = await this.loadFileModel(ref.sourcePath);
    if (!loaded) {
      return null;
    }

    const segmentIndex = loaded.model.segments.findIndex(
      (segment) => segment.id === ref.id,
    );
    if (segmentIndex < 0) {
      return null;
    }

    return this.buildBundle(
      loaded.model,
      loaded.base,
      loaded.git,
      segmentIndex,
    );
  }

  async sessions(): Promise<Session[]> {
    const refs = await this.findChanged({ kind: "startup-scan" });
    const sessions: Session[] = [];

    for (const ref of refs) {
      const bundle = await this.loadConversation(ref);
      if (!bundle) {
        continue;
      }
      sessions.push(this.toLegacySession(bundle));
    }

    sessions.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return sessions;
  }

  async messages(sessionId: string, sourcePath?: string): Promise<Message[]> {
    const ref = sourcePath
      ? await this.findRefInFile(sessionId, sourcePath)
      : await this.findRef(sessionId);
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
    return [this.sessionsDir, this.archivedSessionsDir].filter((path) => existsSync(path));
  }

  releaseTransientMemory(): void {
    this.loadedFileCache = null;
  }

  releaseDiscoveryMemory(): void {
    this.loadedFileCache = null;
  }

  exportDiscoveryState(): DiscoveryCacheState {
    return {
      sources: Array.from(this.fileIndexCache.entries())
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(([sourcePath, entry]) => ({
          sourcePath,
          sourceKind: "jsonl",
          sizeBytes: entry.snapshot.size,
          mtimeMs: entry.snapshot.mtimeMs,
          signature: `${entry.snapshot.size}:${entry.snapshot.mtimeMs}`,
          payload: {
            sessionId: entry.sessionId,
            refIds: entry.refIds,
          },
        })),
    };
  }

  importDiscoveryState(state: DiscoveryCacheState): void {
    this.statCache.clear();
    this.fileIndexCache.clear();

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

      const snapshot = {
        size: source.sizeBytes,
        mtimeMs: source.mtimeMs,
      };
      this.statCache.set(source.sourcePath, snapshot);
      this.fileIndexCache.set(source.sourcePath, {
        snapshot,
        sessionId,
        refIds,
      });
    }
  }

  private findAllSessionFiles(): string[] {
    const files: string[] = [];
    for (const root of [this.sessionsDir, this.archivedSessionsDir]) {
      if (!existsSync(root)) {
        continue;
      }
      this.walkJsonl(root, files);
    }
    files.sort();
    return files;
  }

  private walkJsonl(dir: string, files: string[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch (error) {
      console.warn(`[codex adapter] failed to read directory ${dir}:`, error);
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch (error) {
        console.warn(`[codex adapter] failed to stat ${fullPath}:`, error);
        continue;
      }

      if (stats.isDirectory()) {
        this.walkJsonl(fullPath, files);
        continue;
      }

      if (stats.isFile() && entry.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  private async refsForFile(
    filePath: string,
    snapshot?: FileSnapshot,
  ): Promise<ConversationRef[]> {
    const index = await this.getFileIndex(filePath, snapshot);
    if (!index) {
      return [];
    }

    return index.refIds.map((refId) => ({
      id: refId,
      sourcePath: filePath,
      adapterId: this.id,
    }));
  }

  private async findRef(sessionId: string): Promise<ConversationRef | null> {
    for (const filePath of this.findAllSessionFiles()) {
      const ref = await this.findRefInFile(sessionId, filePath);
      if (ref) {
        return ref;
      }
    }
    return null;
  }

  private async findRefInFile(
    sessionId: string,
    sourcePath: string,
  ): Promise<ConversationRef | null> {
    const index = await this.getFileIndex(sourcePath);
    if (!index || !index.refIds.includes(sessionId)) {
      return null;
    }

    return {
      id: sessionId,
      sourcePath,
      adapterId: this.id,
    };
  }

  private hasFileChanged(filePath: string): boolean {
    const snapshot = this.readSnapshot(filePath);
    if (!snapshot) {
      return false;
    }

    const previous = this.statCache.get(filePath);
    if (!previous) {
      return true;
    }

    return previous.size !== snapshot.size || previous.mtimeMs !== snapshot.mtimeMs;
  }

  private matchesChangedPaths(filePath: string, changedPaths: string[]): boolean {
    return changedPaths.some((changedPath) =>
      filePath === changedPath ||
      filePath.startsWith(`${changedPath}/`) ||
      changedPath.startsWith(`${filePath}/`)
    );
  }

  private async buildFileModel(filePath: string): Promise<LocalFileModel | null> {
    const fileTimestamp = this.fileTimestamp(filePath);
    let sessionId = this.defaultSessionId(filePath);
    let sessionIdLocked = false;
    let parentThreadId = "";
    let agentNickname = "";
    let cwd = "";
    let gitRemote = "";
    let branch = "";
    let sessionTimestamp = fileTimestamp;
    let currentTurn = -1;
    let currentModel = "";
    let firstUserText = "";
    let currentSegment: LocalSegment | null = null;
    const segments: LocalSegment[] = [];
    let pendingTools: ParsedToolCall[] = [];
    const pendingToolIndex = new Map<string, number>();
    let pendingThinkingContent = "";
    let pendingThinkingTokens = 0;
    let pendingUsage: TokenUsage = { ...EMPTY_USAGE };
    let pendingAssistantTimestamp = "";
    let pendingAssistantModel = "";
    let sawLine = false;

    const ensureSegment = (timestamp: string): LocalSegment => {
      if (!currentSegment) {
        currentSegment = {
          id: sessionId,
          messages: [],
          startedAt: timestamp,
          endedAt: timestamp,
          modelCounts: new Map(),
        };
        segments.push(currentSegment);
      }
      return currentSegment;
    };

    const clearPendingAssistant = (): void => {
      pendingTools = [];
      pendingToolIndex.clear();
      pendingThinkingContent = "";
      pendingThinkingTokens = 0;
      pendingUsage = { ...EMPTY_USAGE };
      pendingAssistantTimestamp = "";
      pendingAssistantModel = "";
    };

    const hasPendingAssistantState = (): boolean =>
      pendingTools.length > 0 ||
      pendingThinkingContent.length > 0 ||
      pendingThinkingTokens > 0 ||
      pendingUsage.inputTokens > 0 ||
      pendingUsage.outputTokens > 0 ||
      pendingUsage.cacheRead > 0 ||
      pendingUsage.reasoningTokens > 0;

    const addMessage = (segment: LocalSegment, message: Omit<ParsedMessage, "sequence">): void => {
      const parsed: ParsedMessage = {
        ...message,
        sequence: segment.messages.length,
      };
      segment.messages.push(parsed);
      if (parsed.timestamp) {
        if (!segment.startedAt || Date.parse(parsed.timestamp) < Date.parse(segment.startedAt)) {
          segment.startedAt = parsed.timestamp;
        }
        if (!segment.endedAt || Date.parse(parsed.timestamp) > Date.parse(segment.endedAt)) {
          segment.endedAt = parsed.timestamp;
        }
      }
      if (parsed.model) {
        segment.modelCounts.set(parsed.model, (segment.modelCounts.get(parsed.model) ?? 0) + 1);
      }
      if (parsed.role === "user" && !firstUserText && parsed.content.trim()) {
        firstUserText = parsed.content;
      }
    };

    const flushPendingAssistant = (timestamp: string, recordType = "synthetic_assistant"): void => {
      if (!hasPendingAssistantState()) {
        return;
      }

      const assistantTimestamp = pendingAssistantTimestamp || timestamp || sessionTimestamp;
      const assistantModel = pendingAssistantModel || currentModel;
      addMessage(ensureSegment(assistantTimestamp), {
        id: stableHash(sessionId, ensureSegment(assistantTimestamp).id, recordType, `${ensureSegment(assistantTimestamp).messages.length}`),
        role: "assistant",
        content: "Tool call output",
        recordType,
        model: assistantModel,
        turn: currentTurn,
        isSidechain: false,
        parentMessageId: "",
        inputTokens: pendingUsage.inputTokens,
        outputTokens: pendingUsage.outputTokens,
        cacheRead: pendingUsage.cacheRead,
        cacheWrite: 0,
        thinkingContent: pendingThinkingContent,
        thinkingTokens: Math.max(pendingThinkingTokens, pendingUsage.reasoningTokens),
        timestamp: assistantTimestamp,
        toolUses: [...pendingTools],
      });
      clearPendingAssistant();
    };

    await this.scanJsonlFile(filePath, (line, index) => {
      sawLine = true;
      const envelopeType = asString(line.type);
      const payload = asObject(line.payload);
      const timestamp = asString(line.timestamp) || sessionTimestamp;
      if (timestamp) {
        sessionTimestamp = sessionTimestamp || timestamp;
      }

      if (envelopeType === "session_meta" && payload) {
        const recordSessionId = asString(payload.id);
        if (recordSessionId && !sessionIdLocked) {
          sessionId = recordSessionId;
          sessionIdLocked = true;
          if (segments.length === 1 && segments[0].messages.length === 0) {
            segments[0].id = sessionId;
          }
        }

        sessionTimestamp = asString(payload.timestamp) || sessionTimestamp;
        cwd = asString(payload.cwd) || cwd;

        const git = asObject(payload.git);
        gitRemote = asString(git?.repository_url) || gitRemote;
        branch = asString(git?.branch) || branch;

        const source = payload.source;
        parentThreadId = this.extractParentThreadId(source) || asString(payload.forked_from_id) || parentThreadId;
        agentNickname = this.extractAgentNickname(source) || agentNickname;
        return;
      }

      if (envelopeType === "turn_context" && payload) {
        currentTurn = currentTurn < 0 ? 1 : currentTurn + 1;
        cwd = asString(payload.cwd) || cwd;
        currentModel = asString(payload.model) || currentModel;
        return;
      }

      if (envelopeType === "event_msg" && payload) {
        if (asString(payload.type) === "token_count") {
          pendingUsage = this.extractTokenUsage(payload);
          pendingAssistantTimestamp = timestamp || pendingAssistantTimestamp;
          pendingAssistantModel = currentModel || pendingAssistantModel;
        }
        return;
      }

      if (envelopeType === "compacted" && payload) {
        flushPendingAssistant(timestamp, "synthetic_assistant");

        currentSegment = {
          id: stableHash(sessionId, `compacted:${segments.length}:${asString(payload.id) || asString(payload.turn_id) || timestamp || index}`),
          messages: [],
          startedAt: timestamp,
          endedAt: timestamp,
          modelCounts: new Map(),
        };
        segments.push(currentSegment);

        const replacementHistory = asArray(payload.replacement_history);
        for (let historyIndex = 0; historyIndex < replacementHistory.length; historyIndex += 1) {
          const historyItem = asObject(replacementHistory[historyIndex]);
          if (!historyItem) {
            continue;
          }

          const historyType = asString(historyItem.type);
          if (historyType === "message") {
            const role = normalizeRole(asString(historyItem.role));
            const content = flattenMessageContent(historyItem.content);
            if (!content) {
              continue;
            }
            addMessage(currentSegment, {
              id:
                asString(historyItem.id) ||
                stableHash(sessionId, currentSegment.id, "replacement_message", `${historyIndex}`),
              role,
              content,
              recordType: "message",
              model: asString(historyItem.model),
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
            });
            continue;
          }

          if (historyType === "compaction") {
            addMessage(currentSegment, {
              id: stableHash(sessionId, currentSegment.id, "replacement_compaction", `${historyIndex}`),
              role: "system",
              content: "Context compacted",
              recordType: "compaction",
              model: "",
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
            });
          }
        }

        return;
      }

      if (envelopeType !== "response_item" || !payload) {
        return;
      }

      const itemType = asString(payload.type);
      if (itemType === "message") {
        const role = normalizeRole(asString(payload.role));
        const content = flattenMessageContent(payload.content);
        if (role !== "assistant") {
          flushPendingAssistant(timestamp, "synthetic_assistant");
          if (!content) {
            return;
          }
          addMessage(ensureSegment(timestamp), {
            id:
              asString(payload.id) ||
              stableHash(sessionId, ensureSegment(timestamp).id, "message", `${ensureSegment(timestamp).messages.length}`),
            role,
            content,
            recordType: "message",
            model: "",
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
          return;
        }

        const usage = this.selectUsage(payload, pendingUsage);
        const model = asString(payload.model) || currentModel;
        if (model) {
          currentModel = model;
        }

        addMessage(ensureSegment(timestamp), {
          id:
            asString(payload.id) ||
            stableHash(sessionId, ensureSegment(timestamp).id, "assistant", `${ensureSegment(timestamp).messages.length}`),
          role: "assistant",
          content: content || "Tool call output",
          recordType: "message",
          model,
          turn: currentTurn,
          isSidechain: false,
          parentMessageId: "",
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheRead: usage.cacheRead,
          cacheWrite: 0,
          thinkingContent: pendingThinkingContent,
          thinkingTokens: Math.max(pendingThinkingTokens, pendingUsage.reasoningTokens),
          timestamp,
          toolUses: [...pendingTools],
        });
        clearPendingAssistant();
        return;
      }

      if (itemType === "reasoning") {
        pendingThinkingContent = flattenReasoningSummary(payload.summary);
        pendingThinkingTokens = Math.max(pendingThinkingTokens, pendingUsage.reasoningTokens);
        pendingAssistantTimestamp = timestamp || pendingAssistantTimestamp;
        pendingAssistantModel = currentModel || pendingAssistantModel;
        return;
      }

      if (itemType === "function_call" || itemType === "custom_tool_call" || itemType === "web_search_call") {
        const segment = ensureSegment(timestamp);
        const toolIndex = pendingTools.length;
        const tool = this.parseToolCall(payload, itemType, timestamp, sessionId, segment.id, toolIndex);
        pendingTools.push(tool);
        const callKey = asString(payload.call_id) || asString(payload.id);
        if (callKey) {
          pendingToolIndex.set(callKey, toolIndex);
        }
        pendingAssistantTimestamp = timestamp || pendingAssistantTimestamp;
        pendingAssistantModel = currentModel || pendingAssistantModel;
        return;
      }

      if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
        const callKey = asString(payload.call_id) || asString(payload.id);
        if (callKey && pendingToolIndex.has(callKey)) {
          const tool = pendingTools[pendingToolIndex.get(callKey) ?? 0];
          const parsed = this.parseToolOutput(payload, itemType);
          tool.output = parsed.output;
          tool.isError = tool.isError || parsed.isError;
          tool.durationMs = parsed.durationMs >= 0 ? parsed.durationMs : tool.durationMs;
        }
        pendingAssistantTimestamp = timestamp || pendingAssistantTimestamp;
      }
    });

    if (!sawLine) {
      return null;
    }

    flushPendingAssistant(sessionTimestamp, "synthetic_assistant");

    if (segments.length === 0) {
      segments.push({
        id: sessionId,
        messages: [],
        startedAt: sessionTimestamp,
        endedAt: sessionTimestamp,
        modelCounts: new Map(),
      });
    }

    return {
      sessionId,
      sourcePath: filePath,
      cwd,
      gitRemote,
      branch,
      rootName: summarizeName(firstUserText) || agentNickname || sessionId.slice(0, 8),
      agentNickname,
      parentThreadId,
      sessionTimestamp,
      segments,
    };
  }

  private buildBundle(
    model: LocalFileModel,
    base: ResolvedBase,
    git: GitInfo,
    index: number,
  ): ConversationBundle {
    const segment = model.segments[index];
    const conversation: ParsedConversation = {
      id: segment.id,
      traceId: base.traceId,
      parentId: index === 0 ? base.parentId : model.segments[index - 1]?.id ?? "",
      relationship: index === 0 ? base.relationship : "compacted",
      forkPoint: index === 0 ? base.forkPoint : -1,
      adapterId: this.id,
      name: model.rootName,
      cwd: model.cwd,
      gitRemote: git.remote,
      branch: git.branch,
      model: mostFrequentModel(segment.modelCounts),
      startedAt: segment.startedAt || model.sessionTimestamp,
      endedAt: segment.endedAt || model.sessionTimestamp,
      sourcePath: model.sourcePath,
      sourceFormat: "jsonl",
    };

    return {
      conversation,
      messages: segment.messages,
    };
  }

  private async resolveBase(
    model: LocalFileModel,
    visited = new Set<string>(),
  ): Promise<ResolvedBase> {
    if (!model.parentThreadId || model.parentThreadId === model.sessionId) {
      return {
        traceId: model.segments[0]?.id ?? model.sessionId,
        parentId: "",
        relationship: "root",
        forkPoint: -1,
      };
    }

    if (visited.has(model.sourcePath)) {
      return {
        traceId: model.parentThreadId,
        parentId: model.parentThreadId,
        relationship: "spawned",
        forkPoint: -1,
      };
    }

    visited.add(model.sourcePath);
    const parentPath = (await this.buildSessionIndex()).get(model.parentThreadId);
    if (!parentPath || !existsSync(parentPath)) {
      return {
        traceId: model.parentThreadId,
        parentId: model.parentThreadId,
        relationship: "spawned",
        forkPoint: -1,
      };
    }

    const parentModel = await this.buildFileModel(parentPath);
    if (!parentModel) {
      return {
        traceId: model.parentThreadId,
        parentId: model.parentThreadId,
        relationship: "spawned",
        forkPoint: -1,
      };
    }

    const parentBase = await this.resolveBase(parentModel, visited);
    const spawnLink = this.findSpawnLink(parentModel, model.sessionId, model.agentNickname);

    return {
      traceId: parentBase.traceId,
      parentId: spawnLink?.parentId ?? parentModel.segments[0]?.id ?? model.parentThreadId,
      relationship: "spawned",
      forkPoint: spawnLink?.forkPoint ?? -1,
    };
  }

  private findSpawnLink(
    parentModel: LocalFileModel,
    childSessionId: string,
    childNickname: string,
  ): { parentId: string; forkPoint: number } | null {
    for (const segment of parentModel.segments) {
      for (const message of segment.messages) {
        for (const tool of message.toolUses) {
          if (tool.name !== "spawn_agent") {
            continue;
          }

          const output = parseJsonString(tool.output);
          const outputObject = asObject(output);
          const agentId = asString(outputObject?.agent_id);
          const nickname = asString(outputObject?.nickname);
          if (agentId === childSessionId || (childNickname && nickname === childNickname)) {
            return {
              parentId: segment.id,
              forkPoint: message.turn,
            };
          }
        }
      }
    }

    return null;
  }

  private resolveConversationGit(model: LocalFileModel): GitInfo {
    if (model.gitRemote || model.branch) {
      return {
        remote: model.gitRemote,
        branch: model.branch,
      };
    }

    return this.resolveGit(model.cwd);
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
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const result = { remote, branch };
      this.gitCache.set(cwd, result);
      return result;
    } catch {
      const empty = { remote: "", branch: "" };
      this.gitCache.set(cwd, empty);
      return empty;
    }
  }

  private async buildSessionIndex(): Promise<Map<string, string>> {
    const index = new Map<string, string>();
    for (const filePath of this.findAllSessionFiles()) {
      const fileIndex = await this.getFileIndex(filePath);
      if (fileIndex?.sessionId) {
        index.set(fileIndex.sessionId, filePath);
      }
    }
    return index;
  }

  private async getFileIndex(
    filePath: string,
    snapshot = this.readSnapshot(filePath),
  ): Promise<CachedFileIndex | null> {
    if (!snapshot) {
      return null;
    }

    const cached = this.fileIndexCache.get(filePath);
    if (
      cached &&
      cached.snapshot.size === snapshot.size &&
      cached.snapshot.mtimeMs === snapshot.mtimeMs
    ) {
      return cached;
    }

    const index = await this.scanFileIndex(filePath, snapshot);
    this.fileIndexCache.set(filePath, index);
    return index;
  }

  private fileTimestamp(filePath: string): string {
    try {
      return new Date(statSync(filePath).mtimeMs).toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  private defaultSessionId(filePath: string): string {
    const name = basename(filePath, ".jsonl");
    return name.startsWith("rollout-") ? name.slice("rollout-".length) : name;
  }

  private async loadFileModel(filePath: string): Promise<LoadedFileModel | null> {
    const snapshot = this.readSnapshot(filePath);
    if (!snapshot) {
      return null;
    }

    if (
      this.loadedFileCache?.filePath === filePath &&
      this.loadedFileCache.entry.snapshot.size === snapshot.size &&
      this.loadedFileCache.entry.snapshot.mtimeMs === snapshot.mtimeMs
    ) {
      return this.loadedFileCache.entry;
    }

    const model = await this.buildFileModel(filePath);
    if (!model) {
      return null;
    }

    const entry: LoadedFileModel = {
      snapshot,
      model,
      base: await this.resolveBase(model),
      git: this.resolveConversationGit(model),
    };
    this.loadedFileCache = {
      filePath,
      entry,
    };
    return entry;
  }

  private async scanFileIndex(
    filePath: string,
    snapshot: FileSnapshot,
  ): Promise<CachedFileIndex> {
    let sessionId = this.defaultSessionId(filePath);
    let sessionIdLocked = false;
    let currentSegmentId = "";
    let rootSegmentCreated = false;
    const refIds: string[] = [];
    const fallbackTimestamp = new Date(snapshot.mtimeMs).toISOString();
    try {
      await this.scanJsonlFile(filePath, (line, index) => {
        const envelopeType = asString(line.type);
        if (envelopeType === "session_meta") {
          const payload = asObject(line.payload);
          const recordSessionId = asString(payload?.id);
          if (recordSessionId && !sessionIdLocked) {
            if (
              currentSegmentId === sessionId &&
              refIds.length === 1 &&
              !rootSegmentCreated
            ) {
              refIds[0] = recordSessionId;
              currentSegmentId = recordSessionId;
            }
            sessionId = recordSessionId;
            sessionIdLocked = true;
          }
          return;
        }

        if (envelopeType === "compacted") {
          const payload = asObject(line.payload);
          const timestamp = asString(line.timestamp) || fallbackTimestamp;
          currentSegmentId = stableHash(
            sessionId,
            `compacted:${refIds.length}:${asString(payload?.id) || asString(payload?.turn_id) || timestamp || index}`,
          );
          refIds.push(currentSegmentId);
          return;
        }

        if (rootSegmentCreated || envelopeType !== "response_item") {
          return;
        }

        const payload = asObject(line.payload);
        if (!payload) {
          return;
        }

        const itemType = asString(payload.type);
        if (itemType === "message") {
          const role = normalizeRole(asString(payload.role));
          const content = flattenMessageContent(payload.content);
          if (role !== "assistant" && !content) {
            return;
          }
        } else if (
          itemType !== "reasoning" &&
          itemType !== "function_call" &&
          itemType !== "custom_tool_call" &&
          itemType !== "web_search_call"
        ) {
          return;
        }

        currentSegmentId = sessionId;
        refIds.push(currentSegmentId);
        rootSegmentCreated = true;
      });
    } catch (error) {
      console.warn(`[codex adapter] failed to read ${filePath}:`, error);
    }

    if (refIds.length === 0) {
      refIds.push(sessionId);
    }

    return {
      snapshot,
      sessionId,
      refIds,
    };
  }

  private async scanJsonlFile(
    filePath: string,
    visit: (line: JsonObject, index: number) => void | Promise<void>,
  ): Promise<void> {
    let stream;
    try {
      stream = createReadStream(filePath, { encoding: "utf8" });
      const reader = createInterface({
        input: stream,
        crlfDelay: Infinity,
      });
      let index = 0;

      for await (const rawLine of reader) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        try {
          const parsed = JSON.parse(line);
          if (isObject(parsed)) {
            await visit(parsed, index);
            index += 1;
          }
        } catch (error) {
          console.warn(
            `[codex adapter] failed to parse JSONL line in ${filePath}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.warn(`[codex adapter] failed to read ${filePath}:`, error);
    } finally {
      stream?.destroy();
    }
  }

  private readSnapshot(filePath: string): FileSnapshot | null {
    try {
      const stats = statSync(filePath);
      return { size: stats.size, mtimeMs: stats.mtimeMs };
    } catch (error) {
      console.warn(`[codex adapter] failed to stat ${filePath}:`, error);
      return null;
    }
  }

  private async reclaimScanMemory(): Promise<void> {
    Bun.gc(true);
    await Bun.sleep(0);
  }

  private extractParentThreadId(source: unknown): string {
    const sourceObject = asObject(source);
    const subagent = asObject(sourceObject?.subagent);
    const threadSpawn = asObject(subagent?.thread_spawn);
    return asString(threadSpawn?.parent_thread_id);
  }

  private extractAgentNickname(source: unknown): string {
    const sourceObject = asObject(source);
    const subagent = asObject(sourceObject?.subagent);
    const threadSpawn = asObject(subagent?.thread_spawn);
    return asString(threadSpawn?.agent_nickname);
  }

  private extractTokenUsage(payload: JsonObject): TokenUsage {
    const info = asObject(payload.info);
    const lastTokenUsage = asObject(info?.last_token_usage);
    return {
      inputTokens: asNumber(lastTokenUsage?.input_tokens) ?? 0,
      outputTokens: asNumber(lastTokenUsage?.output_tokens) ?? 0,
      cacheRead: asNumber(lastTokenUsage?.cached_input_tokens) ?? 0,
      reasoningTokens: asNumber(lastTokenUsage?.reasoning_output_tokens) ?? 0,
    };
  }

  private selectUsage(payload: JsonObject, pendingUsage: TokenUsage): TokenUsage {
    const usage = asObject(payload.usage);
    const direct = {
      inputTokens: asNumber(usage?.input_tokens) ?? 0,
      outputTokens: asNumber(usage?.output_tokens) ?? 0,
      cacheRead: asNumber(usage?.cached_input_tokens) ?? 0,
      reasoningTokens: 0,
    };

    if (direct.inputTokens || direct.outputTokens || direct.cacheRead) {
      return direct;
    }

    return pendingUsage;
  }

  private parseToolCall(
    payload: JsonObject,
    itemType: string,
    timestamp: string,
    sessionId: string,
    segmentId: string,
    toolIndex: number,
  ): ParsedToolCall {
    const name =
      itemType === "web_search_call"
        ? "web_search"
        : asString(payload.name) || itemType;
    const callId = asString(payload.call_id) || asString(payload.id);
    const input =
      itemType === "custom_tool_call"
        ? asString(payload.input)
        : itemType === "function_call"
          ? asString(payload.arguments)
          : JSON.stringify(payload);

    return {
      id: callId || stableHash(sessionId, segmentId, name, `${toolIndex}`),
      name,
      input,
      output: "",
      isError: asString(payload.status) === "failed",
      durationMs: -1,
      timestamp,
    };
  }

  private parseToolOutput(
    payload: JsonObject,
    itemType: string,
  ): { output: string; isError: boolean; durationMs: number } {
    const rawOutput = asString(payload.output);
    if (!rawOutput) {
      return { output: "", isError: false, durationMs: -1 };
    }

    if (itemType === "custom_tool_call_output") {
      const parsed = parseJsonString(rawOutput);
      const parsedObject = asObject(parsed);
      if (parsedObject) {
        const output =
          asString(parsedObject.output) ||
          asString(parsedObject.stdout) ||
          rawOutput;
        const exitCode = asNumber(parsedObject.exit_code) ?? 0;
        const durationSeconds = asNumber(parsedObject.duration_seconds);
        return {
          output,
          isError: exitCode !== 0,
          durationMs: durationSeconds === undefined ? -1 : Math.round(durationSeconds * 1000),
        };
      }
    }

    return { output: rawOutput, isError: false, durationMs: -1 };
  }

  private toLegacySession(bundle: ConversationBundle): Session {
    const inputTokens = bundle.messages.reduce((sum, message) => sum + message.inputTokens, 0);
    const outputTokens = bundle.messages.reduce((sum, message) => sum + message.outputTokens, 0);
    const totalTokens = inputTokens + outputTokens;

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
      estCost: estimateCost(bundle.conversation.model, inputTokens, outputTokens),
      messageCount: bundle.messages.length,
      sourcePath: bundle.conversation.sourcePath,
      isSubAgent: bundle.conversation.relationship === "spawned",
      parentSessionId: bundle.conversation.parentId,
      isCompacted: bundle.conversation.relationship === "compacted",
      metadata: {
        traceId: bundle.conversation.traceId,
        relationship: bundle.conversation.relationship,
        forkPoint: bundle.conversation.forkPoint,
      },
    };
  }

  private toLegacyMessage(message: ParsedMessage): Message {
    const thinkingBlocks: ThinkingBlock[] =
      message.thinkingContent || message.thinkingTokens > 0
        ? [
            {
              content: message.thinkingContent,
              tokenCount: message.thinkingTokens,
            },
          ]
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

function asObject(value: unknown): JsonObject | null {
  return isObject(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRole(role: string): ParsedMessage["role"] {
  if (role === "assistant" || role === "user") {
    return role;
  }
  return "system";
}

function stableHash(...parts: string[]): string {
  return createHash("sha1")
    .update(parts.join("\u241f"))
    .digest("hex");
}

function summarizeName(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 120);
}

function flattenMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts = content.flatMap((item) => {
    if (typeof item === "string") {
      return item;
    }

    const object = asObject(item);
    if (!object) {
      return [];
    }

    const text = asString(object.text);
    if (text) {
      return [text];
    }

    const nestedText = asString(object.content);
    if (nestedText) {
      return [nestedText];
    }

    return [];
  });

  return parts.join("\n\n").trim();
}

function flattenReasoningSummary(summary: unknown): string {
  if (typeof summary === "string") {
    return summary.trim();
  }

  if (!Array.isArray(summary)) {
    return "";
  }

  return summary
    .flatMap((item) => {
      if (typeof item === "string") {
        return item;
      }
      const object = asObject(item);
      if (!object) {
        return [];
      }
      const text = asString(object.text);
      return text ? [text] : [];
    })
    .join("\n\n")
    .trim();
}

function mostFrequentModel(models: Map<string, number>): string {
  let winner = "";
  let count = -1;
  for (const [model, seen] of models.entries()) {
    if (seen > count) {
      winner = model;
      count = seen;
    }
  }
  return winner;
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
