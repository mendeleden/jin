import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { Database } from "bun:sqlite";
import { CodexAdapter } from "../src/adapters/codex";
import { CursorAdapter } from "../src/adapters/cursor";
import { GeminiCliAdapter } from "../src/adapters/gemini-cli";
import type { Adapter } from "../src/contracts/adapters";
import { openStoreAtPath, type SqliteConversationStore } from "../src/db";
import { ingestOne } from "../src/pipeline/ingest";

const SIMPLE_FIXTURE = join(
  process.cwd(),
  "test/fixtures/codex/2026-02-21T12-48-43-testcodex.jsonl",
);

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

test("worker ingest routes heavy codex startup refs through the worker path", async () => {
  const codexEnv = makeCodexHome();
  const workerTrapAdapter = new CodexAdapter(codexEnv.root) as CodexAdapter &
    Adapter;
  const refs = await workerTrapAdapter.findChanged({ kind: "startup-scan" });
  expect(refs).toHaveLength(1);

  const storeEnv = createStoreEnv("worker-ingest");
  const workerSamples: Array<Record<string, unknown>> = [];
  workerTrapAdapter.findChanged = async () => {
    throw new Error("inline findChanged should not run when worker discovery is enabled");
  };
  workerTrapAdapter.loadConversation = async () => {
    throw new Error("inline loadConversation should not run when worker ingest is enabled");
  };

  const result = await ingestOne(workerTrapAdapter, storeEnv.store, {
    kind: "startup-scan",
  }, {
    workerIngest: {
      command: [process.execPath, join(process.cwd(), "src/index.ts")],
      adapterConfigs: {
        codex: {
          enabled: true,
          dataDir: codexEnv.root,
        },
      },
    },
    onWorkerSample: (info) => {
      workerSamples.push(info as unknown as Record<string, unknown>);
    },
  });

  expect(result.anyChanged).toBe(true);
  expect(result.scannedRefCount).toBeGreaterThan(0);
  expect(result.loadedConversationCount).toBeGreaterThan(0);
  expect(result.changedConversationIds.length).toBe(result.loadedConversationCount);
  expect(workerSamples.length).toBeGreaterThan(0);
  expect(
    workerSamples.some((sample) =>
      typeof sample.workerRssMb === "number" &&
      typeof sample.workerCpuPct === "number" &&
      typeof sample.combinedRssMb === "number" &&
      typeof sample.combinedCpuPct === "number",
    ),
  ).toBe(true);
  expect(
    workerSamples.some((sample) =>
      sample.phase === "before-findChanged" ||
      sample.phase === "before-load",
    ),
  ).toBe(true);
  for (const conversationId of result.changedConversationIds) {
    expect(storeEnv.store.getMessages(conversationId).length).toBeGreaterThan(0);
  }
});

test("worker ingest routes heavy cursor startup refs through the worker path", async () => {
  const cursorEnv = makeCursorHome();
  const workerTrapAdapter = new CursorAdapter({
    chatsDir: join(cursorEnv.root, "chats"),
    globalStorageDbPath: cursorEnv.stateDbPath,
  }) as CursorAdapter & Adapter;
  const refs = await workerTrapAdapter.findChanged({ kind: "startup-scan" });
  expect(refs.length).toBeGreaterThan(0);

  const storeEnv = createStoreEnv("worker-cursor-ingest");
  workerTrapAdapter.findChanged = async () => {
    throw new Error("inline findChanged should not run when worker discovery is enabled");
  };
  workerTrapAdapter.loadConversation = async () => {
    throw new Error("inline loadConversation should not run when worker ingest is enabled");
  };

  const result = await ingestOne(workerTrapAdapter, storeEnv.store, {
    kind: "startup-scan",
  }, {
    workerIngest: {
      command: [process.execPath, join(process.cwd(), "src/index.ts")],
      adapterConfigs: {
        cursor: {
          enabled: true,
          allowProtectedSource: true,
          dataDir: cursorEnv.stateDbPath,
        },
      },
    },
  });

  expect(result.anyChanged).toBe(true);
  expect(result.scannedRefCount).toBeGreaterThan(0);
  expect(result.loadedConversationCount).toBeGreaterThan(0);
  expect(result.changedConversationIds.length).toBe(result.loadedConversationCount);
  for (const conversationId of result.changedConversationIds) {
    expect(storeEnv.store.getMessages(conversationId).length).toBeGreaterThan(0);
  }
});

