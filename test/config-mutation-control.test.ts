import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ConversationBundle } from "../src/contracts/conversations";
import type { PushPayload } from "../src/contracts/sinks";
import { openStoreAtPath } from "../src/db/store";
import {
  captureConsole,
  createFakeSink,
  mockProcessExit,
  readTestConfig,
  removeDirWithRetry,
  writeTestConfig,
} from "./helpers";

let fakeSink = createFakeSink();
let mockAdapters: any[] = [];
let watcherState: any;
let runtimeStatus: any;
let restartCalls: any[] = [];
let markRuntimeRunningCalls: Array<{ mode: string; issues: any[] }> = [];
let configReloadRequests: any[] = [];
let configReloadResult:
  | { status: "accepted"; statusCode: number; message: string }
  | { status: "rejected"; statusCode: number; message: string }
  | { status: "failed"; message: string } = {
    status: "accepted",
    statusCode: 202,
    message: "Config reload accepted.",
  };
let runtimePaths = {
  configDir: "",
  configPath: "",
  storePath: "",
  logPath: "",
  localEndpoint: "",
  socketPath: "",
};

mock.module("../src/sinks/registry", () => ({
  createSink: () => fakeSink,
  availableSinks: () => ["postgres", "webhook", "s3"],
}));

mock.module("../src/daemon/process-state", () => ({
  getWatcherState: () => watcherState,
  getAllState: () => [watcherState],
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

mock.module("../src/api/client", () => ({
  requestDaemonConfigReload: async (opts: unknown) => {
    configReloadRequests.push(opts ?? {});
    return configReloadResult;
  },
}));

mock.module("../src/adapters/registry", () => ({
  allAdapters: () => mockAdapters,
  createAdapter: (adapterId: string) =>
    mockAdapters.find((adapter) => adapter.id === adapterId) ?? null,
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

const {
  configLockPath,
  defaultConfig,
  saveConfig,
  updateConfig,
} = await import("../src/config");
const { encodeTeamConfig } = await import("../src/sinks/types");
const { connectCommand } = await import("../src/commands/connect");
const { watchCommand } = await import("../src/commands/watch");
const { routeAddCommand } = await import("../src/commands/route");
const {
  sinkAddCommand,
  sinkDisableCommand,
  sinkEnableCommand,
  sinkRepushCommand,
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
    localEndpoint: join(tempDir, "jin.sock"),
    socketPath: join(tempDir, "jin.sock"),
  };
  watcherState = { name: "watcher", status: "stopped", lifecycleState: "stopped" };
  runtimeStatus = { state: "stopped", issues: [] };
  restartCalls = [];
  markRuntimeRunningCalls = [];
  configReloadRequests = [];
  configReloadResult = {
    status: "accepted",
    statusCode: 202,
    message: "Config reload accepted.",
  };
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
  removeDirWithRetry(tempDir);
});

afterAll(() => {
  mock.restore();
});

describe("config mutation and control commands", () => {
  test("saveConfig writes atomically and releases the config lock", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "postgres-team",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://localhost:5432/jin",
      },
    ];

    await saveConfig(config);

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks).toEqual(config.sinks);
    expect(existsSync(configLockPath())).toBe(false);
    expect(readdirSync(tempDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("updateConfig does not persist partial mutations when the mutator fails", async () => {
    const config = defaultConfig();
    await writeTestConfig(tempDir, config);

    await expect(
      updateConfig((nextConfig) => {
        nextConfig.sinks.push({
          id: "postgres-team",
          type: "postgres",
          enabled: true,
          connectionString: "postgresql://localhost:5432/jin",
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks).toEqual([]);
  });

  test("updateConfig serializes concurrent mutations so later saves do not clobber earlier changes", async () => {
    const config = defaultConfig();
    await writeTestConfig(tempDir, config);

    await Promise.all([
      updateConfig(async (nextConfig) => {
        await Bun.sleep(20);
        nextConfig.sinks.push({
          id: "postgres-team",
          type: "postgres",
          enabled: true,
          connectionString: "postgresql://localhost:5432/jin",
        });
        return "sink";
      }),
      updateConfig((nextConfig) => {
        nextConfig.routes.push({
          match: { remote: "github.com/org/alpha" },
          sinks: ["postgres-team"],
        });
        return "route";
      }),
    ]);

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks.map((sink: { id: string }) => sink.id)).toEqual([
      "postgres-team",
    ]);
    expect(nextConfig.routes).toEqual([
      {
        match: { remote: "github.com/org/alpha" },
        sinks: ["postgres-team"],
      },
    ]);
  });

  test("sink add writes durable config and live-reloads by default", async () => {
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
    expect(configReloadRequests).toEqual([{}]);
    expect(console_.logs.join("\n")).toContain(
      "Running runtime accepted config reload request.",
    );
  });

  test("config mutation warns and keeps durable config when daemon reload notification fails", async () => {
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
      pid: 445,
      lifecycleState: "running",
    };
    runtimeStatus = {
      state: "running",
      owner: makeOwner("daemon", 445),
      issues: [],
    };
    configReloadResult = {
      status: "failed",
      message: "connection refused",
    };

    await routeAddCommand({
      remote: "https://github.com/org/alpha.git",
      sink: "postgres-team",
    });

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.routes).toEqual([
      {
        match: { remote: "github.com/org/alpha" },
        sinks: ["postgres-team"],
      },
    ]);
    expect(configReloadRequests).toEqual([{}]);
    expect(restartCalls).toHaveLength(0);
    expect(console_.logs.join("\n")).toContain(
      "WARNING: Config saved, but jin could not notify the running runtime to reload: connection refused",
    );
    expect(console_.logs.join("\n")).toContain(
      "File watcher fallback will try to apply the change; otherwise restart jin.",
    );
  });

  test("config mutation keeps next-start behavior when no daemon is running", async () => {
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

    await routeAddCommand({
      remote: "https://github.com/org/alpha.git",
      sink: "postgres-team",
    });

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.routes).toEqual([
      {
        match: { remote: "github.com/org/alpha" },
        sinks: ["postgres-team"],
      },
    ]);
    expect(configReloadRequests).toEqual([]);
    expect(console_.logs.join("\n")).toContain(
      "Changes will apply the next time jin starts.",
    );
  });

  test("sink add refuses duplicate transport endpoints when export identity differs", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "postgres-team-a",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://localhost:5432/jin",
        teamId: "team-a",
        userId: "alice",
      },
    ];
    await writeTestConfig(tempDir, config);

    await expect(
      sinkAddCommand("postgres", {
        id: "postgres-team-b",
        connectionString: "postgresql://localhost:5432/jin",
        teamId: "team-a",
        userId: "bob",
      }),
    ).rejects.toThrow();

    expect(console_.errors.join("\n")).toContain(
      'sink transport is already configured as "postgres-team-a" with different teamId/userId',
    );

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks).toEqual(config.sinks);
  });

  test("sink add health check runs outside the config lock", async () => {
    const lockStates: boolean[] = [];
    fakeSink = {
      ...createFakeSink(),
      healthCheck: async () => {
        lockStates.push(existsSync(configLockPath()));
        return { ok: true };
      },
    };

    await sinkAddCommand("postgres", {
      id: "postgres-team",
      connectionString: "postgresql://localhost:5432/jin",
    });

    expect(lockStates).toEqual([false]);
    expect(existsSync(configLockPath())).toBe(false);
  });

  test("route add --restart performs a service-aware controlled restart", async () => {
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
      restart: true,
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

  test("manual protected-source opt-in changes the startup notice after config update", async () => {
    const config = defaultConfig();
    mockAdapters = [];

    await writeTestConfig(tempDir, config);
    await expect(watchCommand({ daemon: false })).rejects.toThrow();

    const beforeLogs = console_.logs.join("\n");
    expect(beforeLogs).toContain(
      "Protected/app-private startup sources were not probed without explicit opt-in.",
    );
    expect(beforeLogs).toContain(
      "Cursor startup skips app-private globalStorage by default",
    );
    expect(beforeLogs).toContain(
      "set adapters.<id>.allowProtectedSource = true",
    );
    expect(beforeLogs).toContain("jin stop");
    expect(beforeLogs).toContain("jin start");

    console_.logs.length = 0;

    config.adapters.cursor = {
      ...config.adapters.cursor,
      allowProtectedSource: true,
    };
    await writeTestConfig(tempDir, config);

    await expect(watchCommand({ daemon: false })).rejects.toThrow();

    const afterLogs = console_.logs.join("\n");
    expect(afterLogs).not.toContain(
      "Cursor startup skips app-private globalStorage by default",
    );
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
    expect(configReloadRequests).toEqual([{}]);
    expect(restartCalls).toHaveLength(0);
    expect(markRuntimeRunningCalls).toEqual([]);
    expect(console_.logs.join("\n")).toContain(
      "Running runtime accepted config reload request.",
    );

    await sinkEnableCommand("postgres-team");

    nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks[0].enabled).toBe(true);
    expect(configReloadRequests).toEqual([{}, {}]);
    expect(markRuntimeRunningCalls).toEqual([]);
    expect(restartCalls).toHaveLength(0);
  });

  test("sink enable and disable --restart perform a controlled restart", async () => {
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
      pid: 516,
      lifecycleState: "running",
    };
    runtimeStatus = {
      state: "running",
      owner: makeOwner("service", 516),
      issues: [],
    };

    await sinkDisableCommand("postgres-team", { restart: true });

    let nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks[0].enabled).toBe(false);
    expect(configReloadRequests).toEqual([]);
    expect(restartCalls).toEqual([{ service: true }]);

    restartCalls = [];
    await sinkEnableCommand("postgres-team", { restart: true });

    nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks[0].enabled).toBe(true);
    expect(configReloadRequests).toEqual([]);
    expect(restartCalls).toEqual([{ service: true }]);
  });

  test("sink repush resets and replays only the selected sink state", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "postgres-team",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://localhost:5432/jin",
      },
      {
        id: "archive-webhook",
        type: "webhook",
        enabled: true,
        url: "https://example.test/archive",
        timeoutMs: 30_000,
      },
    ];
    config.routes = [
      {
        match: { remote: "github.com/org/repush" },
        sinks: ["postgres-team"],
      },
    ];
    await writeTestConfig(tempDir, config);

    const seededStore = openStoreAtPath(runtimePaths.storePath);
    try {
      seededStore.writeBundle(makeBundle("repush", "github.com/org/repush"));
      seededStore.recordPushResult(
        "repush-conversation",
        "postgres-team",
        1,
        { ok: true },
      );
      seededStore.recordPushResult(
        "repush-conversation",
        "archive-webhook",
        1,
        { ok: true },
      );
      seededStore.recordPushResult(
        "alpha-conversation",
        "archive-webhook",
        1,
        { ok: true },
      );
    } finally {
      seededStore.close();
    }

    const pushCalls: Array<Array<{ attemptedRevision: number; conversation: { id: string } }>> = [];
    fakeSink = {
      ...createFakeSink({
        id: "postgres-team",
        name: "postgres-team",
      }),
      push: async (payloads: PushPayload[]) => {
        pushCalls.push(
          payloads.map((payload) => ({
            attemptedRevision: payload.attemptedRevision,
            conversation: { id: payload.conversation.id },
          })),
        );
        return {
          pushed: payloads.length,
          failed: 0,
          errors: [],
        };
      },
    };

    await sinkRepushCommand("postgres-team");

    const reopenedStore = openStoreAtPath(runtimePaths.storePath);
    try {
      const postgresDirty = reopenedStore.conversationsNeedingPush("postgres-team");

      expect(pushCalls).toEqual([
        [
          {
            attemptedRevision: 1,
            conversation: { id: "repush-conversation" },
          },
        ],
      ]);
      expect(postgresDirty).toEqual(["alpha-conversation"]);
      expect(postgresDirty).not.toContain("repush-conversation");
      expect(reopenedStore.conversationsNeedingPush("archive-webhook")).toEqual([]);
    } finally {
      reopenedStore.close();
    }

    expect(console_.logs.join("\n")).toContain(
      "Reset 1 push-state row for sink postgres-team.",
    );
    expect(console_.logs.join("\n")).toContain(
      "Repush complete. attempts 1, pushed 1, failed 0.",
    );
    expect(existsSync(join(runtimePaths.configDir, "debug.jsonl"))).toBe(false);
  });

  test("connect resolves project routing to remote matches and preserves sink identity metadata", async () => {
    const teamCode = encodeTeamConfig({
      id: "workspace-postgres",
      type: "postgres",
      connectionString: "postgresql://team-db:5432/shared",
      teamId: "team-42",
      userId: "user-7",
    });

    await connectCommand("alpha", { team: teamCode });

    const config = await readTestConfig(tempDir);
    expect(config).not.toHaveProperty("team");
    expect(config.sinks[0]).toEqual({
      id: "workspace-postgres",
      type: "postgres",
      enabled: true,
      connectionString: "postgresql://team-db:5432/shared",
      teamId: "team-42",
      userId: "user-7",
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
    localEndpoint: runtimePaths.localEndpoint,
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
