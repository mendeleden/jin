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
import { ExitError, captureConsole, mockProcessExit } from "./helpers";

let runtimeStatus: any;
let runtimePaths = {
  configDir: "",
  configPath: "",
  storePath: "",
  logPath: "",
  localEndpoint: "",
  socketPath: "",
};
let clearRuntimeStateCalls = 0;
let watchFailure: unknown = null;
let ingestFailure: unknown = null;

mock.module("../src/daemon/process-state", () => ({
  getWatcherState: () => ({ status: "stopped" }),
  getAllState: () => [{ status: "stopped" }],
  getDashboardState: () => ({ status: "stopped" }),
  stopDashboard: async () => {},
  stopWatcher: async () => ({ completed: true }),
}));

mock.module("../src/daemon/runtime-state", () => ({
  clearRuntimeState: () => {
    clearRuntimeStateCalls += 1;
  },
  getRuntimePaths: () => runtimePaths,
  getRuntimeStatus: () => runtimeStatus,
  isServiceInstalled: () => false,
  markRuntimeRunning: () => {},
  markRuntimeStarting: () => {},
  runModeLabel: (mode: string) => mode,
}));

mock.module("../src/commands/watch", () => ({
  watchCommand: async () => {
    throw watchFailure;
  },
}));

mock.module("../src/config", () => ({
  loadConfig: async () => ({
    adapters: {},
    sinks: [],
    routes: [],
  }),
  resolveAdapterConfig: () => ({ enabled: true }),
}));

mock.module("../src/adapters/registry", () => ({
  allAdapters: () => [
    {
      id: "mock-adapter",
      detect: async () => true,
    },
  ],
}));

mock.module("../src/pipeline/ingest", () => ({
  ingestAll: async () => {
    throw ingestFailure;
  },
}));

mock.module("../src/pipeline/push", () => ({
  pushDirty: async () => ({
    sinkAttempts: 0,
    pushedConversations: 0,
    failedConversations: 0,
  }),
}));

const { startCommand } = await import("../src/commands/start");
const { ingestCommand } = await import("../src/commands/ingest");

let tempDir = "";
let console_: ReturnType<typeof captureConsole>;
let exitMock: ReturnType<typeof mockProcessExit> | null = null;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "jin-poisoned-store-"));
  runtimePaths = {
    configDir: tempDir,
    configPath: join(tempDir, "config.json"),
    storePath: join(tempDir, "store.db"),
    logPath: join(tempDir, "jin.log"),
    localEndpoint: join(tempDir, "jin.sock"),
    socketPath: join(tempDir, "jin.sock"),
  };
  runtimeStatus = { state: "stopped", issues: [] };
  clearRuntimeStateCalls = 0;
  watchFailure = null;
  ingestFailure = null;
  console_ = captureConsole();
});

afterEach(() => {
  console_.restore();
  exitMock?.restore();
  exitMock = null;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("W3-RECOVERY-01 poisoned local store recovery guidance", () => {
  test("startCommand maps readonly-store failures to reset guidance", async () => {
    watchFailure = new Error("SQLiteError: attempt to write a readonly database");
    exitMock = mockProcessExit();

    await expect(startCommand({})).rejects.toBeInstanceOf(ExitError);

    const output = console_.errors.join("\n");
    expect(output).toContain(
      "Experimental v2 local state is unrecoverable after the previous shutdown.",
    );
    expect(output).toContain(`remove ${tempDir}`);
    expect(output).toContain("Jin will not repair or delete the SQLite files automatically.");
    expect(output).not.toContain("SQLiteError");
    expect(output).not.toContain("readonly database");
    expect(clearRuntimeStateCalls).toBe(1);
  });

  test("ingestCommand maps cantopen failures to reset guidance", async () => {
    ingestFailure = new Error("SQLiteError: unable to open database file");
    exitMock = mockProcessExit();

    await expect(ingestCommand()).rejects.toBeInstanceOf(ExitError);

    const output = console_.errors.join("\n");
    expect(output).toContain(
      "Experimental v2 local state is unrecoverable after the previous shutdown.",
    );
    expect(output).toContain(`remove ${tempDir}`);
    expect(output).toContain("Jin will not repair or delete the SQLite files automatically.");
    expect(output).not.toContain("SQLiteError");
    expect(output).not.toContain("unable to open database file");
  });
});
