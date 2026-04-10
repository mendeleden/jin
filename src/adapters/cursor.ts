import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { homedir } from "os";
import type {
  V2Adapter,
  ChangeHint,
  ConversationBundle,
  ConversationRef,
  ConversationRelationship,
  ParsedConversation,
  ParsedMessage,
  ParsedToolCall,
  Session,
  Message,
} from "./types";

type CursorAdapterOptions = {
  chatsDir?: string;
  globalStorageDbPath?: string;
};

type Layer1Snapshot = {
  id: string;
  sourcePath: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  model: string;
  bubbleIds: string[];
  subagentIds: string[];
  metadata: Record<string, unknown>;
};

type Layer1ComposerData = Layer1Snapshot & {
  raw: Record<string, unknown>;
  bubbles: Layer1Bubble[];
};

type Layer1Bubble = {
  bubbleId: string;
  type: number;
  text: string;
  createdAt: string;
  tokenCount: {
    inputTokens: number;
    outputTokens: number;
  };
  toolFormerData: Record<string, unknown> | null;
};

type Layer3Snapshot = {
  id: string;
  sourcePath: string;
  createdAt: string;
  updatedAt: string;
  workspace: string;
  latestRootBlobId: string;
  name: string;
};

type Layer3Meta = Layer3Snapshot & {
  raw: Record<string, unknown>;
};

type Layer3Blob = {
  bytes: Uint8Array;
  parsed: JsonObject | null;
};

type Layer3Node = {
  id: string;
  raw: Record<string, unknown>;
};

type Layer3ToolResult = {
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
};

type JsonObject = Record<string, unknown>;

export class CursorAdapter implements V2Adapter {
  id = "cursor";
  name = "Cursor";
  icon = "▌";

  private chatsDir: string;
  private globalStorageDbPath: string;
  private layer1Signatures = new Map<string, string>();
  private layer1ParentByChild = new Map<string, string>();
  private layer3Signatures = new Map<string, string>();

  constructor(options?: string | CursorAdapterOptions) {
    if (typeof options === "string") {
      this.chatsDir = options;
      this.globalStorageDbPath = defaultGlobalStorageDbPath();
      return;
    }

    this.chatsDir = options?.chatsDir ?? join(homedir(), ".cursor", "chats");
    this.globalStorageDbPath =
      options?.globalStorageDbPath ?? defaultGlobalStorageDbPath();
  }

  async detect(): Promise<boolean> {
    if (existsSync(this.globalStorageDbPath)) {
      return true;
    }

    return this.listLayer3Snapshots().length > 0;
  }

  async findChanged(hint?: ChangeHint): Promise<ConversationRef[]> {
    const changeKind = hint?.kind ?? "periodic-scan";
    const startupScan = changeKind === "startup-scan";
    const changedPaths = new Set(hint?.changedPaths ?? []);

    if (startupScan) {
      this.layer1Signatures.clear();
      this.layer1ParentByChild.clear();
      this.layer3Signatures.clear();
    }

    const refs = new Map<string, ConversationRef>();

    if (startupScan || this.shouldScanLayer1(changedPaths, changeKind)) {
      this.collectLayer1Changes(refs, startupScan);
    }

    if (startupScan || this.shouldScanLayer3(changedPaths, changeKind)) {
      this.collectLayer3Changes(refs, startupScan);
    }

    return Array.from(refs.values()).sort(sortConversationRefs);
  }

  async loadConversation(
    ref: ConversationRef,
  ): Promise<ConversationBundle | null> {
    if (!existsSync(ref.sourcePath)) {
      return null;
    }

    if (samePath(ref.sourcePath, this.globalStorageDbPath)) {
      return this.loadLayer1Conversation(ref);
    }

    return this.loadLayer3Conversation(ref);
  }

  watchPaths(): string[] {
    const paths = new Set<string>();

    if (existsSync(this.globalStorageDbPath)) {
      paths.add(dirname(this.globalStorageDbPath));
    }

    if (existsSync(this.chatsDir)) {
      paths.add(this.chatsDir);
    }

    return Array.from(paths.values());
  }

  // Legacy v1 shim retained inside the owned file so the packet stays isolated.
  async sessions(): Promise<Session[]> {
    const refs = await this.findChanged({ kind: "startup-scan" });
    const bundles = await Promise.all(
      refs.map((ref) => this.loadConversation(ref)),
    );

    return bundles
      .filter((bundle): bundle is ConversationBundle => bundle !== null)
      .map((bundle) => this.toLegacySession(bundle));
  }

