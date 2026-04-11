import { afterEach, expect, mock, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  __benchmarkInternals,
  normalizeHighWaterMarkBytes,
} from "../../src/commands/benchmark";
import { ingestOne } from "../../src/pipeline/ingest";

const TEMP_ROOTS: string[] = [];
const CODEX_FIXTURE = join(
  process.cwd(),
  "test/fixtures/codex/2026-02-21T12-48-43-testcodex.jsonl",
);

afterEach(() => {
  while (TEMP_ROOTS.length > 0) {
    const root = TEMP_ROOTS.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("jin benchmark emits repeatable v2 phase artifacts for a dataset override", async () => {
  const root = mkdtempSync(join(tmpdir(), "jin-benchmark-test-"));
  TEMP_ROOTS.push(root);

  const configDir = join(root, "config");
  const outputDir = join(root, "out");
  const codexHome = join(root, "codex-home");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(codexHome, "sessions/2026/02/21"), { recursive: true });
  cpSync(
    CODEX_FIXTURE,
    join(codexHome, "sessions/2026/02/21/rollout-simple.jsonl"),
  );

  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify(
      {
        adapters: {
          "claude-code": { enabled: false },
          cursor: { enabled: false },
          codex: { enabled: true },
          warp: { enabled: false },
          "gemini-cli": { enabled: false },
          kiro: { enabled: false },
          amp: { enabled: false },
          opencode: { enabled: false },
          pi: { enabled: false },
          piagent: { enabled: false },
        },
        sinks: [],
        routes: [],
        watch: { pollIntervalMs: 0 },
      },
      null,
      2,
    ),
    "utf8",
  );

  const proc = Bun.spawn({
    cmd: ["bun", "src/index.ts", "benchmark", "--json"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      JIN_CONFIG_DIR: configDir,
      JIN_BENCHMARK_OUTPUT_DIR: outputDir,
      JIN_BENCHMARK_ADAPTERS: "codex",
      JIN_BENCHMARK_DATASET_DIR: codexHome,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr.trim()).toBe("");

  const report = JSON.parse(stdout) as {
    options: { pushMode: string; datasetDir?: string };
    phases: Array<{
      phase: string;
      status: string;
      counts: { refsTouched: number; bundlesTouched: number; sourceUnitsTouched: number };
      push?: { mode: string; sinkAttempts: number };
      rss: { endBytes: number; highWaterMarkBytes: number };
    }>;
    artifacts: {
      reportPath: string;
      latestPath: string;
      phasePaths: Record<string, string>;
    };
    summary: { verdict: string; peakRssBytes: number };
  };

  expect(report.summary.verdict).toBe("pass");
  expect(report.options.pushMode).toBe("synthetic");
  expect(report.options.datasetDir).toBe(codexHome);
  expect(report.phases.map((phase) => phase.phase)).toEqual([
    "discovery",
    "load",
    "load-write",
    "push",
    "runtime",
    "shutdown-flush",
  ]);
  expect(report.phases.every((phase) => phase.status === "ok")).toBe(true);
  expect(
    report.phases.find((phase) => phase.phase === "discovery")?.counts,
  ).toEqual({
    refsTouched: 1,
    bundlesTouched: 0,
    sourceUnitsTouched: 1,
  });
  expect(
    report.phases.find((phase) => phase.phase === "push")?.push,
  ).toMatchObject({
    mode: "synthetic",
    sinkAttempts: 1,
  });

  expect(existsSync(report.artifacts.reportPath)).toBe(true);
  expect(existsSync(report.artifacts.latestPath)).toBe(true);

  for (const phasePath of Object.values(report.artifacts.phasePaths)) {
    expect(existsSync(phasePath)).toBe(true);
  }

  const persistedReport = JSON.parse(
    readFileSync(report.artifacts.reportPath, "utf8"),
  ) as {
    phases: Array<{ rss: { endBytes: number; highWaterMarkBytes: number } }>;
    summary: { verdict: string; peakRssBytes: number };
  };
  expect(persistedReport.summary.verdict).toBe("pass");
  expect(
    persistedReport.phases.every(
      (phase) => phase.rss.highWaterMarkBytes >= phase.rss.endBytes,
    ),
  ).toBe(true);
  expect(persistedReport.summary.peakRssBytes).toBe(
    Math.max(
      ...persistedReport.phases.map((phase) => phase.rss.highWaterMarkBytes),
    ),
  );
});

test("jin benchmark fails when a requested adapter is not available", async () => {
  const root = mkdtempSync(join(tmpdir(), "jin-benchmark-test-"));
  TEMP_ROOTS.push(root);

  const configDir = join(root, "config");
  const outputDir = join(root, "out");
  const codexHome = join(root, "codex-home");
  const missingAmpHome = join(root, "missing-amp-home");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(codexHome, "sessions/2026/02/21"), { recursive: true });
  cpSync(
    CODEX_FIXTURE,
    join(codexHome, "sessions/2026/02/21/rollout-simple.jsonl"),
  );

  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify(
      {
        adapters: {
          "claude-code": { enabled: false },
          cursor: { enabled: false },
          codex: { enabled: true, dataDir: codexHome },
          warp: { enabled: false },
          "gemini-cli": { enabled: false },
          kiro: { enabled: false },
          amp: { enabled: true, dataDir: missingAmpHome },
          opencode: { enabled: false },
          pi: { enabled: false },
          piagent: { enabled: false },
        },
        sinks: [],
        routes: [],
        watch: { pollIntervalMs: 0 },
      },
      null,
      2,
    ),
    "utf8",
  );

  const proc = Bun.spawn({
    cmd: ["bun", "src/index.ts", "benchmark", "--json"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      JIN_CONFIG_DIR: configDir,
      JIN_BENCHMARK_OUTPUT_DIR: outputDir,
      JIN_BENCHMARK_ADAPTERS: "codex,amp",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr.trim()).toBe("");

  const report = JSON.parse(stdout) as {
    phases: Array<{
      phase: string;
      status: string;
      error?: string;
      target: { adapterIds: string[] };
      logs: { error: string[] };
    }>;
    artifacts: { reportPath: string };
    summary: { verdict: string; failedPhases: string[] };
  };

  expect(report.summary.verdict).toBe("fail");
  expect(report.summary.failedPhases).toEqual([
    "discovery",
    "load",
    "load-write",
    "push",
    "runtime",
    "shutdown-flush",
  ]);
  expect(report.phases.every((phase) => phase.status === "error")).toBe(true);
  expect(
    report.phases.every((phase) => phase.target.adapterIds.join(",") === "codex,amp"),
  ).toBe(true);
  expect(report.phases[0]?.error).toContain(
    "Requested benchmark adapters were not available: amp (detect() returned false)",
  );
  expect(report.phases[0]?.logs.error).toContain(
    "Requested benchmark adapters were not available: amp (detect() returned false)",
  );

  const persistedReport = JSON.parse(
    readFileSync(report.artifacts.reportPath, "utf8"),
  ) as { summary: { verdict: string } };
  expect(persistedReport.summary.verdict).toBe("fail");
});

test("normalizeHighWaterMarkBytes publishes byte-valued RSS peaks", () => {
  expect(normalizeHighWaterMarkBytes(2_048, 0, "darwin")).toBe(2_048);
  expect(normalizeHighWaterMarkBytes(2_048, 0, "linux")).toBe(2_097_152);
  expect(normalizeHighWaterMarkBytes(2_048, 3_000_000, "linux")).toBe(
    3_000_000,
  );
  expect(normalizeHighWaterMarkBytes(Number.NaN, 123, "linux")).toBe(123);
});

test("benchmark adapter wrapper preserves production reclaim hooks", async () => {
  const refs = Array.from({ length: 6 }, (_, index) => ({
    id: `conversation-${index + 1}`,
    sourcePath: `/tmp/conversation-${index + 1}.jsonl`,
    adapterId: "claude-code",
  }));
  const discoveryReleases: number[] = [];
  const transientReleases: number[] = [];
  const exec = mock(() => {});
  const baseStore = createStubBenchmarkStore(exec);
  const adapter = {
    id: "claude-code",
    name: "Claude Code",
    fileIndexCache: new Map([["ref", 1]]),
    transientCache: new Map([["ref", 1]]),
    async detect() {
      return true;
    },
    async findChanged() {
      return refs;
    },
    async loadConversation(ref: { id: string; sourcePath: string }) {
      return createMockBundle(ref.id, ref.sourcePath);
    },
    watchPaths() {
      return [];
    },
    releaseDiscoveryMemory() {
      this.fileIndexCache.clear();
      discoveryReleases.push(1);
    },
    releaseTransientMemory() {
      this.transientCache.clear();
      transientReleases.push(1);
    },
  };
  const tracker = __benchmarkInternals.createAdapterTracker([
    adapter,
  ]);
  const trackedStore = __benchmarkInternals.createStoreTracker(
    baseStore as any,
  ).store;

  await ingestOne(tracker.adapters[0]!, trackedStore, { kind: "startup-scan" });

  expect(discoveryReleases).toHaveLength(1);
  expect(transientReleases).toHaveLength(6);
  expect(adapter.fileIndexCache.size).toBe(0);
  expect(adapter.transientCache.size).toBe(0);
  expect(exec.mock.calls).toHaveLength(12);
  expect(exec.mock.calls.slice(0, 2)).toEqual([
    ["PRAGMA wal_checkpoint(PASSIVE)"],
    ["PRAGMA shrink_memory"],
  ]);
  expect(exec.mock.calls.slice(-2)).toEqual([
    ["PRAGMA wal_checkpoint(PASSIVE)"],
    ["PRAGMA shrink_memory"],
  ]);
});

test("benchmark store wrapper preserves sqlite database exec for reclaim", () => {
  const exec = mock(() => {});
  const baseStore = createStubBenchmarkStore(exec);
  const tracked = __benchmarkInternals.createStoreTracker(baseStore as any).store;

  expect(tracked.database?.exec).toBe(exec);
});

async function readStream(stream: ReadableStream | null): Promise<string> {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
}

function createStubBenchmarkStore(exec: ReturnType<typeof mock>) {
  return {
    database: { exec },
    writeBundle: mock(() => ({ changed: true, revision: 1 })),
    getConversation: mock(() => null),
    getMessages: mock(() => []),
    getToolCalls: mock(() => []),
    getRevision: mock(() => 1),
    conversationsNeedingPush: mock(() => []),
    recordPushResult: mock(() => {}),
    findOrphanedConversations: mock(() => []),
    findConversationsMissingSync: mock(() => []),
    searchMessages: mock(() => []),
  };
}

function createMockBundle(conversationId: string, sourcePath: string) {
  return {
    conversation: {
      id: conversationId,
      traceId: conversationId,
      parentId: "",
      relationship: "root",
      forkPoint: -1,
      adapterId: "claude-code",
      name: conversationId,
      cwd: "/tmp",
      gitRemote: "",
      branch: "",
      model: "claude",
      startedAt: "2026-04-10T00:00:00.000Z",
      endedAt: "2026-04-10T00:00:01.000Z",
      sourcePath,
      sourceFormat: "jsonl",
    },
    messages: [],
    toolCalls: [],
  } as any;
}
