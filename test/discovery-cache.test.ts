import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code";
import { CodexAdapter } from "../src/adapters/codex";
import { CursorAdapter } from "../src/adapters/cursor";
import type { ConversationBundle, ConversationRef } from "../src/contracts/conversations";
import { openStoreAtPath } from "../src/db/store";
import {
  SqliteDiscoveryCache,
  type DiscoveryCacheRunSummary,
} from "../src/db/discovery-cache";
import { ingestOne } from "../src/pipeline/ingest";

const SIMPLE_CODEX_FIXTURE = join(
  process.cwd(),
  "test/fixtures/codex/2026-02-21T12-48-43-testcodex.jsonl",
);

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

test("durable discovery cache warms Claude startup discovery across adapter restart", async () => {
  const fixture = {
    projectsDir: join(process.cwd(), "test", "fixtures", "claude-code"),
  };
  const cache = makeDiscoveryCache("claude");
  const config = { enabled: true, dataDir: fixture.projectsDir };

  const coldAdapter = new ClaudeCodeAdapter({ projectsDir: fixture.projectsDir });
  const coldRefs = await coldAdapter.findChanged({ kind: "startup-scan" });
  expect(coldRefs).toHaveLength(1);
  saveState(cache, coldAdapter, config);

  const warmAdapter = new ClaudeCodeAdapter({ projectsDir: fixture.projectsDir });
  hydrateState(cache, warmAdapter, config);
  expect(await warmAdapter.findChanged({ kind: "startup-scan" })).toEqual([]);
});

test("durable discovery cache warms Codex startup discovery across adapter restart", async () => {
  const codexHome = makeCodexHome();
  const cache = makeDiscoveryCache("codex");
  const config = { enabled: true, dataDir: codexHome };

  const coldAdapter = new CodexAdapter(codexHome);
  const coldRefs = await coldAdapter.findChanged({ kind: "startup-scan" });
  expect(coldRefs).toHaveLength(1);
  saveState(cache, coldAdapter, config);

  const warmAdapter = new CodexAdapter(codexHome);
  hydrateState(cache, warmAdapter, config);
  expect(await warmAdapter.findChanged({ kind: "startup-scan" })).toEqual([]);
});

test("durable discovery cache warms Cursor startup discovery across adapter restart", async () => {
  const cursorHome = makeCursorHome();
  const cache = makeDiscoveryCache("cursor");
  const config = {
    enabled: true,
    allowProtectedSource: true,
    dataDir: cursorHome.stateDbPath,
  };

  const coldAdapter = new CursorAdapter({
    chatsDir: join(cursorHome.root, "chats"),
    globalStorageDbPath: cursorHome.stateDbPath,
  });
  const coldRefs = await coldAdapter.findChanged({ kind: "startup-scan" });
  expect(coldRefs).toHaveLength(1);
  saveState(cache, coldAdapter, config);

  const warmAdapter = new CursorAdapter({
    chatsDir: join(cursorHome.root, "chats"),
    globalStorageDbPath: cursorHome.stateDbPath,
  });
  hydrateState(cache, warmAdapter, config);
  expect(await warmAdapter.findChanged({ kind: "startup-scan" })).toEqual([]);
});

test("startup-scan ignores warm discovery cache when the local store is empty", async () => {
  const codexHome = makeCodexHome();
  const cache = makeDiscoveryCache("store-bootstrap");
  const config = { enabled: true, dataDir: codexHome };
  const adapter = new CodexAdapter(codexHome);
  const primedRefs = await adapter.findChanged({ kind: "startup-scan" });
  expect(primedRefs).toHaveLength(1);
  saveState(cache, adapter, config);

  const freshStoreDir = mkdtempSync(join(tmpdir(), "jin-discovery-store-"));
  const freshStore = openStoreAtPath(join(freshStoreDir, "store.db"));
  cleanups.push(() => {
    freshStore.close();
    rmSync(freshStoreDir, { recursive: true, force: true });
  });

  const trapAdapter = new CodexAdapter(codexHome);
  const result = await ingestOne(
    trapAdapter,
    freshStore,
    { kind: "startup-scan" },
    {
      discoveryCache: {
        store: cache,
        adapterConfigs: {
          codex: config,
        },
      },
    },
  );

  expect(result.scannedRefCount).toBe(1);
  expect(result.loadedConversationCount).toBe(1);
  expect(result.anyChanged).toBe(true);
});

test("load failures do not advance the durable discovery cache", async () => {
  const codexHome = makeCodexHome();
  const cache = makeDiscoveryCache("load-failure");
  const config = { enabled: true, dataDir: codexHome };
  const failingStoreDir = mkdtempSync(join(tmpdir(), "jin-discovery-failure-"));
  const failingStore = openStoreAtPath(join(failingStoreDir, "store.db"));
  cleanups.push(() => {
    failingStore.close();
    rmSync(failingStoreDir, { recursive: true, force: true });
  });

  const failingAdapter = new CodexAdapter(codexHome);
  failingAdapter.loadConversation = async () => {
    throw new Error("boom");
  };

  const failed = await ingestOne(
    failingAdapter,
    failingStore,
    { kind: "startup-scan" },
    {
      discoveryCache: {
        store: cache,
        adapterConfigs: {
          codex: config,
        },
      },
    },
  );
  expect(failed.loadedConversationCount).toBe(0);

  const probe = new CodexAdapter(codexHome);
  const loaded = cache.loadForAdapter(probe, config);
  expect(loaded.cachedSources).toBe(0);
  expect(loaded.state?.sources ?? []).toEqual([]);
});

