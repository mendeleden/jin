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
import type { ConversationBundle } from "../src/contracts/conversations";
import { openStoreAtPath } from "../src/db/store";
import {
  captureConsole,
  createFakeSink,
  mockProcessExit,
  readTestConfig,
  writeTestConfig,
} from "./helpers";

let fakeSink = createFakeSink();
let mockAdapters: any[] = [];
let watcherState: any;
let runtimeStatus: any;
let restartCalls: any[] = [];
let markRuntimeRunningCalls: Array<{ mode: string; issues: any[] }> = [];
let runtimePaths = {
  configDir: "",
  configPath: "",
  storePath: "",
  logPath: "",
};

mock.module("../src/sinks/registry", () => ({
  createSink: () => fakeSink,
  availableSinks: () => ["postgres", "webhook", "s3"],
}));

mock.module("../src/daemon/process-state", () => ({
  getWatcherState: () => watcherState,
  getDashboardState: () => ({ name: "dashboard", status: "stopped" }),
  stopWatcher: async () => ({ requested: false, completed: true, forced: false }),
  stopDashboard: async () => {},
}));

mock.module("../src/daemon/runtime-state", () => ({
  getRuntimeStatus: () => runtimeStatus,
  getRuntimePaths: () => runtimePaths,
  isServiceActive: () => false,
  isServiceInstalled: () => false,
  markRuntimeStarting: (mode: string) => {
    runtimeStatus = {
      ...runtimeStatus,
      state: "starting",
      owner: runtimeStatus.owner ?? makeOwner(mode as "daemon" | "service" | "foreground"),
      issues: [],
    };
    return runtimeStatus;
  },
  markRuntimeRunning: (mode: string, issues: any[]) => {
    markRuntimeRunningCalls.push({ mode, issues });
    runtimeStatus = {
      ...runtimeStatus,
      state: issues.length > 0 ? "degraded" : "running",
      owner: runtimeStatus.owner ?? makeOwner(mode as "daemon" | "service" | "foreground"),
      issues,
    };
    return runtimeStatus;
  },
  clearRuntimeState: () => {},
  runModeLabel: (mode: string) => mode,
}));

mock.module("../src/commands/start", () => ({
  restartCommand: async (opts: unknown) => {
    restartCalls.push(opts);
  },
}));

mock.module("../src/adapters/registry", () => ({
  allAdapters: () => mockAdapters,
  protectedSourceStartupNotices: (adapterConfigs: Record<string, any> = {}) =>
    buildProtectedSourceNotices(adapterConfigs),
  startupProbeBlocked: (
    adapterId: string,
    adapterConfigs: Record<string, any> = {},
  ) => isStartupProbeBlocked(adapterId, adapterConfigs),
}));

mock.module("../src/commands/ingest", () => ({
  ingestCommand: async () => {},
}));

const { defaultConfig } = await import("../src/config");
const { encodeTeamConfig } = await import("../src/sinks/types");
const { connectCommand } = await import("../src/commands/connect");
const { watchCommand } = await import("../src/commands/watch");
const { routeAddCommand } = await import("../src/commands/route");
const {
  sinkAddCommand,
  sinkDisableCommand,
  sinkEnableCommand,
} = await import("../src/commands/sink");

let tempDir = "";
let console_: ReturnType<typeof captureConsole>;
let exitMock: ReturnType<typeof mockProcessExit>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "jin-config-mutation-"));
  process.env.JIN_CONFIG_DIR = tempDir;
  runtimePaths = {
    configDir: tempDir,
    configPath: join(tempDir, "config.json"),
    storePath: join(tempDir, "store.db"),
    logPath: join(tempDir, "jin.log"),
  };
  watcherState = { name: "watcher", status: "stopped", lifecycleState: "stopped" };
  runtimeStatus = { state: "stopped", issues: [] };
  restartCalls = [];
  markRuntimeRunningCalls = [];
  mockAdapters = [];
  fakeSink = createFakeSink();
  console_ = captureConsole();
  exitMock = mockProcessExit();
  seedRepo("alpha", "github.com/org/alpha");
});