  // Legacy v1 shim retained inside the owned file so the packet stays isolated.
  async messages(sessionId: string, sourcePath?: string): Promise<Message[]> {
    const ref = sourcePath
      ? { id: sessionId, sourcePath, adapterId: this.id }
      : this.findLegacyRef(sessionId);

    if (!ref) {
      return [];
    }

    const bundle = await this.loadConversation(ref);
    if (!bundle) {
      return [];
    }

    return bundle.messages.map((message) => this.toLegacyMessage(message));
  }

  private shouldScanLayer1(
    changedPaths: Set<string>,
    changeKind: ChangeHint["kind"],
  ): boolean {
    if (changeKind === "periodic-scan") {
      return true;
    }

    if (changedPaths.size === 0) {
      return existsSync(this.globalStorageDbPath);
    }

    return Array.from(changedPaths).some((changedPath) =>
      pathTouches(changedPath, this.globalStorageDbPath),
    );
  }

  private shouldScanLayer3(
    changedPaths: Set<string>,
    changeKind: ChangeHint["kind"],
  ): boolean {
    if (changeKind === "periodic-scan") {
      return true;
    }

    if (changedPaths.size === 0) {
      return existsSync(this.chatsDir);
    }

    return Array.from(changedPaths).some((changedPath) =>
      pathTouches(changedPath, this.chatsDir),
    );
  }

  private collectLayer1Changes(
    refs: Map<string, ConversationRef>,
    startupScan: boolean,
  ): void {
    const snapshots = this.listLayer1Snapshots();
    const nextSignatures = new Map<string, string>();
    const nextParents = buildLayer1ParentMap(snapshots);

    for (const snapshot of snapshots) {
      const signature = stableJson({
        updatedAt: snapshot.updatedAt,
        bubbleIds: snapshot.bubbleIds,
        subagentIds: snapshot.subagentIds,
        name: snapshot.name,
        model: snapshot.model,
      });

      nextSignatures.set(snapshot.id, signature);

      if (startupScan || this.layer1Signatures.get(snapshot.id) !== signature) {
        refs.set(snapshot.id, this.makeRef(snapshot.id, snapshot.sourcePath));
      }
    }

    for (const [childId, parentId] of Array.from(nextParents.entries())) {
      if (startupScan) {
        continue;
      }

      if (this.layer1ParentByChild.get(childId) !== parentId) {
        refs.set(childId, this.makeRef(childId, this.globalStorageDbPath));
      }
    }

    this.layer1Signatures = nextSignatures;
    this.layer1ParentByChild = nextParents;
  }

  private collectLayer3Changes(
    refs: Map<string, ConversationRef>,
    startupScan: boolean,
  ): void {
    const snapshots = this.listLayer3Snapshots();
    const nextSignatures = new Map<string, string>();

    for (const snapshot of snapshots) {
      const stat = safeStat(snapshot.sourcePath);
      const signature = `${snapshot.id}:${stat?.mtimeMs ?? 0}:${stat?.size ?? 0}`;
      nextSignatures.set(snapshot.sourcePath, signature);

      if (
        startupScan ||
        this.layer3Signatures.get(snapshot.sourcePath) !== signature
      ) {
        refs.set(snapshot.id, this.makeRef(snapshot.id, snapshot.sourcePath));
      }
    }

    this.layer3Signatures = nextSignatures;
  }

  private listLayer1Snapshots(): Layer1Snapshot[] {
    if (!existsSync(this.globalStorageDbPath)) {
      return [];
    }

    const db = this.openReadonlyDb(this.globalStorageDbPath);
    if (!db) {
      return [];
    }

    try {
      const rows = db
        .query(
          "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'",
        )
        .all() as Array<{ key: string; value: unknown }>;

      const snapshots: Layer1Snapshot[] = [];
      for (const row of rows) {
        const id = row.key.slice("composerData:".length);
        const parsed = parseJsonObject(row.value);
        if (!parsed) {
          continue;
        }

        const createdAt = normalizeTimestamp(parsed.createdAt);
        const updatedAt =
          normalizeTimestamp(
            parsed.lastUpdatedAt ?? parsed.updatedAt ?? parsed.createdAt,
          ) || createdAt;
        const bubbleIds = extractBubbleIds(parsed.fullConversationHeadersOnly);
        const subagentIds = extractStringArray(parsed.subagentComposerIds);
        const model = getString((parsed.modelConfig as JsonObject | undefined)?.modelName);

        snapshots.push({
          id,
          sourcePath: this.globalStorageDbPath,
          createdAt,
          updatedAt,
          name: getString(parsed.name),
          model,
          bubbleIds,
          subagentIds,
          metadata: parsed,
        });
      }

      return snapshots.sort((a, b) =>
        a.id === b.id ? 0 : a.id < b.id ? -1 : 1,
      );
    } catch (error) {
      logCursorWarning("Failed to list Layer 1 composer snapshots", error);
      return [];
    } finally {
      db.close();
    }
  }