test("Codex cache survives ingest lifecycle and suppresses immediate periodic replay", async () => {
  const codexHome = makeCodexHome();
  const cache = makeDiscoveryCache("codex-lifecycle");
  const config = { enabled: true, dataDir: codexHome };
  const storeDir = mkdtempSync(join(tmpdir(), "jin-discovery-codex-store-"));
  const store = openStoreAtPath(join(storeDir, "store.db"));
  cleanups.push(() => {
    store.close();
    rmSync(storeDir, { recursive: true, force: true });
  });

  const startup = await ingestOne(
    new CodexAdapter(codexHome),
    store,
    { kind: "startup-scan" },
    {
      discoveryCache: {
        store: cache,
        adapterConfigs: {
          codex: config,
        },
      },
    },
  );
  expect(startup.scannedRefCount).toBe(1);
  expect(startup.loadedConversationCount).toBe(1);

  const periodic = await ingestOne(
    new CodexAdapter(codexHome),
    store,
    { kind: "periodic-scan" },
    {
      discoveryCache: {
        store: cache,
        adapterConfigs: {
          codex: config,
        },
      },
    },
  );
  expect(periodic.scannedRefCount).toBe(0);
  expect(periodic.loadedConversationCount).toBe(0);
  expect(periodic.anyChanged).toBe(false);
});

test("partial load failures only exclude failed source paths from persisted cache", async () => {
  const cache = makeDiscoveryCache("partial-failure");
  const config = { enabled: true, dataDir: "/tmp/fake-codex" };
  const storeDir = mkdtempSync(join(tmpdir(), "jin-discovery-partial-store-"));
  const store = openStoreAtPath(join(storeDir, "store.db"));
  cleanups.push(() => {
    store.close();
    rmSync(storeDir, { recursive: true, force: true });
  });

  const startup = await ingestOne(
    new PartialFailureDiscoveryAdapter(),
    store,
    { kind: "startup-scan" },
    {
      discoveryCache: {
        store: cache,
        adapterConfigs: {
          codex: config,
        },
      },
    },
  );
  expect(startup.scannedRefCount).toBe(2);
  expect(startup.loadedConversationCount).toBe(1);

  const periodic = await ingestOne(
    new PartialFailureDiscoveryAdapter(),
    store,
    { kind: "periodic-scan" },
    {
      discoveryCache: {
        store: cache,
        adapterConfigs: {
          codex: config,
        },
      },
    },
  );
  expect(periodic.scannedRefCount).toBe(1);
  expect(periodic.loadedConversationCount).toBe(0);

  const probe = new PartialFailureDiscoveryAdapter();
  const loaded = cache.loadForAdapter(probe, config);
  expect(loaded.cachedSources).toBe(1);
  expect(loaded.state?.sources.map((source) => source.sourcePath)).toEqual([
    PartialFailureDiscoveryAdapter.okRef.sourcePath,
  ]);
});

