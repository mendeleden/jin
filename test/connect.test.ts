import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { join } from "path";
import { createFakeSink } from "./helpers";

// ── Module Mocks (hoisted by bun) ────────────────────────────────────────

let fakeSink = createFakeSink();
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
  getWatcherState: () => ({ name: "watcher", status: "stopped", lifecycleState: "stopped" }),
  getDashboardState: () => ({ name: "dashboard", status: "stopped" }),
  getAllState: () => [],
  stopWatcher: async () => ({ requested: false, completed: true, forced: false }),
  stopDashboard: async () => {},
}));

mock.module("../src/daemon/runtime-state", () => ({
  getRuntimePaths: () => runtimePaths,
  getRuntimeStatus: () => ({ state: "stopped", issues: [] }),
  isServiceInstalled: () => false,
  markRuntimeStarting: () => ({ state: "starting", issues: [] }),
  markRuntimeRunning: () => ({ state: "running", issues: [] }),
  clearRuntimeState: () => {},
  runModeLabel: (mode: string) => mode,
}));

// ── Imports (after mocks) ────────────────────────────────────────────────

import {
  connectCommand,
  disconnectCommand,
  connectionsCommand,
  interactiveConnect,
} from "../src/commands/connect";
import { encodeTeamConfig } from "../src/sinks/types";
import {
  createTestEnv,
  seedStore,
  writeTestConfig,
  readTestConfig,
  captureConsole,
  mockProcessExit,
  ExitError,
  type TestEnv,
} from "./helpers";

// ── Test Suite ───────────────────────────────────────────────────────────

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
  console_ = captureConsole();
  exitMock = mockProcessExit();
  fakeSink = createFakeSink();
});

afterEach(() => {
  console_.restore();
  exitMock.restore();
  env.cleanup();
});

// ── jin connect ──────────────────────────────────────────────────────────

describe("jin connect", () => {
  test("connect with --postgres creates sink + route", async () => {
    await connectCommand("alpha", {
      postgres: "postgresql://localhost:5432/jin",
    });

    const config = await readTestConfig(env.dir);
    expect(config.sinks).toHaveLength(1);
    expect(config.sinks[0].type).toBe("postgres");
    expect(config.sinks[0].connectionString).toBe("postgresql://localhost:5432/jin");
    expect(config.routes).toHaveLength(1);
    expect(config.routes[0].match.remote).toBe("github.com/org/alpha");
    expect(config.routes[0].sinks).toContain("postgres-0");
  });

  test("connect same project again is idempotent (updates, not duplicates)", async () => {
    await connectCommand("alpha", {
      postgres: "postgresql://localhost:5432/jin",
    });
    await connectCommand("alpha", {
      postgres: "postgresql://localhost:5432/jin_v2",
    });

    const config = await readTestConfig(env.dir);
    // Second sink created because different connection string
    expect(config.sinks).toHaveLength(2);
    // But only 1 route for alpha — updated, not duplicated
    expect(config.routes).toHaveLength(1);
    expect(config.routes[0].match.remote).toBe("github.com/org/alpha");
  });

  test("connect with --sink routes to existing sink (no new sink)", async () => {
    // Create a sink first
    await connectCommand("alpha", {
      postgres: "postgresql://localhost:5432/jin",
    });

    const configBefore = await readTestConfig(env.dir);
    const sinkCount = configBefore.sinks.length;

    // Route another project to the same sink
    await connectCommand("beta", { sink: "postgres-0" });

    const config = await readTestConfig(env.dir);
    expect(config.sinks).toHaveLength(sinkCount); // no new sink
    expect(config.routes).toHaveLength(2);
    expect(config.routes[1].match.remote).toBe("github.com/org/beta");
    expect(config.routes[1].sinks).toContain("postgres-0");
  });

  test("connect with --sink fails if sink ID doesn't exist", async () => {
    await expect(
      connectCommand("alpha", { sink: "nonexistent-99" })
    ).rejects.toThrow(ExitError);

    const output = console_.errors.join("\n");
    expect(output).toContain("not found");
  });

  test("connect with --team decodes base64 and creates sink + route", async () => {
    const teamCode = encodeTeamConfig({
      type: "postgres",
      connectionString: "postgresql://team-db:5432/shared",
      teamId: "team-42",
    });

    await connectCommand("alpha", { team: teamCode });

    const config = await readTestConfig(env.dir);
    expect(config.sinks).toHaveLength(1);
    expect(config.sinks[0].connectionString).toBe("postgresql://team-db:5432/shared");
    expect(config.routes).toHaveLength(1);
    expect(config.routes[0].match.remote).toBe("github.com/org/alpha");
  });

  test("connect with --remote creates remote-based route", async () => {
    await connectCommand("", {
      remote: "github.com/org/alpha",
      postgres: "postgresql://localhost:5432/jin",
    });

    const config = await readTestConfig(env.dir);
    expect(config.routes).toHaveLength(1);
    expect(config.routes[0].match.remote).toBe("github.com/org/alpha");
    expect(config.routes[0].match.project).toBeUndefined();
  });

  test("connect with no args calls interactiveConnect", async () => {
    // With no project, no remote, no directory, and no sink opts → interactiveConnect
    // Use json mode so it doesn't try to open a readline interface
    await connectCommand("", { json: true });

    const output = console_.logs.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("projects");
    expect(parsed).toHaveProperty("connected");
    expect(parsed).toHaveProperty("unrouted");
  });

  test("connect with no sink type shows usage", async () => {
    await expect(
      connectCommand("alpha", {})
    ).rejects.toThrow(ExitError);

    const output = console_.errors.join("\n");
    expect(output).toContain("specify a sink type or existing sink");
  });

  test("duplicate connection string reuses existing sink", async () => {
    const connStr = "postgresql://localhost:5432/jin";
    await connectCommand("alpha", { postgres: connStr });
    await connectCommand("beta", { postgres: connStr });

    const config = await readTestConfig(env.dir);
    // Same connection string → same sink reused
    expect(config.sinks).toHaveLength(1);
    expect(config.routes).toHaveLength(2);
    // Both routes point to the same sink
    expect(config.routes[0].sinks[0]).toBe(config.routes[1].sinks[0]);
  });

  test("connect with sink opts but no match target shows error", async () => {
    await expect(
      connectCommand("", { postgres: "postgresql://localhost:5432/jin" })
    ).rejects.toThrow(ExitError);

    const output = console_.errors.join("\n");
    expect(output).toContain("specify a local repo");
  });

  test("connect no longer supports the legacy --directory bridge", async () => {
    await expect(
      connectCommand("", {
        // @ts-expect-error legacy bridge intentionally unsupported
        directory: "/home/dev/projects/alpha",
        postgres: "postgresql://localhost:5432/jin",
      })
    ).rejects.toThrow(ExitError);

    const output = console_.errors.join("\n");
    expect(output).toContain("specify a local repo or --remote");
  });
});