test("worker ingest routes codex fs-change refs through the worker path", async () => {
  const codexEnv = makeCodexHome();
  const workerTrapAdapter = new CodexAdapter(codexEnv.root) as CodexAdapter &
    Adapter;

  workerTrapAdapter.findChanged = async () => {
    throw new Error("inline findChanged should not run when worker discovery is enabled");
  };
  workerTrapAdapter.loadConversation = async () => {
    throw new Error("inline loadConversation should not run when worker ingest is enabled");
  };

  const storeEnv = createStoreEnv("worker-codex-fs-change");
  const result = await ingestOne(
    workerTrapAdapter,
    storeEnv.store,
    {
      kind: "fs-change",
      changedPaths: [codexEnv.sessionPath],
    },
    {
      workerIngest: {
        command: [process.execPath, join(process.cwd(), "src/index.ts")],
        adapterConfigs: {
          codex: {
            enabled: true,
            dataDir: codexEnv.root,
          },
        },
      },
    },
  );

  expect(result).toMatchObject({
    scannedRefCount: 1,
    loadedConversationCount: 1,
    anyChanged: true,
  });
  expect(result.changedConversationIds.length).toBe(1);
  for (const conversationId of result.changedConversationIds) {
    expect(storeEnv.store.getMessages(conversationId).length).toBeGreaterThan(0);
  }
});

test("worker ingest routes simple gemini startup refs through the worker path", async () => {
  const geminiRoot = makeGeminiHome();
  const workerTrapAdapter = new GeminiCliAdapter(geminiRoot) as GeminiCliAdapter &
    Adapter;
  const refs = await workerTrapAdapter.findChanged({ kind: "startup-scan" });
  expect(refs).toHaveLength(1);

  workerTrapAdapter.findChanged = async () => {
    throw new Error("inline findChanged should not run when worker discovery is enabled");
  };
  workerTrapAdapter.loadConversation = async () => {
    throw new Error("inline loadConversation should not run when worker ingest is enabled");
  };

  const storeEnv = createStoreEnv("worker-gemini-ingest");
  const result = await ingestOne(
    workerTrapAdapter,
    storeEnv.store,
    { kind: "startup-scan" },
    {
      workerIngest: {
        command: [process.execPath, join(process.cwd(), "src/index.ts")],
        adapterConfigs: {
          "gemini-cli": {
            enabled: true,
            dataDir: geminiRoot,
          },
        },
      },
    },
  );

  expect(result).toMatchObject({
    scannedRefCount: 1,
    loadedConversationCount: 1,
    anyChanged: true,
  });
  expect(result.changedConversationIds.length).toBe(1);
  for (const conversationId of result.changedConversationIds) {
    expect(storeEnv.store.getMessages(conversationId).length).toBeGreaterThan(0);
  }
});

test("worker discovery uses durable cache to suppress unchanged codex periodic replay", async () => {
  const codexEnv = makeCodexHome();
  const storeEnv = createStoreEnv("worker-discovery-cache");
  const cachePath = join(storeEnv.dir, "discovery-cache.db");
  const { SqliteDiscoveryCache } = await import("../src/db/discovery-cache");
  const discoveryCache = new SqliteDiscoveryCache(cachePath);
  cleanups.push(() => {
    discoveryCache.close();
  });

  const startupAdapter = new CodexAdapter(codexEnv.root) as CodexAdapter & Adapter;
  startupAdapter.findChanged = async () => {
    throw new Error("inline findChanged should not run when worker discovery is enabled");
  };
  startupAdapter.loadConversation = async () => {
    throw new Error("inline loadConversation should not run when worker ingest is enabled");
  };

  const startupResult = await ingestOne(
    startupAdapter,
    storeEnv.store,
    { kind: "startup-scan" },
    {
      workerIngest: {
        command: [process.execPath, join(process.cwd(), "src/index.ts")],
        adapterConfigs: {
          codex: {
            enabled: true,
            dataDir: codexEnv.root,
          },
        },
      },
      discoveryCache: {
        store: discoveryCache,
        adapterConfigs: {
          codex: {
            enabled: true,
            dataDir: codexEnv.root,
          },
        },
      },
    },
  );

  expect(startupResult).toMatchObject({
    scannedRefCount: 1,
    loadedConversationCount: 1,
    anyChanged: true,
  });

  const periodicAdapter = new CodexAdapter(codexEnv.root) as CodexAdapter & Adapter;
  periodicAdapter.findChanged = async () => {
    throw new Error("inline findChanged should not run when worker discovery is enabled");
  };
  periodicAdapter.loadConversation = async () => {
    throw new Error("inline loadConversation should not run when worker ingest is enabled");
  };

  const periodicResult = await ingestOne(
    periodicAdapter,
    storeEnv.store,
    { kind: "periodic-scan" },
    {
      workerIngest: {
        command: [process.execPath, join(process.cwd(), "src/index.ts")],
        adapterConfigs: {
          codex: {
            enabled: true,
            dataDir: codexEnv.root,
          },
        },
      },
      discoveryCache: {
        store: discoveryCache,
        adapterConfigs: {
          codex: {
            enabled: true,
            dataDir: codexEnv.root,
          },
        },
      },
    },
  );

  expect(periodicResult).toEqual({
    scannedRefCount: 0,
    loadedConversationCount: 0,
    changedConversationIds: [],
    anyChanged: false,
  });
});