  private readLayer1ComposerData(id: string): Layer1ComposerData | null {
    if (!existsSync(this.globalStorageDbPath)) {
      return null;
    }

    const db = this.openReadonlyDb(this.globalStorageDbPath);
    if (!db) {
      return null;
    }

    try {
      const composerRow = db
        .query("SELECT value FROM cursorDiskKV WHERE key = ?")
        .get(`composerData:${id}`) as { value?: unknown } | null;

      const composer = parseJsonObject(composerRow?.value);
      if (!composer) {
        return null;
      }

      const createdAt = normalizeTimestamp(composer.createdAt);
      const updatedAt =
        normalizeTimestamp(
          composer.lastUpdatedAt ?? composer.updatedAt ?? composer.createdAt,
        ) || createdAt;
      const bubbleIds = extractBubbleIds(composer.fullConversationHeadersOnly);
      const bubbleRows = db
        .query("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?")
        .all(`bubbleId:${id}:%`) as Array<{ key: string; value: unknown }>;
      const bubblesById = new Map<string, Layer1Bubble>();

      for (const row of bubbleRows) {
        const bubbleId = row.key.slice(`bubbleId:${id}:`.length);
        const bubble = parseJsonObject(row.value);
        if (!bubble) {
          continue;
        }

        bubblesById.set(bubbleId, {
          bubbleId,
          type: getNumber(bubble.type),
          text: getString(bubble.text),
          createdAt: normalizeTimestamp(bubble.createdAt),
          tokenCount: {
            inputTokens: getNumber(
              (bubble.tokenCount as JsonObject | undefined)?.inputTokens,
            ),
            outputTokens: getNumber(
              (bubble.tokenCount as JsonObject | undefined)?.outputTokens,
            ),
          },
          toolFormerData: parseToolFormerData(bubble.toolFormerData),
        });
      }

      const orderedBubbleIds =
        bubbleIds.length > 0 ? bubbleIds : Array.from(bubblesById.keys()).sort();

      return {
        id,
        sourcePath: this.globalStorageDbPath,
        createdAt,
        updatedAt,
        name: getString(composer.name),
        model: getString((composer.modelConfig as JsonObject | undefined)?.modelName),
        bubbleIds: orderedBubbleIds,
        subagentIds: extractStringArray(composer.subagentComposerIds),
        metadata: composer,
        raw: composer,
        bubbles: orderedBubbleIds
          .map((bubbleId) => bubblesById.get(bubbleId))
          .filter((bubble): bubble is Layer1Bubble => bubble !== undefined),
      };
    } catch (error) {
      logCursorWarning(`Failed to read Layer 1 conversation ${id}`, error);
      return null;
    } finally {
      db.close();
    }
  }

