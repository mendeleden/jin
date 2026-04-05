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
import { captureConsole } from "./helpers";

let watcherState: any;
let dashboardState: any;
let runtimeStatus: any;
let stopWatcherResult: any;
let stopWatcherCalls: any[] = [];
let watchCalls: any[] = [];
let serviceCalls: any[] = [];
let uiCalls: any[] = [];
let serviceInstalled = false;
let configValue: any;
let runtimePaths = {
  configDir: "",
  configPath: "",
  storePath: "",
  logPath: "",
};

mock.module("../src/daemon/process-state", () => ({
  getWatcherState: () => watcherState,
  getDashboardState: () => dashboardState,
  getAllState: () => [watcherState, dashboardState],
  stopWatcher: async (options?: unknown) => {
    stopWatcherCalls.push(options);
    return stopWatcherResult;
  },
  stopDashboard: async () => {
    dashboardState = { ...dashboardState, status: "stopped" };
  },
}));

mock.module("../src/daemon/runtime-state", () => ({
  clearRuntimeState: () => {},
  getRuntimePaths: () => runtimePaths,
  getRuntimeStatus: () => runtimeStatus,
  isServiceInstalled: () => serviceInstalled,
  markRuntimeRunning: () => runtimeStatus,
  markRuntimeStarting: () => runtimeStatus,
  runModeLabel: (mode: string) => {
    switch (mode) {
      case "service":
        return "OS service manager";
      case "daemon":
        return "background daemon (jin start)";
      case "foreground":
        return "foreground runtime (jin start --foreground)";
      default:
        return "not running";
    }
  },
}));

mock.module("../src/commands/watch", () => ({
  watchCommand: async (options: unknown) => {
    watchCalls.push(options);
  },
}));

mock.module("../src/commands/service", () => ({
  serviceCommand: async (action: unknown) => {
    serviceCalls.push(action);
  },
}));

mock.module("../src/api/server", () => ({
  startDetached: async (options: unknown) => {
    uiCalls.push(options);
  },
}));

mock.module("../src/config", () => ({
  configPath: () => runtimePaths.configPath,
  loadConfig: async () => configValue,
}));

import { startCommand } from "../src/commands/start";
import { stopCommand } from "../src/commands/stop";
import { statusCommand } from "../src/commands/status";

let console_: ReturnType<typeof captureConsole>;
let tempDir = "";

function makeOwner(mode: "daemon" | "service" | "foreground", pid = 321) {
  return {
    pid,
    mode,
    startedAt: "2026-04-01T12:00:00.000Z",
    configDir: runtimePaths.configDir,
    storePath: runtimePaths.storePath,
    logPath: runtimePaths.logPath,
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "jin-lifecycle-"));
  runtimePaths = {
    configDir: tempDir,
    configPath: join(tempDir, "config.json"),
    storePath: join(tempDir, "store.db"),
    logPath: join(tempDir, "jin.log"),
  };

  watcherState = { name: "watcher", status: "stopped", lifecycleState: "stopped" };
  dashboardState = { name: "dashboard", status: "stopped" };
  runtimeStatus = { state: "stopped", issues: [] };
  stopWatcherResult = {
    requested: false,
    completed: true,
    forced: false,
    via: "none",
  };
  stopWatcherCalls = [];
  watchCalls = [];
  serviceCalls = [];
  uiCalls = [];
  serviceInstalled = false;
  configValue = { sinks: [], routes: [] };
  console_ = captureConsole();
});

afterEach(() => {
  console_.restore();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("lifecycle runtime boundary", () => {
  test("starting a second detached owner is blocked", async () => {
    watcherState = {
      name: "watcher",
      status: "running",
      mode: "daemon",
      pid: 412,
      lifecycleState: "running",
    };
    runtimeStatus = {
      state: "running",
      owner: makeOwner("daemon", 412),
      issues: [],
    };

    await startCommand({});

    expect(watchCalls).toHaveLength(0);
    const output = console_.logs.join("\n");
    expect(output).toContain("already running as a detached daemon");
    expect(output).toContain("second owner");
  });

  test("service-owned runtime is reported instead of spawning a daemon", async () => {
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

    await startCommand({});

    expect(watchCalls).toHaveLength(0);
    const output = console_.logs.join("\n");
    expect(output).toContain("OS service manager");
    expect(output).toContain("instead of spawning a daemon");
  });

  test("service install path waits for the existing owner to stop", async () => {
    watcherState = {
      name: "watcher",
      status: "running",
      mode: "daemon",
      pid: 901,
      lifecycleState: "running",
    };
    runtimeStatus = {
      state: "running",
      owner: makeOwner("daemon", 901),
      issues: [],
    };
    stopWatcherResult = {
      requested: true,
      completed: true,
      forced: false,
      via: "signal",
      owner: makeOwner("daemon", 901),
    };

    await startCommand({ service: true });

    expect(stopWatcherCalls).toHaveLength(1);
    expect(stopWatcherCalls[0]).toEqual({
      waitForExitMs: 15_000,
      forceAfterTimeout: true,
    });
    expect(serviceCalls).toEqual(["install"]);
  });

  test("stop behaves like a bounded control-plane action", async () => {
    watcherState = {
      name: "watcher",
      status: "running",
      mode: "daemon",
      pid: 515,
      lifecycleState: "stopping",
    };
    runtimeStatus = {
      state: "stopping",
      owner: makeOwner("daemon", 515),
      issues: [],
    };
    stopWatcherResult = {
      requested: true,
      completed: false,
      forced: false,
      via: "signal",
      owner: makeOwner("daemon", 515),
    };

    await stopCommand({ watcher: true });

    const output = console_.logs.join("\n");
    expect(output).toContain("Requesting watcher shutdown");
    expect(output).toContain("Shutdown requested. The runtime is still stopping.");
    expect(output).not.toContain("Watcher stopped.");
  });

  test("status works while stopped", async () => {
    runtimeStatus = { state: "stopped", issues: [] };

    await statusCommand({ json: true });

    const parsed = JSON.parse(console_.logs.join("\n"));
    expect(parsed.runtime.state).toBe("stopped");
    expect(parsed.paths.config).toBe(runtimePaths.configPath);
    expect(parsed.paths.store).toBe(runtimePaths.storePath);
    expect(parsed.components[0].status).toBe("stopped");
  });
});
