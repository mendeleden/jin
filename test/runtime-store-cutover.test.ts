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
import { analyzeCommand } from "../src/commands/analyze";
import { defaultConfig } from "../src/config";
import { openStoreAtPath } from "../src/db/store";
import { listConversations } from "../src/db/query-surface";
import { statusCommand } from "../src/commands/status";
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
  rmSync(tempDir, { recursive: true, force: true });
});

describe("W3-RUNTIME-01 live cutover", () => {
  test("watchCommand foreground launches the v2 coordinator with the v2 store", async () => {
    mockAdapters = [createV2CapableAdapter("watch-cutover-conversation")];
    exitMock = mockProcessExit();

    const watchPromise = watchCommand({ daemon: false });
    await Bun.sleep(30);
    process.emit("SIGTERM");

    await expect(watchPromise).rejects.toBeInstanceOf(ExitError);
    expect(runPipelineCalls).toHaveLength(1);

    const options = runPipelineCalls[0] as {
      store: Record<string, unknown>;
      routes: Array<{ sinks: string[] }>;
      adapterSource: () => Promise<any[]>;
    };

    expect(typeof options.store.writeBundle).toBe("function");
    expect(typeof options.store.conversationsNeedingPush).toBe("function");
    expect("upsertSession" in options.store).toBe(false);

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
    seedV2Conversation("analyze-cutover-conversation");

    await analyzeCommand({ json: true });

    const parsed = JSON.parse(console_.logs.join("\n"));
    expect(parsed.summary.totalSessions).toBe(1);
    expect(parsed.summary.totalMessages).toBe(1);
    expect(parsed.byAdapter["mock-adapter"].sessions).toBe(1);
    expect(parsed.byAdapter["mock-adapter"].messages).toBe(1);
    expect(parsed.byModel["mock-model"].messages).toBe(1);
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

function seedV2Conversation(conversationId: string): void {
  const store = openStoreAtPath(runtimePaths.storePath);
  store.writeBundle(createV2Bundle(conversationId));
  store.close();
}

function createV2Bundle(conversationId: string) {
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
    messages: [
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
    ],
  };
}
