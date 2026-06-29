import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { defaultConfig } from "../src/config";
import { openStoreAtPath } from "../src/db/store";
import type { ConversationBundle } from "../src/contracts/conversations";
import { encodeTeamConfig } from "../src/sinks/types";
import {
  captureConsole,
  createFakeSink,
  mockProcessExit,
  removeTestDir,
  readTestConfig,
  writeTestConfig,
  ExitError,
} from "./helpers";

let fakeSink = createFakeSink();
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

mock.module("../src/daemon/runtime-state", () => ({
  getRuntimePaths: () => runtimePaths,
  getRuntimeStatus: () => ({ state: "stopped", issues: [] }),
  getRuntimeStatusForCurrentProcess: () => ({ state: "stopped", issues: [] }),
  isServiceInstalled: () => false,
  markRuntimeStarting: () => ({ state: "starting", issues: [] }),
  markRuntimeRunning: () => ({ state: "running", issues: [] }),
  clearRuntimeState: () => {},
  clearRuntimePidFile: () => {},
  runModeLabel: (mode: string) => mode,
}));

mock.module("../src/daemon/process-state", () => ({
  getWatcherState: () => ({ name: "watcher", status: "stopped", lifecycleState: "stopped" }),
  getAllState: () => [{ name: "watcher", status: "stopped", lifecycleState: "stopped" }],
  getDashboardState: () => ({ name: "dashboard", status: "stopped" }),
  stopWatcher: async () => ({ requested: false, completed: true, forced: false }),
  stopDashboard: async () => {},
}));

import {
  connectCommand,
  connectionsCommand,
  disconnectCommand,
  interactiveConnect,
} from "../src/commands/connect";

let tempDir = "";
let console_: ReturnType<typeof captureConsole>;
let exitMock: ReturnType<typeof mockProcessExit>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "jin-connect-"));
  process.env.JIN_CONFIG_DIR = tempDir;
  runtimePaths = {
    configDir: tempDir,
    configPath: join(tempDir, "config.json"),
    storePath: join(tempDir, "store.db"),
    logPath: join(tempDir, "jin.log"),
    localEndpoint: join(tempDir, "jin.sock"),
    socketPath: join(tempDir, "jin.sock"),
  };
  console_ = captureConsole();
  exitMock = mockProcessExit();
  fakeSink = createFakeSink();
  seedRepos();
});

afterEach(() => {
  console_.restore();
  exitMock.restore();
  delete process.env.JIN_CONFIG_DIR;
  removeTestDir(tempDir);
});

afterAll(() => {
  mock.restore();
});

describe("jin connect", () => {
  test("connect with --sink routes to an existing destination", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "postgres-main",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://localhost:5432/jin",
      },
    ];
    await writeTestConfig(tempDir, config);

    await connectCommand("alpha", { sink: "postgres-main" });

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks).toHaveLength(1);
    expect(nextConfig.routes).toEqual([
      {
        match: { remote: "github.com/org/alpha" },
        sinks: ["postgres-main"],
      },
    ]);
  });

  test("connect with --team creates a sink and routes the selected repo", async () => {
    const teamCode = encodeTeamConfig({
      id: "workspace-postgres",
      type: "postgres",
      connectionString: "postgresql://team-db:5432/shared",
      teamId: "team-42",
      userId: "user-7",
    });

    await connectCommand("alpha", { team: teamCode });

    const config = await readTestConfig(tempDir);
    expect(config.sinks).toEqual([
      {
        id: "workspace-postgres",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://team-db:5432/shared",
        teamId: "team-42",
        userId: "user-7",
      },
    ]);
    expect(config.routes).toEqual([
      {
        match: { remote: "github.com/org/alpha" },
        sinks: ["workspace-postgres"],
      },
    ]);
  });

  test("connect with --team refuses endpoint reuse when export identity differs", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "workspace-postgres",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://team-db:5432/shared",
        teamId: "team-42",
        userId: "user-1",
      },
    ];
    await writeTestConfig(tempDir, config);

    const teamCode = encodeTeamConfig({
      id: "workspace-postgres-2",
      type: "postgres",
      connectionString: "postgresql://team-db:5432/shared",
      teamId: "team-42",
      userId: "user-7",
    });

    await expect(connectCommand("alpha", { team: teamCode })).rejects.toThrow(
      ExitError,
    );

    expect(console_.errors.join("\n")).toContain(
      'sink transport is already configured as "workspace-postgres" with different teamId/userId',
    );

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.sinks).toEqual(config.sinks);
    expect(nextConfig.routes).toEqual([]);
  });

  test("connect with --remote writes a remote-based route", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "analytics-webhook",
        type: "webhook",
        enabled: true,
        url: "https://example.test/jin",
        timeoutMs: 30000,
      },
    ];
    await writeTestConfig(tempDir, config);

    await connectCommand("", {
      remote: "https://github.com/org/alpha.git",
      sink: "analytics-webhook",
    });

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.routes).toEqual([
      {
        match: { remote: "github.com/org/alpha" },
        sinks: ["analytics-webhook"],
      },
    ]);
  });

  test("connect json mode lists repos from the v2 query surface", async () => {
    await connectCommand("", { json: true });

    const parsed = JSON.parse(console_.logs.join("\n"));
    expect(parsed.projects).toEqual(["alpha", "beta"]);
    expect(parsed.connected).toEqual([]);
    expect(parsed.unrouted).toEqual(["alpha", "beta"]);
  });

  test("connect rejects removed one-step sink creation flags", async () => {
    await expect(
      connectCommand("alpha", {
        // @ts-expect-error packet removes this compatibility shortcut
        postgres: "postgresql://localhost:5432/jin",
      }),
    ).rejects.toThrow(ExitError);

    expect(console_.errors.join("\n")).toContain("no longer creates sinks directly");
    expect(console_.errors.join("\n")).toContain("--postgres");
  });
});