  private loadLayer1Conversation(
    ref: ConversationRef,
  ): ConversationBundle | null {
    const composer = this.readLayer1ComposerData(ref.id);
    if (!composer) {
      return null;
    }

    const relationship = this.resolveLayer1Relationship(ref.id);
    const parentId = this.resolveLayer1ParentId(ref.id);
    const traceId = this.resolveLayer1TraceId(ref.id);
    let currentTurn = -1;
    const messages: ParsedMessage[] = composer.bubbles.map((bubble, sequence) => {
      const timestamp =
        bubble.createdAt || composer.updatedAt || composer.createdAt;
      const role: "user" | "assistant" =
        bubble.type === 1 ? "user" : "assistant";
      const turn = nextTurnNumber(currentTurn, role);
      currentTurn = turn;
      const toolUses = buildLayer1ToolUses(ref.id, bubble, sequence);

      return {
        id: bubble.bubbleId,
        role,
        content: bubble.text,
        recordType: "",
        model: composer.model,
        sequence,
        turn,
        isSidechain: false,
        parentMessageId:
          sequence > 0 ? composer.bubbles[sequence - 1]?.bubbleId ?? "" : "",
        inputTokens: bubble.tokenCount.inputTokens,
        outputTokens: bubble.tokenCount.outputTokens,
        cacheRead: 0,
        cacheWrite: 0,
        thinkingContent: "",
        thinkingTokens: 0,
        timestamp,
        toolUses,
      };
    });

    const conversationName = pickConversationName(
      composer.name,
      messages,
      ref.id,
    );
    const startedAt =
      messages[0]?.timestamp || composer.createdAt || composer.updatedAt;
    const updatedAt =
      messages[messages.length - 1]?.timestamp ||
      composer.updatedAt ||
      composer.createdAt;
    const cwd = resolveCursorCwd(composer.raw);
    const conversation: ParsedConversation = {
      id: ref.id,
      traceId,
      parentId,
      relationship,
      forkPoint:
        relationship === "spawned"
          ? this.findLayer1ForkPoint(parentId, ref.id)
          : -1,
      name: conversationName,
      adapterId: this.id,
      cwd,
      gitRemote: "",
      branch: "",
      model: composer.model,
      startedAt,
      endedAt: updatedAt,
      sourcePath: composer.sourcePath,
      sourceFormat: "sqlite",
    };

    return { conversation, messages };
  }

  private resolveLayer1Relationship(id: string): ConversationRelationship {
    return this.resolveLayer1ParentId(id) ? "spawned" : "root";
  }

  private resolveLayer1ParentId(id: string): string {
    const parentId = this.layer1ParentByChild.get(id);
    if (parentId) {
      return parentId;
    }

    const parentMap = buildLayer1ParentMap(this.listLayer1Snapshots());
    this.layer1ParentByChild = parentMap;
    return parentMap.get(id) ?? "";
  }

  private resolveLayer1TraceId(id: string): string {
    const parentMap =
      this.layer1ParentByChild.size > 0
        ? this.layer1ParentByChild
        : buildLayer1ParentMap(this.listLayer1Snapshots());
    this.layer1ParentByChild = parentMap;

    let currentId = id;
    const seen = new Set<string>();

    while (parentMap.has(currentId) && !seen.has(currentId)) {
      seen.add(currentId);
      currentId = parentMap.get(currentId) ?? currentId;
    }

    return currentId;
  }

  private findLayer1ForkPoint(parentId: string, childId: string): number {
    if (!parentId) {
      return -1;
    }

    const parent = this.readLayer1ComposerData(parentId);
    if (!parent) {
      return -1;
    }

    for (let index = 0; index < parent.bubbles.length; index += 1) {
      const toolFormerData = parent.bubbles[index]?.toolFormerData;
      if (!toolFormerData) {
        continue;
      }

      const result = asJsonObject(toolFormerData.result);
      const additionalData = asJsonObject(toolFormerData.additionalData);
      const spawnedId =
        getString(result?.agentId) ||
        getString(additionalData?.subagentComposerId);

      if (spawnedId === childId) {
        return index;
      }
    }

    return -1;
  }

  private listLayer3Snapshots(): Layer3Snapshot[] {
    if (!existsSync(this.chatsDir)) {
      return [];
    }

    const snapshots: Layer3Snapshot[] = [];
    for (const workspace of safeReadDir(this.chatsDir)) {
      const workspacePath = join(this.chatsDir, workspace);
      if (!isDirectory(workspacePath)) {
        continue;
      }

      for (const sessionDirName of safeReadDir(workspacePath)) {
        const sessionDir = join(workspacePath, sessionDirName);
        const dbPath = join(sessionDir, "store.db");
        if (!existsSync(dbPath)) {
          continue;
        }

        const meta = this.readLayer3Meta(dbPath, workspace);
        if (!meta) {
          continue;
        }

        snapshots.push(meta);
      }
    }

    return snapshots.sort((a, b) =>
      a.id === b.id ? 0 : a.id < b.id ? -1 : 1,
    );
  }

