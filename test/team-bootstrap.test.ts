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
let runtimeStatus: any;
let restartCalls: any[] = [];

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
  getRuntimeStatus: () => runtimeStatus,
  isServiceActive: () => false,
  isServiceInstalled: () => false,
  markRuntimeStarting: () => runtimeStatus,
  markRuntimeRunning: () => runtimeStatus,
  clearRuntimeState: () => {},
  runModeLabel: (mode: string) => mode,
}));

mock.module("../src/commands/start", () => ({
  restartCommand: async (opts: unknown) => {
    restartCalls.push(opts);
  },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────

import { teamBridgeCommand } from "../src/commands/team-bridge";
import { encodeTeamConfig } from "../src/sinks/types";
import {
  schemaApplyCommand,
  schemaApplySuccessGuidance,
  schemaCheckCommand,
  schemaVersionCommand,
  getIntegrationDDL,
  getIntegrationSchemaVersion,
} from "../src/commands/schema";
import {
  createTestEnv,
  writeTestConfig,
  readTestConfig,
  captureConsole,
  mockProcessExit,
  type TestEnv,
} from "./helpers";

// ── Test Suite ───────────────────────────────────────────────────────────

let env: TestEnv;
let console_: ReturnType<typeof captureConsole>;
let exitMock: ReturnType<typeof mockProcessExit>;

beforeEach(() => {
  env = createTestEnv();
  runtimePaths = {
    configDir: env.dir,
    configPath: join(env.dir, "config.json"),
    storePath: join(env.dir, "store.db"),
    logPath: join(env.dir, "jin.log"),
  };
  runtimeStatus = { state: "stopped", issues: [] };
  restartCalls = [];
  fakeSink = createFakeSink();
  console_ = captureConsole();
  exitMock = mockProcessExit();
});

afterEach(() => {
  console_.restore();
  exitMock.restore();
  env.cleanup();
});

// ── jin team bridge (was team-config) ───────────────────────────────────

describe("jin team bridge", () => {
  test("shows help text pointing developers to jin connect --team", async () => {
    await teamBridgeCommand({});

    const output = console_.logs.join("\n");
    expect(output).toContain("jin team bridge");
    expect(output).toContain("jin connect --team=");
    expect(output).toContain("operator command");
    // Must NOT reference jin team connect as the primary path
    expect(output).not.toContain("jin team connect");
  });

  test("generates bridge code directing developers to jin connect --team", async () => {
    await teamBridgeCommand({
      type: "webhook",
      name: "workspace-main",
      url: "https://workspace.example/jin",
    });

    const output = console_.logs.join("\n");
    expect(output).toContain("jin connect --team=");
    expect(output).toContain("bridge code generated");
    // Must NOT show jin team connect as primary onboarding
    expect(output).not.toContain("jin team connect");
  });

  test("bridge code is a valid base64 blob", async () => {
    await teamBridgeCommand({
      type: "postgres",
      name: "workspace-pg",
      connectionString: "postgresql://host/db",
    });

    const output = console_.logs.join("\n");
    // Extract the base64 after "jin connect --team="
    const match = output.match(/jin connect --team=(\S+)/);
    expect(match).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(match![1], "base64").toString("utf-8"));
    expect(decoded.type).toBe("postgres");
    expect(decoded.connectionString).toBe("postgresql://host/db");
  });
});

// ── Developer onboarding stays at connect --team ────────────────────────

describe("developer onboarding path", () => {
  test("connect --team remains the developer path (no jin team connect)", async () => {
    // The developer path is jin connect --team=<code>, exercised in connect.test.ts.
    // This test verifies the bridge output does NOT direct to jin team connect.
    await teamBridgeCommand({
      type: "webhook",
      name: "workspace-main",
      url: "https://workspace.example/jin",
    });

    const output = console_.logs.join("\n");
    expect(output).toContain("jin connect --team=");
    expect(output).not.toContain("jin team connect");
  });
});

// ── jin team schema apply ───────────────────────────────────────────────

describe("jin team schema apply", () => {
  test("shows help referencing jin team schema apply (not top-level)", async () => {
    await schemaApplyCommand({});

    const output = console_.logs.join("\n");
    expect(output).toContain("jin team schema apply");
    expect(output).toContain("operator escape hatch");
    expect(output).toContain("NOT part of the normal user onboarding");
    expect(output).toContain("jin connect --team=");
    // Must NOT reference top-level jin schema apply
    expect(output).not.toMatch(/^\s*jin schema apply/m);
  });

  test("dry-run prints DDL without executing", async () => {
    await schemaApplyCommand({
      connectionString: "postgres://user:pass@host/db",
      dryRun: true,
    });

    const output = console_.logs.join("\n");
    expect(output).toContain("dry run");
    expect(output).toContain("CREATE TABLE IF NOT EXISTS jin_meta");
    expect(output).toContain("CREATE TABLE IF NOT EXISTS jin_conversations");
    expect(output).toContain("CREATE TABLE IF NOT EXISTS jin_messages");
    expect(output).toContain("CREATE TABLE IF NOT EXISTS jin_tool_calls");
    expect(output).toContain("schema_version");
    // connection string should be masked
    expect(output).toContain("***@");
    expect(output).not.toContain("user:pass");
  });

  test("DDL includes all ontology-required tables and indexes", () => {
    const ddl = getIntegrationDDL();
    // Tables
    expect(ddl).toContain("jin_meta");
    expect(ddl).toContain("jin_conversations");
    expect(ddl).toContain("jin_messages");
    expect(ddl).toContain("jin_tool_calls");
    // Key columns from ontology
    expect(ddl).toContain("trace_id");
    expect(ddl).toContain("parent_id");
    expect(ddl).toContain("relationship");
    expect(ddl).toContain("adapter_id");
    expect(ddl).toContain("git_remote");
    expect(ddl).toContain("thinking_content");
    expect(ddl).toContain("is_sidechain");
    // Postgres types (not SQLite types)
    expect(ddl).toContain("TIMESTAMPTZ");
    expect(ddl).toContain("BOOLEAN");
    expect(ddl).toContain("DOUBLE PRECISION");
    expect(ddl).toContain("PRIMARY KEY (conversation_id, message_id, id)");
    // Indexes
    expect(ddl).toContain("idx_jin_conv_trace");
    expect(ddl).toContain("idx_jin_tc_name");
  });

  test("schema version stamp is emitted after table repair DDL", () => {
    const ddl = getIntegrationDDL();
    const schemaStampIndex = ddl.indexOf("INSERT INTO jin_meta (key, value)");
    const conversationRepairIndex = ddl.indexOf(
      "ALTER TABLE jin_conversations\n  ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT '';",
    );
    const toolCallRepairIndex = ddl.indexOf(
      "ALTER TABLE public.jin_tool_calls\n      ADD CONSTRAINT jin_tool_calls_pkey",
    );

    expect(schemaStampIndex).toBeGreaterThan(conversationRepairIndex);
    expect(schemaStampIndex).toBeGreaterThan(toolCallRepairIndex);
  });

  test("schema version matches sink expectations", () => {
    const version = getIntegrationSchemaVersion();
    expect(version).toMatch(/^\d+\.\d+$/);
    expect(version).toBe("2.5");
  });

  test("DDL comment references jin team schema apply (not top-level)", () => {
    const ddl = getIntegrationDDL();
    expect(ddl).toContain("jin team schema apply");
    expect(ddl).not.toMatch(/^-- Generated by: jin schema apply$/m);
  });

  test("success guidance stays inside jin team operator surface", () => {
    const guidance = schemaApplySuccessGuidance("***@host/db");
    const text = guidance.join("\n");
    // Must point to jin team bridge, not jin sink add
    expect(text).toContain("jin team bridge");
    expect(text).not.toContain("jin sink add");
    expect(text).not.toContain("jin sink add postgres");
    // Must also mention jin team help
    expect(text).toContain("jin team help");
    // Must include the masked connection string in the bridge command
    expect(text).toContain("***@host/db");
  });
});

// ── jin team schema check ───────────────────────────────────────────────

describe("jin team schema check", () => {
  test("shows help when no connection string provided", async () => {
    await schemaCheckCommand({});

    const output = console_.logs.join("\n");
    expect(output).toContain("jin team schema check");
  });
});

// ── jin team schema version ─────────────────────────────────────────────

describe("jin team schema version", () => {
  test("prints the expected schema version", () => {
    schemaVersionCommand();

    const output = console_.logs.join("\n").trim();
    expect(output).toBe("2.5");
  });
});

// ── Namespace boundary checks ───────────────────────────────────────────

describe("namespace boundary", () => {
  test("team bridge help text does not leak schema commands into developer namespace", async () => {
    await teamBridgeCommand({});

    const output = console_.logs.join("\n");
    // Bridge help should not mention schema apply
    expect(output).not.toContain("schema apply");
    expect(output).not.toContain("schema check");
  });

  test("schema apply help text does not reference jin team connect", async () => {
    await schemaApplyCommand({});

    const output = console_.logs.join("\n");
    // Schema help should direct developers to connect --team, not team connect
    expect(output).toContain("jin connect --team=");
    expect(output).not.toContain("jin team connect");
  });

  test("teamConnectCommand is not exported (deferred per BP-09)", () => {
    // Verify the prior-pass exports were removed
    const exports = Object.keys(require("../src/commands/team-bridge"));
    expect(exports).not.toContain("teamConnectCommand");
    expect(exports).not.toContain("teamStatusCommand");
    expect(exports).not.toContain("teamDisconnectCommand");
  });
});
