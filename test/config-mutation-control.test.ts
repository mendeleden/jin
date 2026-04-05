import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { join } from "path";
import {
  captureConsole,
  createFakeSink,
  createTestEnv,
  mockProcessExit,
  readTestConfig,
  seedStore,
  type TestEnv,
  writeTestConfig,
} from "./helpers";

let fakeSink = createFakeSink();
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
}));

mock.module("../src/daemon/runtime-state", () => ({
  getRuntimeStatus: () => runtimeStatus,
  getRuntimePaths: () => runtimePaths,
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
}));

mock.module("../src/commands/start", () => ({
  restartCommand: async (opts: unknown) => {
    restartCalls.push(opts);
  },
}));

mock.module("../src/adapters/registry", () => ({
  allAdapters: () => [],
}));

mock.module("../src/commands/ingest", () => ({
  ingestCommand: async () => {},
}));

const { defaultConfig } = await import("../src/config");
const { encodeTeamConfig } = await import("../src/sinks/types");
const { connectCommand } = await import("../src/commands/connect");
const { initCommand } = await import("../src/commands/init");
const { routeAddCommand } = await import("../src/commands/route");
const {
  sinkAddCommand,
  sinkDisableCommand,
  sinkEnableCommand,
} = await import("../src/commands/sink");

let env: TestEnv;
let console_: ReturnType<typeof captureConsole>;
let exitMock: ReturnType<typeof mockProcessExit>;

beforeEach(() => {
  env = createTestEnv();
  seedStore(env.store);
  runtimePaths = {
    configDir: env.dir,
    configPath: join(env.dir, "config.json"),
    storePath: join(env.dir, "store.db"),
    logPath: join(env.dir, "jin.log"),
  };
  watcherState = { name: "watcher", status: "stopped", lifecycleState: "stopped" };
  runtimeStatus = { state: "stopped", issues: [] };
  restartCalls = [];
  markRuntimeRunningCalls = [];
  fakeSink = createFakeSink();
  console_ = captureConsole();
  exitMock = mockProcessExit();
});

afterEach(() => {
  console_.restore();
  exitMock.restore();
  env.cleanup();
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

    const config = await readTestConfig(env.dir);
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
    await writeTestConfig(env.dir, config);

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

    const nextConfig = await readTestConfig(env.dir);
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
    await writeTestConfig(env.dir, config);

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

    let nextConfig = await readTestConfig(env.dir);
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

    nextConfig = await readTestConfig(env.dir);
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

    const config = await readTestConfig(env.dir);
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

  test("init --team keeps generic config separate from workspace metadata", async () => {
    const teamCode = encodeTeamConfig({
      id: "workspace-webhook",
      type: "webhook",
      url: "https://workspace.example.test/jin",
      teamId: "workspace-1",
      developerId: "dev-11",
    });

    await initCommand({ team: teamCode, json: true });

    const config = await readTestConfig(env.dir);
    expect(config).not.toHaveProperty("team");
    expect(config.sinks).toEqual([
      {
        id: "workspace-webhook",
        type: "webhook",
        enabled: true,
        url: "https://workspace.example.test/jin",
        timeoutMs: 30000,
      },
    ]);

    const parsed = JSON.parse(console_.logs.at(-1)!);
    expect(parsed.sinks).toEqual([
      {
        id: "workspace-webhook",
        type: "webhook",
        enabled: true,
      },
    ]);
  });
});

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