  private readLayer3Meta(
    dbPath: string,
    workspace: string,
  ): Layer3Meta | null {
    const db = this.openReadonlyDb(dbPath);
    if (!db) {
      return null;
    }

    try {
      const row = db
        .query("SELECT value FROM meta WHERE key = '0'")
        .get() as { value?: unknown } | null;
      if (!row?.value) {
        return null;
      }

      const decoded = decodeHexJsonObject(row.value);
      if (!decoded) {
        return null;
      }

      const stat = safeStat(dbPath);
      const createdAt = normalizeTimestamp(decoded.createdAt);
      const updatedAt =
        stat?.mtime.toISOString() ?? createdAt ?? new Date(0).toISOString();
      const id = getString(decoded.agentId) || basenameWithoutStoreDb(dbPath);

      return {
        id,
        sourcePath: dbPath,
        createdAt,
        updatedAt,
        workspace,
        latestRootBlobId: getString(decoded.latestRootBlobId),
        name: getString(decoded.name),
        raw: decoded,
      };
    } catch (error) {
      logCursorWarning(`Failed to read Layer 3 meta from ${dbPath}`, error);
      return null;
    } finally {
      db.close();
    }
  }

  private loadLayer3Conversation(
    ref: ConversationRef,
  ): ConversationBundle | null {
    const meta = this.readLayer3Meta(
      ref.sourcePath,
      workspaceFromDbPath(ref.sourcePath),
    );
    if (!meta) {
      return null;
    }

    const nodes = this.readLayer3Nodes(ref.sourcePath, meta.latestRootBlobId);
    if (nodes.length === 0) {
      return null;
    }

    const messages: ParsedMessage[] = [];
    let currentTurn = -1;

    for (const node of nodes) {
      const role = normalizeLayer3Role(getString(node.raw.role));
      const extracted = extractLayer3Content(ref.id, node.id, node.raw.content);
      applyLayer3ToolResults(messages, extracted.toolResults);

      if (extracted.content.length === 0 && extracted.toolUses.length === 0) {
        continue;
      }

      const timestamp =
        normalizeTimestamp(node.raw.createdAt) ||
        meta.createdAt ||
        meta.updatedAt;
      const turn = nextTurnNumber(currentTurn, role);
      currentTurn = turn;
      const sequence = messages.length;

      messages.push({
        id: buildLayer3MessageId(ref.id, node.id),
        role,
        content: extracted.content,
        recordType: "",
        model: getString(node.raw.model) || getString(meta.raw.model),
        sequence,
        turn,
        isSidechain: false,
        parentMessageId: sequence > 0 ? messages[sequence - 1]?.id ?? "" : "",
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        thinkingContent: extracted.thinkingContent,
        thinkingTokens: extracted.thinkingTokens,
        timestamp,
        toolUses: extracted.toolUses,
      });
    }

    if (messages.length === 0) {
      return null;
    }

    const conversationName = pickConversationName(meta.name, messages, ref.id);
    const startedAt = meta.createdAt || meta.updatedAt;
    const updatedAt =
      messages[messages.length - 1]?.timestamp || meta.updatedAt || startedAt;
    const cwd = resolveCursorCwd(meta.raw);
    const conversation: ParsedConversation = {
      id: ref.id,
      traceId: ref.id,
      parentId: "",
      relationship: "root",
      forkPoint: -1,
      adapterId: this.id,
      name: conversationName,
      cwd,
      gitRemote: "",
      branch: "",
      model: getString(meta.raw.model),
      startedAt,
      endedAt: updatedAt,
      sourcePath: ref.sourcePath,
      sourceFormat: "sqlite",
    };

    return { conversation, messages };
  }

  private readLayer3Nodes(dbPath: string, rootId: string): Layer3Node[] {
    if (!rootId) {
      return [];
    }

    const db = this.openReadonlyDb(dbPath);
    if (!db) {
      return [];
    }

    try {
      const rows = db
        .query("SELECT id, data FROM blobs")
        .all() as Array<{ id: string; data: unknown }>;
      const knownIds = new Set(rows.map((row) => row.id));
      const blobs = new Map<string, Layer3Blob>();

      for (const row of rows) {
        const bytes = toBlobBytes(row.data);
        if (!bytes) {
          continue;
        }

        blobs.set(row.id, {
          bytes,
          parsed: parseJsonObject(bytes),
        });
      }

      return collectLayer3Nodes(rootId, blobs, knownIds);
    } catch (error) {
      logCursorWarning(`Failed to read Layer 3 blobs from ${dbPath}`, error);
      return [];
    } finally {
      db.close();
    }
  }

  private findLegacyRef(sessionId: string): ConversationRef | null {
    if (existsSync(this.globalStorageDbPath)) {
      const composer = this.readLayer1ComposerData(sessionId);
      if (composer) {
        return this.makeRef(sessionId, this.globalStorageDbPath);
      }
    }

    for (const snapshot of this.listLayer3Snapshots()) {
      if (
        snapshot.id === sessionId ||
        basenameWithoutStoreDb(snapshot.sourcePath) === sessionId
      ) {
        return this.makeRef(snapshot.id, snapshot.sourcePath);
      }
    }

    return null;
  }