afterEach(() => {
  console_.restore();
  exitMock.restore();
  delete process.env.JIN_CONFIG_DIR;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("config mutation and control commands", () => {
  test("sink add writes durable config and requires explicit restart by default", async () => {
    watcherState = {
      name: "watcher",
      status: "running",
      mode: "daemon",
      pid: 444,
      lifecycleState: "running",
    };
    runtimeStatus = {
      state: "running",
      owner: makeOwner("daemon", 444),
      issues: [],
    };

    await sinkAddCommand("postgres", {
      id: "postgres-team",
      connectionString: "postgresql://localhost:5432/jin",
    });

    const config = await readTestConfig(tempDir);
    expect(config.sinks).toEqual([
      {
        id: "postgres-team",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://localhost:5432/jin",
      },
    ]);
    expect(restartCalls).toHaveLength(0);
    expect(console_.logs.join("\n")).toContain("Restart jin to apply config changes.");
  });

  test("route add --yes performs a service-aware controlled restart", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "postgres-team",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://localhost:5432/jin",
      },
    ];
    await writeTestConfig(tempDir, config);

    watcherState = {
      name: "watcher",
      status: "running",
      mode: "service",
      pid: 777,
      lifecycleState: "running",
    };
    runtimeStatus = {
      state: "running",
      owner: makeOwner("service", 777),
      issues: [],
    };

    await routeAddCommand({
      remote: "https://github.com/org/alpha.git",
      sink: "postgres-team",
      yes: true,
    });

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.routes).toEqual([
      {
        match: { remote: "github.com/org/alpha" },
        sinks: ["postgres-team"],
      },
    ]);
    expect(restartCalls).toEqual([{ service: true }]);
  });

  test("sink pause and resume update the control plane without a full restart", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "postgres-team",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://localhost:5432/jin",
      },
    ];
    await writeTestConfig(tempDir, config);

    watcherState = {
      name: "watcher",
      status: "running",
      mode: "daemon",
      pid: 515,
      lifecycleState: "running",
    };
    runtimeStatus = {
      state: "running",
      owner: makeOwner("daemon", 515),
      issues: [],
    };

    await sinkDisableCommand("postgres-team");

    let nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks[0].enabled).toBe(false);
    expect(restartCalls).toHaveLength(0);
    expect(markRuntimeRunningCalls[0]?.issues).toEqual([
      {
        subsystem: "push",
        message: "sink paused by operator: postgres-team",
        paused: true,
      },
    ]);

    await sinkEnableCommand("postgres-team");

    nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks[0].enabled).toBe(true);
    expect(markRuntimeRunningCalls.at(-1)?.issues).toEqual([]);
    expect(restartCalls).toHaveLength(0);
  });

  test("connect resolves project routing to remote matches and keeps team data out of generic config", async () => {
    const teamCode = encodeTeamConfig({
      id: "workspace-postgres",
      type: "postgres",
      connectionString: "postgresql://team-db:5432/shared",
      teamId: "team-42",
      developerId: "dev-7",
    });

    await connectCommand("alpha", { team: teamCode });

    const config = await readTestConfig(tempDir);
    expect(config).not.toHaveProperty("team");
    expect(config.sinks[0]).toEqual({
      id: "workspace-postgres",
      type: "postgres",
      enabled: true,
      connectionString: "postgresql://team-db:5432/shared",
    });
    expect(config.routes).toEqual([
      {
        match: { remote: "github.com/org/alpha" },
        sinks: ["workspace-postgres"],
      },
    ]);
    expect(config.routes[0].match).not.toHaveProperty("project");
    expect(config.routes[0].match).not.toHaveProperty("directory");
  });

  test("watch startup does not auto-enable disabled adapters or rewrite config", async () => {
    const config = defaultConfig();
    config.adapters["mock-adapter"] = { enabled: false };
    await writeTestConfig(tempDir, config);

    mockAdapters = [
      {
        id: "mock-adapter",
        name: "Mock Adapter",
        icon: "M",
        detect: async () => true,
        sessions: async () => [],
        messages: async () => [],
        watchPaths: () => [],
      },
    ];

    await expect(watchCommand({ daemon: false })).rejects.toThrow();

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.adapters["mock-adapter"]).toEqual({ enabled: false });
    expect(console_.logs.join("\n")).not.toContain("auto-enabled");
  });

  test("watch startup skips opt-in-only protected adapters until the user opts in", async () => {
    const config = defaultConfig();
    await writeTestConfig(tempDir, config);

    let detectCalls = 0;
    mockAdapters = [
      {
        id: "kiro",
        name: "Kiro",
        icon: "K",
        detect: async () => {
          detectCalls += 1;
          return true;
        },
        sessions: async () => [],
        messages: async () => [],
        watchPaths: () => [],
      },
    ];

    await expect(watchCommand({ daemon: false })).rejects.toThrow();

    expect(detectCalls).toBe(0);
  });
});