// ── jin interactiveConnect ──────────────────────────────────────────────

describe("jin interactiveConnect", () => {
  test("json mode returns projects/connected/unrouted", async () => {
    await interactiveConnect({ json: true });

    const output = console_.logs.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("projects");
    expect(Array.isArray(parsed.projects)).toBe(true);
    expect(parsed).toHaveProperty("connected");
    expect(parsed).toHaveProperty("unrouted");
  });
});

// ── jin disconnect ───────────────────────────────────────────────────────

describe("jin disconnect", () => {
  test("disconnect removes route, keeps sink", async () => {
    await connectCommand("alpha", {
      postgres: "postgresql://localhost:5432/jin",
    });

    await disconnectCommand("alpha", {});

    const config = await readTestConfig(env.dir);
    expect(config.routes).toHaveLength(0);
    // Sink is kept
    expect(config.sinks).toHaveLength(1);

    const output = console_.logs.join("\n");
    expect(output).toContain("Disconnected alpha");
  });

  test("disconnect --remove-sink removes sink if unused", async () => {
    await connectCommand("alpha", {
      postgres: "postgresql://localhost:5432/jin",
    });

    await disconnectCommand("alpha", { "remove-sink": true });

    const config = await readTestConfig(env.dir);
    expect(config.routes).toHaveLength(0);
    expect(config.sinks).toHaveLength(0);
  });

  test("disconnect --remove-sink keeps sink if other routes use it", async () => {
    const connStr = "postgresql://localhost:5432/jin";
    await connectCommand("alpha", { postgres: connStr });
    await connectCommand("beta", { postgres: connStr });

    // Disconnect alpha with --remove-sink
    await disconnectCommand("alpha", { "remove-sink": true });

    const config = await readTestConfig(env.dir);
    expect(config.routes).toHaveLength(1); // beta's route remains
    expect(config.sinks).toHaveLength(1); // sink kept (still used by beta)

    const output = console_.logs.join("\n");
    expect(output).toContain("still used");
  });

  test("disconnect non-existent project shows error", async () => {
    await expect(
      disconnectCommand("nonexistent", {})
    ).rejects.toThrow(ExitError);

    const output = console_.errors.join("\n");
    expect(output).toContain('repo "nonexistent" was not found');
  });
});

// ── jin connections ──────────────────────────────────────────────────────

describe("jin connections", () => {
  test("shows connected projects with full paths", async () => {
    await connectCommand("alpha", {
      postgres: "postgresql://localhost:5432/jin",
    });

    await connectionsCommand();

    const output = console_.logs.join("\n");
    expect(output).toContain("Routed Repos");
    expect(output).toContain("alpha");
    expect(output).toContain("postgres-0");
  });

  test("shows remote-based routes", async () => {
    await connectCommand("", {
      remote: "github.com/org/alpha",
      postgres: "postgresql://localhost:5432/jin",
    });

    await connectionsCommand();

    const output = console_.logs.join("\n");
    expect(output).toContain("remote:github.com/org/alpha");
  });

  test("shows configured sinks with usage count", async () => {
    await connectCommand("alpha", {
      postgres: "postgresql://localhost:5432/jin",
    });

    await connectionsCommand();

    const output = console_.logs.join("\n");
    expect(output).toContain("Destinations");
    expect(output).toContain("postgres-0");
    expect(output).toContain("1 route");
  });

  test("empty state shows help message", async () => {
    // No sinks, no routes, and no projects in the store
    // Need a fresh env without seeded data
    env.cleanup();
    env = createTestEnv();
    // Don't seed store - leave it empty

    await connectionsCommand();

    const output = console_.logs.join("\n");
    expect(output).toContain("No workspace or integration routing configured");
  });
});
