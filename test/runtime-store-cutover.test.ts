import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ExitError,
  captureConsole,
  createFakeSink,
  mockProcessExit,
} from "./helpers";

let runtimeStatus: any;
let runtimePaths = {
  configDir: "",
  configPath: "",
  storePath: "",
  logPath: "",
};
let mockAdapters: any[] = [];
let fakeSink: any = createFakeSink();
let runPipelineCalls: any[] = [];
let pushedPayloads: any[] = [];

mock.module("../src/daemon/runtime-state", () => ({
  getRuntimeStatus: () => runtimeStatus,
  getRuntimePaths: () => runtimePaths,
  runModeLabel: (mode: string) => mode,
  isServiceActive: () => false,
  isServiceInstalled: () => false,
  clearRuntimeState: () => {},
  markRuntimeStarting: () => runtimeStatus,
  markRuntimeRunning: () => runtimeStatus,
  markRuntimeStopping: () => runtimeStatus,
}));

mock.module("../src/adapters/registry", () => ({
  allAdapters: () => mockAdapters,
  protectedSourceStartupNotices: () => [],
  startupProbeBlocked: () => false,
}));

mock.module("../src/sinks/registry", () => ({
  createSink: () => fakeSink,
  availableSinks: () => ["webhook", "postgres", "s3"],
}));

mock.module("../src/pipeline/loop", () => ({
  runPipeline: async (options: unknown) => {
    runPipelineCalls.push(options);
    return {
      enqueue: () => true,
      waitForIdle: async () => {},
      shutdown: async () => ({
        timedOut: false,
        abandonedWorkItems: 0,
      }),
    };
  },
}));

mock.module("../src/updater", () => ({
  checkForUpdate: async () => null,
}));

const { analyzeCommand } = await import("../src/commands/analyze");
const { defaultConfig } = await import("../src/config");
const { openStoreAtPath } = await import("../src/db/store");
const { listConversations } = await import("../src/db/query-surface");
const { statusCommand } = await import("../src/commands/status");
const { ingestOne } = await import("../src/pipeline/ingest");
const { watchCommand } = await import("../src/commands/watch");
const { ingestCommand } = await import("../src/commands/ingest");

let tempDir = "";
let console_: ReturnType<typeof captureConsole>;
let exitMock: ReturnType<typeof mockProcessExit> | null = null;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "jin-runtime-cutover-"));
  process.env.JIN_CONFIG_DIR = tempDir;
  runtimePaths = {
    configDir: tempDir,
    configPath: join(tempDir, "config.json"),
    storePath: join(tempDir, "store.db"),
    logPath: join(tempDir, "jin.log"),
  };
  runtimeStatus = { state: "stopped", issues: [] };
  mockAdapters = [];
  fakeSink = createFakeSink();
  runPipelineCalls = [];
  pushedPayloads = [];
  console_ = captureConsole();

  await writeConfig(defaultConfig());
});