  private makeRef(id: string, sourcePath: string): ConversationRef {
    return {
      id,
      sourcePath,
      adapterId: this.id,
    };
  }

  private toLegacySession(bundle: ConversationBundle): Session {
    const conversation = bundle.conversation;
    const totals = sumMessageTokens(bundle.messages);

    return {
      id: conversation.id,
      name: conversation.name || conversation.id,
      adapterId: this.id,
      adapterName: this.name,
      createdAt: conversation.startedAt,
      updatedAt: conversation.endedAt,
      durationMs: durationMs(conversation.startedAt, conversation.endedAt),
      isActive: false,
      totalTokens: totals.total,
      estCost: 0,
      messageCount: bundle.messages.length,
      sourcePath: conversation.sourcePath,
      isSubAgent: conversation.relationship === "spawned",
      parentSessionId: conversation.parentId,
      isCompacted: conversation.relationship === "compacted",
      metadata: {
        traceId: conversation.traceId,
        relationship: conversation.relationship,
        forkPoint: conversation.forkPoint,
        sourceFormat: conversation.sourceFormat,
        model: conversation.model,
        cwd: conversation.cwd,
      },
    };
  }

  private toLegacyMessage(message: ParsedMessage): Message {
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
      toolUses: message.toolUses.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
        output: toolCall.output,
      })),
      thinkingBlocks: message.thinkingContent
        ? [
            {
              content: message.thinkingContent,
              tokenCount: message.thinkingTokens,
            },
          ]
        : [],
      recordType: message.recordType,
    };
  }

  private openReadonlyDb(dbPath: string): Database | null {
    try {
      return new Database(dbPath, { readonly: true });
    } catch (error) {
      logCursorWarning(`Failed to open SQLite database ${dbPath}`, error);
      return null;
    }
  }
}

function defaultGlobalStorageDbPath(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }

  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(home, "AppData", "Roaming"),
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }

  return join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

function parseJsonObject(value: unknown): JsonObject | null {
  try {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string") {
      const parsed = JSON.parse(value);
      return asJsonObject(parsed);
    }

    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      const parsed = JSON.parse(Buffer.from(value).toString("utf-8"));
      return asJsonObject(parsed);
    }

    return asJsonObject(value);
  } catch {
    return null;
  }
}

function toBlobBytes(value: unknown): Uint8Array | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (typeof value === "string") {
    return Buffer.from(value, "utf-8");
  }

  return null;
}

function decodeHexJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, "hex").toString("utf-8");
    return asJsonObject(JSON.parse(decoded));
  } catch {
    return null;
  }
}

function asJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
}

function parseToolFormerData(value: unknown): JsonObject | null {
  const parsed = parseJsonObject(value);
  return parsed && Object.keys(parsed).length > 0 ? parsed : null;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return "";
}

function extractBubbleIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of value) {
    const bubbleId = getString((entry as JsonObject | undefined)?.bubbleId);
    if (bubbleId) {
      ids.push(bubbleId);
    }
  }

  return ids;
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => getString(item))
    .filter((item): item is string => item.length > 0);
}

function buildLayer1ParentMap(
  snapshots: Layer1Snapshot[],
): Map<string, string> {
  const parentByChild = new Map<string, string>();
  for (const snapshot of snapshots) {
    for (const childId of snapshot.subagentIds) {
      parentByChild.set(childId, snapshot.id);
    }
  }

  return parentByChild;
}

function buildLayer1ToolUses(
  conversationId: string,
  bubble: Layer1Bubble,
  sequence: number,
): ParsedToolCall[] {
  if (!bubble.toolFormerData) {
    return [];
  }

  const toolName = getString(bubble.toolFormerData.name);
  if (!toolName) {
    return [];
  }

  const rawArgs =
    bubble.toolFormerData.rawArgs ??
    bubble.toolFormerData.params ??
    bubble.toolFormerData.input ??
    {};
  const result =
    bubble.toolFormerData.result ??
    bubble.toolFormerData.additionalData ??
    bubble.toolFormerData.status ??
    "";

  return [
    {
      id: `${conversationId}:${bubble.bubbleId}:tool:${sequence}`,
      name: toolName,
      input: stableJson(rawArgs),
      output: stableJson(result),
      timestamp: bubble.createdAt,
      isError: bubble.toolFormerData.status === "failed",
      durationMs: -1,
    },
  ];
}