function seedRepo(name: string, gitRemote: string): void {
  const store = openStoreAtPath(runtimePaths.storePath);
  try {
    store.writeBundle(makeBundle(name, gitRemote));
  } finally {
    store.close();
  }
}

function makeBundle(name: string, gitRemote: string): ConversationBundle {
  return {
    conversation: {
      id: `${name}-conversation`,
      traceId: `${name}-conversation`,
      parentId: "",
      relationship: "root",
      forkPoint: -1,
      adapterId: "mock-adapter",
      name: `${name} conversation`,
      cwd: "/tmp",
      gitRemote,
      branch: "main",
      model: "mock-model",
      startedAt: "2026-04-01T00:00:00.000Z",
      endedAt: "2026-04-01T00:01:00.000Z",
      sourcePath: `/tmp/${name}.jsonl`,
      sourceFormat: "jsonl",
    },
    messages: [
      {
        id: `${name}-m1`,
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

function makeOwner(
  mode: "daemon" | "service" | "foreground",
  pid = 321,
) {
  return {
    pid,
    mode,
    startedAt: "2026-04-01T12:00:00.000Z",
    configDir: runtimePaths.configDir,
    storePath: runtimePaths.storePath,
    logPath: runtimePaths.logPath,
  };
}

function isOptedIn(config: Record<string, any> | undefined): boolean {
  return config?.allowProtectedSource === true || typeof config?.dataDir === "string";
}

function isStartupProbeBlocked(
  adapterId: string,
  adapterConfigs: Record<string, any>,
): boolean {
  if (!["kiro", "opencode", "warp"].includes(adapterId)) {
    return false;
  }

  const config = adapterConfigs[adapterId];
  return config?.enabled !== false && !isOptedIn(config);
}

function buildProtectedSourceNotices(
  adapterConfigs: Record<string, any>,
) {
  const notices: Array<{ adapterId: string; adapterName: string; mode: string; summary: string }> = [];

  if (adapterConfigs.cursor?.enabled !== false && !isOptedIn(adapterConfigs.cursor)) {
    notices.push({
      adapterId: "cursor",
      adapterName: "Cursor",
      mode: "mixed-default",
      summary:
        "Cursor startup skips app-private globalStorage by default; only safe startup sources are auto-detected until you opt in.",
    });
  }

  for (const [adapterId, adapterName] of [
    ["kiro", "Kiro"],
    ["opencode", "OpenCode"],
    ["warp", "Warp Terminal"],
  ] as const) {
    if (isStartupProbeBlocked(adapterId, adapterConfigs)) {
      notices.push({
        adapterId,
        adapterName,
        mode: "opt-in-only",
        summary: `${adapterName} startup does not probe protected/app-private stores unless you opt in.`,
      });
    }
  }

  return notices;
}