afterEach(() => {
  console_.restore();
  exitMock?.restore();
  exitMock = null;
  delete process.env.JIN_CONFIG_DIR;
  delete process.env.JIN_RSS_WARNING_MB;
  delete process.env.JIN_RSS_HARD_LIMIT_MB;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("W3-RUNTIME-01 live cutover", () => {
  test("watchCommand foreground launches the v2 coordinator with the v2 store", async () => {
    mockAdapters = [createV2CapableAdapter("watch-cutover-conversation")];
    exitMock = mockProcessExit();
    process.env.JIN_RSS_WARNING_MB = "123";
    process.env.JIN_RSS_HARD_LIMIT_MB = "456";

    const watchPromise = watchCommand({ daemon: false });
    await Bun.sleep(30);
    process.emit("SIGTERM");

    await expect(watchPromise).rejects.toBeInstanceOf(ExitError);
    expect(runPipelineCalls).toHaveLength(1);

    const options = runPipelineCalls[0] as {
      store: Record<string, unknown>;
      routes: Array<{ sinks: string[] }>;
      adapterSource: () => Promise<any[]>;
      pushBatchSize?: number;
      scheduleStartupWork?: boolean;
      deferWatcherStart?: boolean;
      rssWarningBytes?: number;
      rssHardLimitBytes?: number;
    };

    expect(typeof options.store.writeBundle).toBe("function");
    expect(typeof options.store.conversationsNeedingPush).toBe("function");
    expect("upsertSession" in options.store).toBe(false);
    expect(options.pushBatchSize).toBe(2);
    expect(options.scheduleStartupWork).toBe(false);
    expect(options.deferWatcherStart).toBe(true);
    expect(options.rssWarningBytes).toBeUndefined();
    expect(options.rssHardLimitBytes).toBeUndefined();

    const adapters = await options.adapterSource();
    expect(adapters).toHaveLength(1);
    expect(typeof adapters[0].findChanged).toBe("function");
    expect(typeof adapters[0].loadConversation).toBe("function");
  });

  test("ingestCommand writes through the v2 db store and pushes v2 payloads", async () => {
    mockAdapters = [createV2CapableAdapter("ingest-cutover-conversation")];

    const config = defaultConfig();
    config.sinks = [
      {
        id: "webhook-main",
        type: "webhook",
        enabled: true,
        url: "https://example.test/webhook",
      },
    ];
    config.routes = [{ match: {}, sinks: ["webhook-main"] }];
    await writeConfig(config);

    fakeSink = {
      id: "webhook-main",
      name: "Webhook Main",
      enabled: true,
      healthCheck: async () => ({ ok: true }),
      push: async (payloads: any[]) => {
        pushedPayloads.push(...payloads);
        return { pushed: payloads.length, failed: 0, errors: [] };
      },
      close: async () => {},
    };

    await ingestCommand();

    const store = openStoreAtPath(runtimePaths.storePath);
    const conversations = listConversations(store.database);
    store.close();

    expect(conversations.some((entry) => entry.id === "ingest-cutover-conversation")).toBe(
      true,
    );
    expect(pushedPayloads).toHaveLength(1);
    expect(pushedPayloads[0].conversation.id).toBe("ingest-cutover-conversation");
    expect(pushedPayloads[0].attemptedRevision).toBe(1);
    expect("session" in pushedPayloads[0]).toBe(false);
  });

  test("analyzeCommand reads the v2 store/query surface directly", async () => {
    seedV2Conversation("analyze-cutover-conversation", {
      assistantUsage: {
        inputTokens: 11,
        outputTokens: 7,
        cacheRead: 5,
        cacheWrite: 3,
      },
    });

    await analyzeCommand({ json: true });

    const parsed = JSON.parse(console_.logs.join("\n"));
    expect(parsed.summary.totalSessions).toBe(1);
    expect(parsed.summary.totalMessages).toBe(2);
    expect(parsed.summary.totalTokens).toBe(26);
    expect(parsed.summary.displayTokens).toBe(18);
    expect(parsed.summary.cacheTokens).toBe(8);
    expect(parsed.byHarness["mock-adapter"].sessions).toBe(1);
    expect(parsed.byHarness["mock-adapter"].messages).toBe(2);
    expect(parsed.byHarness["mock-adapter"].tokens).toBe(26);
    expect(parsed.byHarness["mock-adapter"].displayTokens).toBe(18);
    expect(parsed.byHarness["mock-adapter"].cacheTokens).toBe(8);
    expect(parsed.byAdapter["mock-adapter"].sessions).toBe(1);
    expect(parsed.byModel["mock-model"].messages).toBe(2);
  });

  test("statusCommand json reports v2 store stats from the live db surface", async () => {
    seedV2Conversation("status-cutover-conversation");

    await statusCommand({ json: true });

    const parsed = JSON.parse(console_.logs.join("\n"));
    expect(parsed.sessions).toBe(1);
    expect(parsed.messages).toBe(1);
    expect(parsed.adapters).toEqual(["mock-adapter"]);
    expect(parsed.paths.store).toBe(runtimePaths.storePath);
  });
});

describe("W3-PERF-04 adapter ingest batching", () => {
  test("claude-code, cursor, and codex use single-ref ingest batches while other adapters keep the default batch size", async () => {
    const refs = Array.from({ length: 21 }, (_, index) => ({
      id: `conversation-${index + 1}`,
      sourcePath: `/tmp/conversation-${index + 1}.jsonl`,
      adapterId: "claude-code",
    }));
    const store = {
      writeBundle: () => ({ changed: true, revision: 1 }),
      database: {
        exec: mock(() => {}),
      },
    };
    const claudeBatchBoundaries: number[] = [];
    const cursorBatchBoundaries: number[] = [];
    const codexBatchBoundaries: number[] = [];
    const genericBatchBoundaries: number[] = [];
    const claudeDiscoveryReleaseCalls: number[] = [];
    const claudeReleaseCalls: number[] = [];
    const cursorDiscoveryReleaseCalls: number[] = [];
    const cursorReleaseCalls: number[] = [];
    const codexDiscoveryReleaseCalls: number[] = [];
    const codexReleaseCalls: number[] = [];
    const genericDiscoveryReleaseCalls: number[] = [];
    const genericReleaseCalls: number[] = [];

    await ingestOne(
      createBatchProbeAdapter("claude-code", refs, {
        releaseDiscoveryMemory: () => {
          claudeDiscoveryReleaseCalls.push(1);
        },
        releaseTransientMemory: () => {
          claudeReleaseCalls.push(1);
        },
      }),
      store as any,
      { kind: "startup-scan" },
      {
        onBatchProcessed(info) {
          claudeBatchBoundaries.push(info.processedRefs);
        },
      },
    );

    await ingestOne(
      createBatchProbeAdapter("cursor", refs, {
        releaseDiscoveryMemory: () => {
          cursorDiscoveryReleaseCalls.push(1);
        },
        releaseTransientMemory: () => {
          cursorReleaseCalls.push(1);
        },
      }),
      store as any,
      { kind: "startup-scan" },
      {
        onBatchProcessed(info) {
          cursorBatchBoundaries.push(info.processedRefs);
        },
      },
    );

    await ingestOne(
      createBatchProbeAdapter("codex", refs, {
        releaseDiscoveryMemory: () => {
          codexDiscoveryReleaseCalls.push(1);
        },
        releaseTransientMemory: () => {
          codexReleaseCalls.push(1);
        },
      }),
      store as any,
      { kind: "startup-scan" },
      {
        onBatchProcessed(info) {
          codexBatchBoundaries.push(info.processedRefs);
        },
      },
    );

    await ingestOne(
      createBatchProbeAdapter("mock-adapter", refs, {
        releaseDiscoveryMemory: () => {
          genericDiscoveryReleaseCalls.push(1);
        },
        releaseTransientMemory: () => {
          genericReleaseCalls.push(1);
        },
      }),
      store as any,
      { kind: "startup-scan" },
      {
        onBatchProcessed(info) {
          genericBatchBoundaries.push(info.processedRefs);
        },
      },
    );

    expect(claudeBatchBoundaries).toHaveLength(20);
    expect(claudeBatchBoundaries[0]).toBe(1);
    expect(claudeBatchBoundaries.at(-1)).toBe(20);
    expect(claudeDiscoveryReleaseCalls).toHaveLength(1);
    expect(claudeReleaseCalls).toHaveLength(21);
    expect(cursorBatchBoundaries).toHaveLength(20);
    expect(cursorBatchBoundaries[0]).toBe(1);
    expect(cursorBatchBoundaries.at(-1)).toBe(20);
    expect(cursorDiscoveryReleaseCalls).toHaveLength(1);
    expect(cursorReleaseCalls).toHaveLength(21);
    expect(codexBatchBoundaries).toHaveLength(20);
    expect(codexBatchBoundaries[0]).toBe(1);
    expect(codexBatchBoundaries.at(-1)).toBe(20);
    expect(codexDiscoveryReleaseCalls).toHaveLength(1);
    expect(codexReleaseCalls).toHaveLength(21);
    expect(genericBatchBoundaries).toEqual([20]);
    expect(genericDiscoveryReleaseCalls).toHaveLength(1);
    expect(genericReleaseCalls).toHaveLength(0);
    expect(store.database.exec.mock.calls).toHaveLength(126);
    expect(store.database.exec.mock.calls[0]).toEqual([
      "PRAGMA wal_checkpoint(PASSIVE)",
    ]);
    expect(store.database.exec.mock.calls[1]).toEqual([
      "PRAGMA shrink_memory",
    ]);
    expect(store.database.exec.mock.calls.at(-2)).toEqual([
      "PRAGMA wal_checkpoint(PASSIVE)",
    ]);
    expect(store.database.exec.mock.calls.at(-1)).toEqual([
      "PRAGMA shrink_memory",
    ]);
  });
});

async function writeConfig(config: unknown): Promise<void> {
  await Bun.write(runtimePaths.configPath, JSON.stringify(config, null, 2));
}

function createV2CapableAdapter(conversationId: string) {
  const bundle = createV2Bundle(conversationId);
  const sourcePath = bundle.conversation.sourcePath;

  return {
    id: "mock-adapter",
    name: "Mock Adapter",
    icon: "M",
    detect: async () => true,
    findChanged: async () => [
      {
        id: conversationId,
        sourcePath,
        adapterId: "mock-adapter",
      },
    ],
    loadConversation: async (ref: { id: string }) =>
      ref.id === conversationId ? bundle : null,
    watchPaths: () => [],
    sessions: async () => [],
    messages: async () => [],
  };
}

function createBatchProbeAdapter(
  adapterId: string,
  refs: Array<{ id: string; sourcePath: string; adapterId: string }>,
  hooks: {
    releaseDiscoveryMemory?: () => void;
    releaseTransientMemory?: () => void;
  } = {},
) {
  return {
    id: adapterId,
    name: adapterId,
    icon: adapterId.slice(0, 1).toUpperCase(),
    detect: async () => true,
    findChanged: async () =>
      refs.map((ref) => ({
        ...ref,
        adapterId,
      })),
    loadConversation: async (ref: { id: string }) => createV2Bundle(ref.id),
    releaseDiscoveryMemory: hooks.releaseDiscoveryMemory,
    releaseTransientMemory: hooks.releaseTransientMemory,
    watchPaths: () => [],
  };
}

function seedV2Conversation(
  conversationId: string,
  options: { assistantUsage?: MockAssistantUsage } = {},
): void {
  const store = openStoreAtPath(runtimePaths.storePath);
  store.writeBundle(createV2Bundle(conversationId, options));
  store.close();
}

interface MockAssistantUsage {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}

function createV2Bundle(
  conversationId: string,
  options: { assistantUsage?: MockAssistantUsage } = {},
) {
  const messages = [
    {
      id: `${conversationId}-m1`,
      role: "user",
      content: "hello",
      recordType: "message",
      model: "mock-model",
      sequence: 1,
      turn: 1,
      isSidechain: false,
      parentMessageId: "",
      inputTokens: 0,
      outputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      thinkingContent: "",
      thinkingTokens: 0,
      timestamp: "2026-04-01T00:00:00.000Z",
      toolUses: [],
    },
  ];

  if (options.assistantUsage) {
    messages.push({
      id: `${conversationId}-m2`,
      role: "assistant",
      content: "world",
      recordType: "message",
      model: "mock-model",
      sequence: 2,
      turn: 1,
      isSidechain: false,
      parentMessageId: `${conversationId}-m1`,
      inputTokens: options.assistantUsage.inputTokens,
      outputTokens: options.assistantUsage.outputTokens,
      cacheRead: options.assistantUsage.cacheRead,
      cacheWrite: options.assistantUsage.cacheWrite,
      thinkingContent: "",
      thinkingTokens: 0,
      timestamp: "2026-04-01T00:00:30.000Z",
      toolUses: [],
    });
  }

  return {
    conversation: {
      id: conversationId,
      traceId: conversationId,
      parentId: "",
      relationship: "root",
      forkPoint: -1,
      adapterId: "mock-adapter",
      name: "Mock Conversation",
      cwd: "/tmp",
      gitRemote: "github.com/example/repo",
      branch: "main",
      model: "mock-model",
      startedAt: "2026-04-01T00:00:00.000Z",
      endedAt: "2026-04-01T00:01:00.000Z",
      sourcePath: `/tmp/${conversationId}.jsonl`,
      sourceFormat: "jsonl",
    },
    messages,
  };
}