function extractLayer3Content(
  conversationId: string,
  messageId: string,
  content: unknown,
): {
  content: string;
  toolUses: ParsedToolCall[];
  toolResults: Layer3ToolResult[];
  thinkingContent: string;
  thinkingTokens: number;
} {
  if (typeof content === "string") {
    return {
      content,
      toolUses: [],
      toolResults: [],
      thinkingContent: "",
      thinkingTokens: 0,
    };
  }

  if (!Array.isArray(content)) {
    return {
      content: stableJson(content),
      toolUses: [],
      toolResults: [],
      thinkingContent: "",
      thinkingTokens: 0,
    };
  }

  const textParts: string[] = [];
  const toolUses: ParsedToolCall[] = [];
  const toolResults: Layer3ToolResult[] = [];
  const thinkingParts: string[] = [];

  for (const block of content) {
    const json = asJsonObject(block);
    if (!json) {
      continue;
    }

    const type = getString(json.type);
    const text = getString(json.text);

    if (type === "text") {
      if (text) {
        textParts.push(text);
      }
      continue;
    }

    if (type === "reasoning") {
      if (text) {
        textParts.push(text);
        thinkingParts.push(text);
      }
      continue;
    }

    if (type === "tool-call" || type === "tool_use") {
      const toolName = getString(json.toolName) || getString(json.name);
      const toolCallId = buildLayer3ToolUseId(
        conversationId,
        messageId,
        toolUses.length,
        getString(json.toolCallId),
      );
      const toolUse: ParsedToolCall = {
        id: toolCallId,
        name: toolName || `tool_${toolUses.length}`,
        input: stableJson(json.args ?? json.input ?? {}),
        output: "",
        timestamp: "",
        durationMs: -1,
        isError: false,
      };
      toolUses.push(toolUse);
      continue;
    }

    if (type === "tool-result" || type === "tool_result") {
      const toolCallId = buildLayer3ExternalToolCallId(
        conversationId,
        getString(json.toolCallId),
      );
      const toolName = getString(json.toolName) || getString(json.name);
      const output = stableJson(json.result ?? json.output ?? "");
      const target =
        Array.from(toolUses)
          .reverse()
          .find(
            (toolCall) =>
              (toolCallId && toolCall.id === toolCallId) ||
              toolCall.name === toolName ||
              !toolName,
          ) ??
        toolUses[toolUses.length - 1];
      if (target) {
        target.output = output;
        target.isError = target.isError || json.isError === true;
      } else {
        toolResults.push({
          toolCallId,
          toolName,
          output,
          isError: json.isError === true,
        });
      }
      continue;
    }

    if (text) {
      textParts.push(text);
    }
  }

  return {
    content: textParts.join("\n"),
    toolUses,
    toolResults,
    thinkingContent: thinkingParts.join("\n"),
    thinkingTokens: 0,
  };
}

function buildLayer3MessageId(
  conversationId: string,
  blobId: string,
): string {
  return `${conversationId}:${blobId}`;
}

function buildLayer3ExternalToolCallId(
  conversationId: string,
  toolCallId: string,
): string {
  return toolCallId ? `${conversationId}:${toolCallId}` : "";
}

function buildLayer3ToolUseId(
  conversationId: string,
  messageId: string,
  index: number,
  toolCallId: string,
): string {
  return (
    buildLayer3ExternalToolCallId(conversationId, toolCallId) ||
    `${conversationId}:${messageId}:tool:${index}`
  );
}

function collectLayer3Nodes(
  rootId: string,
  blobs: Map<string, Layer3Blob>,
  knownIds: Set<string>,
  seen = new Set<string>(),
): Layer3Node[] {
  if (!rootId || seen.has(rootId)) {
    return [];
  }

  const blob = blobs.get(rootId);
  if (!blob) {
    return [];
  }

  seen.add(rootId);

  if (blob.parsed) {
    const parentId = getString(blob.parsed.parentId);
    const parentNodes = parentId
      ? collectLayer3Nodes(parentId, blobs, knownIds, seen)
      : [];
    return parentNodes.concat({ id: rootId, raw: blob.parsed });
  }

  const refs = extractLayer3BlobRefs(blob.bytes, knownIds);
  if (refs.length === 0) {
    return [];
  }

  return refs.flatMap((ref) => collectLayer3Nodes(ref, blobs, knownIds, seen));
}