describe("jin interactiveConnect", () => {
  test("json mode reports repos and routing summary", async () => {
    await interactiveConnect({ json: true });

    const parsed = JSON.parse(console_.logs.join("\n"));
    expect(parsed.projects).toEqual(["alpha", "beta"]);
    expect(parsed.connected).toEqual([]);
    expect(parsed.unrouted).toEqual(["alpha", "beta"]);
  });
});

describe("jin disconnect", () => {
  test("disconnect removes a route and keeps the sink by default", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "postgres-main",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://localhost:5432/jin",
      },
    ];
    await writeTestConfig(tempDir, config);

    await connectCommand("alpha", { sink: "postgres-main" });
    await disconnectCommand("alpha", {});

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.routes).toEqual([]);
    expect(nextConfig.sinks).toHaveLength(1);
  });

  test("disconnect --remove-sink removes an unused destination", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "postgres-main",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://localhost:5432/jin",
      },
    ];
    await writeTestConfig(tempDir, config);

    await connectCommand("alpha", { sink: "postgres-main" });
    await disconnectCommand("alpha", { "remove-sink": true });

    const nextConfig = await readTestConfig(tempDir);
    expect(nextConfig.routes).toEqual([]);
    expect(nextConfig.sinks).toEqual([]);
  });
});

describe("jin connections", () => {
  test("connections summarizes routes, local-only repos, and destinations", async () => {
    const config = defaultConfig();
    config.sinks = [
      {
        id: "postgres-main",
        type: "postgres",
        enabled: true,
        connectionString: "postgresql://localhost:5432/jin",
      },
    ];
    await writeTestConfig(tempDir, config);

    await connectCommand("alpha", { sink: "postgres-main" });
    await connectionsCommand();

    const output = console_.logs.join("\n");
    expect(output).toContain("Routes:");
    expect(output).toContain("Routed Repos:");
    expect(output).toContain("Local-only Repos:");
    expect(output).toContain("Destinations:");
  });
});

function seedRepos(): void {
  const store = openStoreAtPath(runtimePaths.storePath);
  try {
    store.writeBundle(makeBundle("alpha-root", "github.com/org/alpha"));
    store.writeBundle(makeBundle("beta-root", "github.com/org/beta"));
  } finally {
    store.close();
  }
}

function makeBundle(id: string, gitRemote: string): ConversationBundle {
  return {
    conversation: {
      id,
      traceId: id,
      parentId: "",
      relationship: "root",
      forkPoint: -1,
      adapterId: "mock-adapter",
      name: `${gitRemote} conversation`,
      cwd: "/tmp",
      gitRemote,
      branch: "main",
      model: "mock-model",
      startedAt: "2026-04-01T00:00:00.000Z",
      endedAt: "2026-04-01T00:01:00.000Z",
      sourcePath: `/tmp/${id}.jsonl`,
      sourceFormat: "jsonl",
    },
    messages: [
      {
        id: `${id}-m1`,
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
