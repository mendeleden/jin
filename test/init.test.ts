import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createFakeSink, makeSession } from "./helpers";
import type { Adapter, Session, Message } from "../src/adapters/types";

// ── Module Mocks (hoisted by bun) ────────────────────────────────────────

let fakeSink = createFakeSink();
let mockAdapters: Adapter[] = [];

mock.module("../src/sinks/registry", () => ({
  createSink: () => fakeSink,
  availableSinks: () => ["postgres", "webhook", "s3"],
}));

mock.module("../src/adapters/registry", () => ({
  allAdapters: () => mockAdapters,
  detectAdapters: async () => [],
}));

// ── Imports (after mocks) ────────────────────────────────────────────────

import { initCommand } from "../src/commands/init";
import { encodeTeamConfig } from "../src/sinks/types";
import {
  createTestEnv,
  writeTestConfig,
  readTestConfig,
  captureConsole,
  mockProcessExit,
  type TestEnv,
} from "./helpers";
import { defaultConfig } from "../src/config";
import { Store } from "../src/store";
import { readProgress, clearProgress } from "../src/progress";
import { statusCommand } from "../src/commands/status";

// ── Test Suite ───────────────────────────────────────────────────────────

let env: TestEnv;
let console_: ReturnType<typeof captureConsole>;
let exitMock: ReturnType<typeof mockProcessExit>;

beforeEach(() => {
  env = createTestEnv();
  console_ = captureConsole();
  exitMock = mockProcessExit();
  fakeSink = createFakeSink();
  mockAdapters = [];
});

afterEach(() => {
  console_.restore();
  exitMock.restore();
  env.cleanup();
});

describe("jin init --team", () => {
  test("appends sink instead of replacing existing ones", async () => {
    // Pre-populate with an existing webhook sink
    const existingConfig = defaultConfig();
    existingConfig.sinks = [
      { type: "webhook", id: "webhook-0", url: "https://example.com/hook" },
    ];
    await writeTestConfig(env.dir, existingConfig);

    const teamCode = encodeTeamConfig({
      type: "postgres",
      connectionString: "postgresql://team-db:5432/shared",
      teamId: "team-42",
    });

    await initCommand({ team: teamCode });

    const config = await readTestConfig(env.dir);
    // Original sink preserved, new one appended
    expect(config.sinks).toHaveLength(2);
    expect(config.sinks[0].type).toBe("webhook");
    expect(config.sinks[0].url).toBe("https://example.com/hook");
    expect(config.sinks[1].type).toBe("postgres");
    expect(config.sinks[1].connectionString).toBe("postgresql://team-db:5432/shared");
  });

  test("skips duplicate sink (same connection string)", async () => {
    const teamCode = encodeTeamConfig({
      type: "postgres",
      connectionString: "postgresql://team-db:5432/shared",
      teamId: "team-42",
    });

    // Run init twice with the same team code
    await initCommand({ team: teamCode });
    await initCommand({ team: teamCode });

    const config = await readTestConfig(env.dir);
    // Should not duplicate — still just 1 sink
    expect(config.sinks).toHaveLength(1);

    const output = console_.logs.join("\n");
    expect(output).toContain("already configured");
  });

  test("warns when adding alongside existing sinks", async () => {
    // Pre-populate with an existing sink
    const existingConfig = defaultConfig();
    existingConfig.sinks = [
      { type: "webhook", id: "webhook-0", url: "https://example.com/hook" },
    ];
    await writeTestConfig(env.dir, existingConfig);

    const teamCode = encodeTeamConfig({
      type: "postgres",
      connectionString: "postgresql://team-db:5432/shared",
      teamId: "team-42",
    });

    await initCommand({ team: teamCode });

    const output = console_.logs.join("\n");
    expect(output).toContain("Adding team sink alongside");
  });
});

describe("jin init auto-ingest", () => {
  function createMockAdapter(sessions: Session[]): Adapter {
    return {
      id: "mock-adapter",
      name: "Mock Adapter",
      icon: "M",
      detect: async () => true,
      sessions: async () => sessions,
      messages: async () => [],
      watchPaths: () => [],
    };
  }

  test("auto-ingests when adapters detected", async () => {
    const session = makeSession("test-session-001", {
      adapterId: "mock-adapter",
      adapterName: "Mock Adapter",
      metadata: { cwd: "/home/dev/projects/alpha" },
    });
    mockAdapters = [createMockAdapter([session])];

    await initCommand();

    // Verify ingest ran — session should be in the store
    const store = new Store(env.store.db.filename as string);
    const sessions = store.listSessions();
    store.close();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.some((s: any) => s.id === "test-session-001")).toBe(true);
  });

  test("--json includes projects after auto-ingest", async () => {
    const session = makeSession("test-session-002", {
      adapterId: "mock-adapter",
      adapterName: "Mock Adapter",
      metadata: { cwd: "/home/dev/projects/beta" },
    });
    mockAdapters = [createMockAdapter([session])];

    await initCommand({ json: true });

    const output = console_.logs.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("projects");
    expect(parsed).toHaveProperty("detected");
    expect(parsed.detected).toHaveLength(1);
    expect(parsed.detected[0].id).toBe("mock-adapter");
  });

  test("progress is cleared after ingest completes", async () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession(`progress-session-${i}`, {
        adapterId: "mock-adapter",
        adapterName: "Mock Adapter",
      })
    );
    mockAdapters = [createMockAdapter(sessions)];

    await initCommand();

    // Progress file should be cleaned up after ingest finishes
    expect(readProgress()).toBeNull();
  });
});

describe("jin status — ingestion progress", () => {
  test("status shows progress when ingestion is active", async () => {
    // Simulate an active ingestion by writing a progress file directly
    const { writeProgress } = await import("../src/progress");
    writeProgress({
      adapter: "Claude Code",
      current: 7,
      total: 20,
      startedAt: Date.now(),
    });

    console_.restore();
    console_ = captureConsole();

    await statusCommand();

    const output = console_.logs.join("\n");
    expect(output).toContain("ingesting");
    expect(output).toContain("Claude Code");
    expect(output).toContain("7/20");
    expect(output).toContain("35%");

    clearProgress();
  });

  test("status --json includes ingest field when active", async () => {
    const { writeProgress } = await import("../src/progress");
    writeProgress({
      adapter: "Codex",
      current: 3,
      total: 10,
      startedAt: Date.now(),
    });

    console_.restore();
    console_ = captureConsole();

    await statusCommand({ json: true });

    const output = console_.logs.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.ingest).toBeDefined();
    expect(parsed.ingest.adapter).toBe("Codex");
    expect(parsed.ingest.current).toBe(3);
    expect(parsed.ingest.total).toBe(10);
    expect(parsed.ingest.pct).toBe(30);

    clearProgress();
  });

  test("status --json omits ingest field when no ingestion active", async () => {
    clearProgress();

    console_.restore();
    console_ = captureConsole();

    await statusCommand({ json: true });

    const output = console_.logs.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.ingest).toBeUndefined();
  });

  test("status does not show progress when file is stale", async () => {
    const { writeProgress } = await import("../src/progress");
    writeProgress({
      adapter: "Claude Code",
      current: 3,
      total: 10,
      startedAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
    });

    console_.restore();
    console_ = captureConsole();

    await statusCommand();

    const output = console_.logs.join("\n");
    expect(output).not.toContain("ingesting");

    clearProgress();
  });
});