function extractLayer3BlobRefs(
  blob: Uint8Array,
  knownIds: Set<string>,
): string[] {
  const refs: string[] = [];

  for (let index = 0; index <= blob.length - 34; index += 1) {
    const tag = blob[index];
    const length = blob[index + 1];
    if ((tag & 0x07) !== 2 || length !== 0x20) {
      continue;
    }

    const ref = Buffer.from(blob.slice(index + 2, index + 34)).toString("hex");
    if (knownIds.has(ref)) {
      refs.push(ref);
    }
  }

  return refs;
}

function applyLayer3ToolResults(
  messages: ParsedMessage[],
  toolResults: Layer3ToolResult[],
): void {
  for (const toolResult of toolResults) {
    const target = findLayer3ToolUse(messages, toolResult);
    if (!target) {
      continue;
    }

    target.output = toolResult.output;
    target.isError = target.isError || toolResult.isError;
  }
}

function findLayer3ToolUse(
  messages: ParsedMessage[],
  toolResult: Layer3ToolResult,
): ParsedToolCall | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const toolUses = messages[messageIndex]?.toolUses ?? [];
    for (let toolIndex = toolUses.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const toolUse = toolUses[toolIndex];
      if (toolResult.toolCallId && toolUse.id === toolResult.toolCallId) {
        return toolUse;
      }

      if (toolResult.toolName && toolUse.name === toolResult.toolName) {
        return toolUse;
      }
    }
  }

  return null;
}

function normalizeLayer3Role(
  role: string,
): "user" | "assistant" | "system" {
  if (role === "user") {
    return "user";
  }

  if (role === "system") {
    return "system";
  }

  return "assistant";
}

function pickConversationName(
  storedName: string,
  messages: ParsedMessage[],
  fallbackId: string,
): string {
  if (storedName && storedName !== "New Agent") {
    return storedName;
  }

  const firstUserMessage = messages.find(
    (message) => message.role === "user" && message.content.length > 0,
  );
  if (firstUserMessage) {
    return firstUserMessage.content.slice(0, 80);
  }

  return fallbackId.slice(0, 8);
}

function sumMessageTokens(messages: ParsedMessage[]): {
  input: number;
  output: number;
  total: number;
} {
  let input = 0;
  let output = 0;
  for (const message of messages) {
    input += message.inputTokens;
    output += message.outputTokens;
  }

  return {
    input,
    output,
    total: input + output,
  };
}

function durationMs(startedAt: string, updatedAt: string): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(updatedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }

  return Math.max(0, end - start);
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nextTurnNumber(
  currentTurn: number,
  role: ParsedMessage["role"],
): number {
  if (role === "user") {
    return currentTurn + 1;
  }

  return currentTurn < 0 ? 0 : currentTurn;
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function workspaceFromDbPath(dbPath: string): string {
  return basename(dirname(dirname(dbPath)));
}

function basenameWithoutStoreDb(dbPath: string): string {
  return basename(dirname(dbPath));
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, stableObjectKeys);
  } catch {
    return String(value);
  }
}

function resolveCursorCwd(raw: JsonObject): string {
  // Cursor storage varies by layer and often omits cwd entirely, so try a few
  // common keys and leave the field empty when the source truly lacks it.
  const candidates = [
    raw.cwd,
    raw.workingDirectory,
    raw.workspacePath,
    raw.workspaceRoot,
    raw.projectPath,
    raw.path,
  ];

  for (const candidate of candidates) {
    const cwd = getString(candidate);
    if (cwd) {
      return cwd;
    }
  }

  return "";
}

function logCursorWarning(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[cursor adapter] ${message}: ${detail}`);
}

function stableObjectKeys(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as JsonObject)
      .sort()
      .reduce<JsonObject>((result, key) => {
        result[key] = (value as JsonObject)[key];
        return result;
      }, {});
  }

  return value;
}

function pathTouches(changedPath: string, targetPath: string): boolean {
  return samePath(changedPath, targetPath) || changedPath.startsWith(targetPath);
}

function samePath(left: string, right: string): boolean {
  return left === right;
}

function sortConversationRefs(left: ConversationRef, right: ConversationRef): number {
  if (left.sourcePath === right.sourcePath) {
    return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
  }

  return left.sourcePath < right.sourcePath ? -1 : 1;
}