function makeCodexHome(): string {
  const root = mkdtempSync(join(tmpdir(), "jin-discovery-codex-"));
  const filePath = join(root, "sessions", "2026", "02", "21", "cache-test.jsonl");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${readFileSync(SIMPLE_CODEX_FIXTURE, "utf8").trim()}\n`, "utf8");
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeCursorHome(): { root: string; stateDbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "jin-discovery-cursor-"));
  const stateDbPath = join(root, "state.vscdb");
  const db = new Database(stateDbPath);
  db.run("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
  db.run("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)", [
    "composerData:cursor-cache-session",
    JSON.stringify({
      name: "Cursor Cache Session",
      createdAt: "2026-04-02T00:00:00.000Z",
      lastUpdatedAt: "2026-04-02T00:00:30.000Z",
      modelConfig: { modelName: "cursor-cache-test" },
      subagentComposerIds: [],
      fullConversationHeadersOnly: [
        { bubbleId: "user-1", type: 1 },
        { bubbleId: "assistant-1", type: 2 },
      ],
    }),
  ]);
  db.run("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)", [
    "bubbleId:cursor-cache-session:user-1",
    JSON.stringify({
      type: 1,
      text: "Inspect the adapter",
      createdAt: "2026-04-02T00:00:00.000Z",
      tokenCount: { inputTokens: 8, outputTokens: 0 },
    }),
  ]);
  db.run("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)", [
    "bubbleId:cursor-cache-session:assistant-1",
    JSON.stringify({
      type: 2,
      text: "I found the relevant files.",
      createdAt: "2026-04-02T00:00:30.000Z",
      tokenCount: { inputTokens: 0, outputTokens: 21 },
    }),
  ]);
  db.close();

  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return { root, stateDbPath };
}

function makeDiscoveryCache(name: string): SqliteDiscoveryCache {
  const root = mkdtempSync(join(tmpdir(), `jin-discovery-cache-${name}-`));
  const cache = new SqliteDiscoveryCache(join(root, "discovery-cache.db"));
  cleanups.push(() => {
    cache.close();
    rmSync(root, { recursive: true, force: true });
  });
  return cache;
}

function saveState(
  cache: SqliteDiscoveryCache,
  adapter: {
    id: string;
    discoveryCacheContractVersion: number;
    discoveryCachePayloadVersion: number;
    exportDiscoveryState(): { sources: Array<{ sourcePath: string }> };
  },
  config: {
    enabled: boolean;
    dataDir?: string;
    allowProtectedSource?: boolean;
  },
): void {
  const state = adapter.exportDiscoveryState();
  const summary: DiscoveryCacheRunSummary = {
    cachedSources: 0,
    invalidatedSources: 0,
    freshSources: state.sources.length,
  };
  cache.saveForAdapter(adapter, config, state, summary);
}

function hydrateState(
  cache: SqliteDiscoveryCache,
  adapter: {
    id: string;
    discoveryCacheContractVersion: number;
    discoveryCachePayloadVersion: number;
    importDiscoveryState(state: { sources: Array<{ sourcePath: string }> }): void;
  },
  config: {
    enabled: boolean;
    dataDir?: string;
    allowProtectedSource?: boolean;
  },
): void {
  const loaded = cache.loadForAdapter(adapter, config);
  expect(loaded.cachedSources).toBeGreaterThan(0);
  expect(loaded.state).not.toBeNull();
  adapter.importDiscoveryState(loaded.state!);
}

class PartialFailureDiscoveryAdapter {
  static readonly okRef: ConversationRef = {
    id: "partial-success",
    sourcePath: "/tmp/jin-partial-success.jsonl",
    adapterId: "codex",
  };

  static readonly failingRef: ConversationRef = {
    id: "partial-failure",
    sourcePath: "/tmp/jin-partial-failure.jsonl",
    adapterId: "codex",
  };

  readonly id = "codex";
  readonly name = "Codex";
  readonly discoveryCacheContractVersion = 1;
  readonly discoveryCachePayloadVersion = 1;
  private hydratedSourcePaths = new Set<string>();

  async detect(): Promise<boolean> {
    return true;
  }

  async findChanged(): Promise<ConversationRef[]> {
    return [
      PartialFailureDiscoveryAdapter.okRef,
      PartialFailureDiscoveryAdapter.failingRef,
    ].filter((ref) => !this.hydratedSourcePaths.has(ref.sourcePath));
  }

  async loadConversation(ref: ConversationRef): Promise<ConversationBundle | null> {
    if (ref.sourcePath === PartialFailureDiscoveryAdapter.failingRef.sourcePath) {
      throw new Error("boom");
    }

    return {
      conversation: {
        id: ref.id,
        traceId: ref.id,
        parentId: "",
        relationship: "root",
        forkPoint: 0,
        adapterId: ref.adapterId,
        name: ref.id,
        cwd: "",
        gitRemote: "",
        branch: "",
        model: "",
        startedAt: "2026-04-17T00:00:00.000Z",
        endedAt: "2026-04-17T00:00:01.000Z",
        sourcePath: ref.sourcePath,
        sourceFormat: "jsonl",
      },
      messages: [
        {
          id: `${ref.id}:m1`,
          role: "user",
          content: ref.id,
          recordType: "message",
          model: "",
          sequence: 0,
          turn: 0,
          isSidechain: false,
          parentMessageId: "",
          inputTokens: 0,
          outputTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          thinkingContent: "",
          thinkingTokens: 0,
          timestamp: "2026-04-17T00:00:00.000Z",
          toolUses: [],
        },
      ],
    };
  }

  watchPaths(): string[] {
    return [];
  }

  exportDiscoveryState() {
    return {
      sources: [
        {
          sourcePath: PartialFailureDiscoveryAdapter.okRef.sourcePath,
          sourceKind: "jsonl",
          sizeBytes: 1,
          mtimeMs: 1,
          signature: "ok",
          payload: { refId: PartialFailureDiscoveryAdapter.okRef.id },
        },
        {
          sourcePath: PartialFailureDiscoveryAdapter.failingRef.sourcePath,
          sourceKind: "jsonl",
          sizeBytes: 1,
          mtimeMs: 1,
          signature: "fail",
          payload: { refId: PartialFailureDiscoveryAdapter.failingRef.id },
        },
      ],
    };
  }

  importDiscoveryState(state: { sources: Array<{ sourcePath: string }> }): void {
    this.hydratedSourcePaths = new Set(
      state.sources.map((source) => source.sourcePath),
    );
  }
}