function makeCodexHome(): {
  root: string;
  sessionPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "jin-worker-codex-"));
  const relativePath = "sessions/2026/02/21/rollout-simple.jsonl";
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${readFileSync(SIMPLE_FIXTURE, "utf8").trim()}\n`, "utf8");
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    sessionPath: fullPath,
  };
}

function makeCursorHome(): {
  root: string;
  stateDbPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "jin-worker-cursor-"));
  const stateDbPath = join(root, "state.vscdb");
  const db = new Database(stateDbPath);
  db.run("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
  db.run("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)", [
    "composerData:worker-cursor-session",
    JSON.stringify({
      name: "Worker Cursor Session",
      createdAt: "2026-04-02T00:00:00.000Z",
      lastUpdatedAt: "2026-04-02T00:00:30.000Z",
      modelConfig: { modelName: "cursor-worker-test" },
      subagentComposerIds: [],
      fullConversationHeadersOnly: [
        { bubbleId: "user-1", type: 1 },
        { bubbleId: "assistant-1", type: 2 },
      ],
    }),
  ]);
  db.run("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)", [
    "bubbleId:worker-cursor-session:user-1",
    JSON.stringify({
      type: 1,
      text: "Inspect the adapter",
      createdAt: "2026-04-02T00:00:00.000Z",
      tokenCount: { inputTokens: 8, outputTokens: 0 },
    }),
  ]);
  db.run("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)", [
    "bubbleId:worker-cursor-session:assistant-1",
    JSON.stringify({
      type: 2,
      text: "I found the relevant files.",
      createdAt: "2026-04-02T00:00:30.000Z",
      tokenCount: { inputTokens: 0, outputTokens: 21 },
    }),
  ]);
  db.close();

  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
  });

  return { root, stateDbPath };
}

function makeGeminiHome(): string {
  const root = mkdtempSync(join(tmpdir(), "jin-worker-gemini-"));
  const sessionPath = join(root, "tmp", "session-gemini-thread.json");
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(
    sessionPath,
    JSON.stringify({
      sessionId: "gemini-thread",
      startTime: "2026-04-01T11:00:00.000Z",
      lastUpdated: "2026-04-01T11:00:05.000Z",
      messages: [
        {
          id: "gemini-user",
          type: "user",
          timestamp: "2026-04-01T11:00:00.000Z",
          content: [{ text: "Summarize the current branch." }],
        },
        {
          id: "gemini-assistant",
          type: "model",
          timestamp: "2026-04-01T11:00:05.000Z",
          model: "gemini-2.5-pro",
          content: [{ text: "The branch ports the simple adapters to the v2 contract." }],
        },
      ],
    }),
    "utf8",
  );
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function createStoreEnv(name: string): { dir: string; store: SqliteConversationStore } {
  const dir = mkdtempSync(join(tmpdir(), `jin-worker-store-${name}-`));
  const store = openStoreAtPath(join(dir, "store.db"));
  cleanups.push(() => {
    try {
      store.close();
    } catch {
      // Best effort cleanup.
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store };
}
