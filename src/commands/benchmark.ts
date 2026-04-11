import { allAdapters, startupProbeBlocked } from "../adapters/registry";
import {
  configDir,
  loadConfig,
  resolveAdapterConfig,
  type AdapterConfig,
  type JinConfig,
  type RouteConfig,
} from "../config";
import type { Adapter as V2Adapter } from "../contracts/adapters";
import type {
  Conversation,
  ConversationBundle,
  Message,
  ToolCall,
} from "../contracts/conversations";
import type { Sink as V2Sink, PushPayload, PushResult } from "../contracts/sinks";
import type { ConversationStore, RecordedPushResult } from "../contracts/store";
import { openStoreAtPath, type SqliteConversationStore } from "../db/store";
import { ingestAll } from "../pipeline/ingest";
import { runPipeline } from "../pipeline/loop";
import { pushDirty } from "../pipeline/push";
import { createSink } from "../sinks/registry";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const BENCHMARK_SCHEMA_VERSION = 2;
const BENCHMARK_NOOP_SINK_ID = "benchmark-noop";
const DEFAULT_RUNTIME_PUSH_BATCH_SIZE = 2;
const DEFAULT_RSS_WARNING_BYTES = 200 * 1024 * 1024;
const DEFAULT_RSS_HARD_LIMIT_BYTES = 256 * 1024 * 1024;

const PHASE_ORDER = [
  "discovery",
  "load",
  "load-write",
  "push",
  "runtime",
  "shutdown-flush",
] as const;

type BenchmarkPhaseName = (typeof PHASE_ORDER)[number];
type BenchmarkPushMode = "synthetic" | "real" | "hybrid";
type BenchmarkPhaseStatus = "ok" | "skipped" | "error";

interface MemoryUsageSnapshot {
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
}

interface ProcessSnapshot {
  timestamp: string;
  osRssBytes: number;
  osHighWaterMarkBytes: number;
  memoryUsage: MemoryUsageSnapshot;
}

interface BenchmarkCounts {
  refsTouched: number;
  bundlesTouched: number;
  sourceUnitsTouched: number;
}

interface AdapterMetricsSummary {
  adapterId: string;
  adapterName: string;
  findChangedCalls: number;
  loadCalls: number;
  refsReturned: number;
  bundlesLoaded: number;
  sourceUnitsTouched: number;
}

interface StoreMetricsSummary {
  writeCalls: number;
  changedWrites: number;
  dirtyLookupCalls: number;
  dirtyConversationIdsObserved: number;
  pushResultsRecorded: number;
}

interface SinkMetricsSummary {
  sinkId: string;
  sinkName: string;
  pushCalls: number;
  payloadsAttempted: number;
  payloadsPushed: number;
  payloadsFailed: number;
}

interface PhaseSeedArtifact {
  wallTimeMs: number;
  counts: BenchmarkCounts;
  adapters: AdapterMetricsSummary[];
  store: StoreMetricsSummary;
}

interface PhasePushArtifact {
  mode: BenchmarkPushMode;
  sinkIds: string[];
  sinkAttempts: number;
  pushedConversations: number;
  failedConversations: number;
  sinks: SinkMetricsSummary[];
}

interface RuntimeArtifact {
  timedOut?: boolean;
  abandonedWorkItems?: number;
}

interface PhaseTarget {
  adapterIds: string[];
  adapterDataDirs: Record<string, string>;
  pushMode: BenchmarkPushMode;
  sinkIds: string[];
  routeCount: number;
  datasetDir?: string;
  datasetLabel?: string;
  datasetManifestPath?: string;
}

interface BenchmarkPhaseArtifact {
  schemaVersion: number;
  phase: BenchmarkPhaseName;
  status: BenchmarkPhaseStatus;
  startedAt: string;
  endedAt: string;
  wallTimeMs: number;
  rss: {
    startBytes: number;
    endBytes: number;
    highWaterMarkBytes: number;
  };
  memoryUsage: {
    start: MemoryUsageSnapshot;
    end: MemoryUsageSnapshot;
  };
  counts: BenchmarkCounts;
  target: PhaseTarget;
  adapters: AdapterMetricsSummary[];
  store?: StoreMetricsSummary;
  push?: PhasePushArtifact;
  seed?: PhaseSeedArtifact;
  runtime?: RuntimeArtifact;
  notes: string[];
  logs: {
    info: string[];
    warn: string[];
    error: string[];
  };
  stderr?: string;
  error?: string;
}

interface BenchmarkReport {
  schemaVersion: number;
  timestamp: string;
  version: string;
  command: string[];
  runDir: string;
  configDir: string;
  system: {
    platform: string;
    cpus: number;
    totalMemoryBytes: number;
  };
  options: {
    phases: BenchmarkPhaseName[];
    pushMode: BenchmarkPushMode;
    adapterFilter: string[];
    datasetDir?: string;
    datasetLabel?: string;
    datasetManifestPath?: string;
    adapterDirs: Record<string, string>;
    runtimePushBatchSize: number;
    rssWarningBytes: number;
    rssHardLimitBytes: number;
  };
  phases: BenchmarkPhaseArtifact[];
  artifacts: {
    reportPath: string;
    latestPath: string;
    phasePaths: Record<string, string>;
  };
  summary: {
    verdict: "pass" | "fail";
    failedPhases: BenchmarkPhaseName[];
    skippedPhases: BenchmarkPhaseName[];
    totalWallTimeMs: number;
    peakRssBytes: number;
  };
}

interface HarnessEnv {
  phases: BenchmarkPhaseName[];
  pushMode: BenchmarkPushMode;
  adapterFilter: string[];
  adapterDirs: Record<string, string>;
  datasetDir?: string;
  datasetLabel?: string;
  datasetManifestPath?: string;
  outputDir?: string;
  runtimePushBatchSize: number;
  rssWarningBytes: number;
  rssHardLimitBytes: number;
}

interface PhaseConfigContext {
  config: JinConfig;
  target: PhaseTarget;
}

interface PreparedPhaseContext extends PhaseConfigContext {
  adapters: V2Adapter[];
  adapterTracker: AdapterTracker;
}

interface PreparedPushContext extends PreparedPhaseContext {
  pushMode: BenchmarkPushMode;
  sinks: V2Sink[];
  sinkTracker: SinkTracker;
  routes: RouteConfig[];
}

class BenchmarkHarnessPhaseError extends Error {
  target: PhaseTarget;

  constructor(message: string, target: PhaseTarget) {
    super(message);
    this.name = "BenchmarkHarnessPhaseError";
    this.target = clonePhaseTarget(target);
  }
}

export async function benchmarkCommand(opts: { json?: boolean }): Promise<void> {
  const internalPhase = parsePhaseName(
    process.env.JIN_BENCHMARK_INTERNAL_PHASE,
  );

  if (internalPhase) {
    const artifact = await runInternalPhase(internalPhase);
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
    process.exit(artifact.status === "error" ? 1 : 0);
  }

  const report = await runBenchmarkHarness();

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printBenchmarkReport(report);
  }

  if (report.summary.failedPhases.length > 0) {
    process.exit(1);
  }
}

async function runBenchmarkHarness(): Promise<BenchmarkReport> {
  const env = readHarnessEnv();
  const runDir = ensureRunDir(env.outputDir);
  const { VERSION } = await import("../updater");
  const os = await import("os");
  const phaseArtifacts: BenchmarkPhaseArtifact[] = [];
  const phasePaths: Record<string, string> = {};

  for (const phase of env.phases) {
    const artifact = await spawnPhase(phase, runDir);
    const artifactPath = join(runDir, `phase-${phase}.json`);
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    phaseArtifacts.push(artifact);
    phasePaths[phase] = artifactPath;
  }

  const latestPath = join(configDir(), "benchmarks", "latest.json");
  const reportPath = join(runDir, "report.json");
  const report: BenchmarkReport = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    version: VERSION,
    command: [...process.argv],
    runDir,
    configDir: configDir(),
    system: {
      platform: process.platform,
      cpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    options: {
      phases: env.phases,
      pushMode: env.pushMode,
      adapterFilter: env.adapterFilter,
      datasetDir: env.datasetDir,
      datasetLabel: env.datasetLabel,
      datasetManifestPath: env.datasetManifestPath,
      adapterDirs: env.adapterDirs,
      runtimePushBatchSize: env.runtimePushBatchSize,
      rssWarningBytes: env.rssWarningBytes,
      rssHardLimitBytes: env.rssHardLimitBytes,
    },
    phases: phaseArtifacts,
    artifacts: {
      reportPath,
      latestPath,
      phasePaths,
    },
    summary: {
      verdict: phaseArtifacts.some((artifact) => artifact.status === "error")
        ? "fail"
        : "pass",
      failedPhases: phaseArtifacts
        .filter((artifact) => artifact.status === "error")
        .map((artifact) => artifact.phase),
      skippedPhases: phaseArtifacts
        .filter((artifact) => artifact.status === "skipped")
        .map((artifact) => artifact.phase),
      totalWallTimeMs: phaseArtifacts.reduce(
        (sum, artifact) => sum + artifact.wallTimeMs,
        0,
      ),
      peakRssBytes: phaseArtifacts.reduce(
        (peak, artifact) => Math.max(peak, artifact.rss.highWaterMarkBytes),
        0,
      ),
    },
  };

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  ensureDirectory(join(configDir(), "benchmarks"));
  writeFileSync(latestPath, JSON.stringify(report, null, 2));

  return report;
}

async function spawnPhase(
  phase: BenchmarkPhaseName,
  runDir: string,
): Promise<BenchmarkPhaseArtifact> {
  const proc = Bun.spawn({
    cmd: [...process.argv],
    cwd: process.cwd(),
    env: {
      ...process.env,
      JIN_BENCHMARK_INTERNAL_PHASE: phase,
      JIN_BENCHMARK_RUN_DIR: runDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readProcessStream(proc.stdout),
    readProcessStream(proc.stderr),
    proc.exited,
  ]);

  let artifact: BenchmarkPhaseArtifact;
  try {
    artifact = JSON.parse(stdout) as BenchmarkPhaseArtifact;
  } catch {
    artifact = failedArtifactFromSpawn(phase, stdout, stderr, exitCode);
  }

  if (stderr.trim().length > 0) {
    artifact.stderr = stderr.trim();
  }

  if (exitCode !== 0 && artifact.status !== "error") {
    artifact.status = "error";
    artifact.error = artifact.error ?? `Phase exited with code ${exitCode}`;
  }

  return artifact;
}

async function runInternalPhase(
  phase: BenchmarkPhaseName,
): Promise<BenchmarkPhaseArtifact> {
  const env = readHarnessEnv();
  await stabilizeProcess();
  const start = captureProcessSnapshot();
  const startedAt = start.timestamp;
  const started = performance.now();
  const logs = createPhaseLogCollector();

  try {
    let partial: Omit<
      BenchmarkPhaseArtifact,
      | "schemaVersion"
      | "phase"
      | "status"
      | "startedAt"
      | "endedAt"
      | "wallTimeMs"
      | "rss"
      | "memoryUsage"
      | "logs"
    >;

    switch (phase) {
      case "discovery":
        partial = await runDiscoveryPhase(env, logs);
        break;
      case "load":
        partial = await runLoadPhase(env, logs);
        break;
      case "load-write":
        partial = await runLoadWritePhase(env, logs);
        break;
      case "push":
        partial = await runPushPhase(env, logs);
        break;
      case "runtime":
        partial = await runRuntimePhase(env, logs);
        break;
      case "shutdown-flush":
        partial = await runShutdownFlushPhase(env, logs);
        break;
    }

    await stabilizeProcess();
    const end = captureProcessSnapshot();
    const loggedError = logs.entries.error.at(-1);
    return {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      phase,
      status: loggedError ? "error" : "ok",
      startedAt,
      endedAt: end.timestamp,
      wallTimeMs: Math.round(performance.now() - started),
      rss: {
        startBytes: start.osRssBytes,
        endBytes: end.osRssBytes,
        highWaterMarkBytes: end.osHighWaterMarkBytes,
      },
      memoryUsage: {
        start: start.memoryUsage,
        end: end.memoryUsage,
      },
      logs: logs.entries,
      ...(loggedError ? { error: loggedError } : {}),
      ...partial,
    };
  } catch (error) {
    const target =
      error instanceof BenchmarkHarnessPhaseError
        ? error.target
        : emptyTarget(env);
    const end = captureProcessSnapshot();
    return {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      phase,
      status: "error",
      startedAt,
      endedAt: end.timestamp,
      wallTimeMs: Math.round(performance.now() - started),
      rss: {
        startBytes: start.osRssBytes,
        endBytes: end.osRssBytes,
        highWaterMarkBytes: end.osHighWaterMarkBytes,
      },
      memoryUsage: {
        start: start.memoryUsage,
        end: end.memoryUsage,
      },
      counts: emptyCounts(),
      target,
      adapters: [],
      notes: [],
      logs: logs.entries,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runDiscoveryPhase(
  env: HarnessEnv,
  logs: PhaseLogCollector,
): Promise<Omit<
  BenchmarkPhaseArtifact,
  | "schemaVersion"
  | "phase"
  | "status"
  | "startedAt"
  | "endedAt"
  | "wallTimeMs"
  | "rss"
  | "memoryUsage"
  | "logs"
>> {
  const context = await preparePhaseContext(env, logs);
  try {
    for (const adapter of context.adapters) {
      await adapter.findChanged({ kind: "startup-scan" });
    }

    return {
      counts: context.adapterTracker.asCounts({
        bundlesTouched: 0,
      }),
      target: context.target,
      adapters: context.adapterTracker.summary(),
      notes: [],
    };
  } finally {
    logs.info(`discovery adapters=${context.target.adapterIds.join(",")}`);
  }
}

async function runLoadPhase(
  env: HarnessEnv,
  logs: PhaseLogCollector,
): Promise<Omit<
  BenchmarkPhaseArtifact,
  | "schemaVersion"
  | "phase"
  | "status"
  | "startedAt"
  | "endedAt"
  | "wallTimeMs"
  | "rss"
  | "memoryUsage"
  | "logs"
>> {
  const context = await preparePhaseContext(env, logs);
  try {
    for (const adapter of context.adapters) {
      const refs = await adapter.findChanged({ kind: "startup-scan" });
      for (const ref of refs) {
        await adapter.loadConversation(ref);
      }
    }

    return {
      counts: context.adapterTracker.asCounts(),
      target: context.target,
      adapters: context.adapterTracker.summary(),
      notes: [],
    };
  } finally {
    logs.info(`load adapters=${context.target.adapterIds.join(",")}`);
  }
}

async function runLoadWritePhase(
  env: HarnessEnv,
  logs: PhaseLogCollector,
): Promise<Omit<
  BenchmarkPhaseArtifact,
  | "schemaVersion"
  | "phase"
  | "status"
  | "startedAt"
  | "endedAt"
  | "wallTimeMs"
  | "rss"
  | "memoryUsage"
  | "logs"
>> {
  const context = await preparePhaseContext(env, logs);
  const storeContext = createTempStoreContext();
  const storeTracker = createStoreTracker(storeContext.store);

  try {
    await ingestAll(context.adapters, storeTracker.store, { kind: "startup-scan" });

    return {
      counts: {
        refsTouched: context.adapterTracker.refCount(),
        bundlesTouched: storeTracker.summary().writeCalls,
        sourceUnitsTouched: context.adapterTracker.sourceUnitCount(),
      },
      target: context.target,
      adapters: context.adapterTracker.summary(),
      store: storeTracker.summary(),
      notes: [],
    };
  } finally {
    storeContext.cleanup();
    logs.info(`load-write store=${storeContext.store.dbPath}`);
  }
}

async function runPushPhase(
  env: HarnessEnv,
  logs: PhaseLogCollector,
): Promise<Omit<
  BenchmarkPhaseArtifact,
  | "schemaVersion"
  | "phase"
  | "status"
  | "startedAt"
  | "endedAt"
  | "wallTimeMs"
  | "rss"
  | "memoryUsage"
  | "logs"
>> {
  const context = await preparePushContext(env, logs);
  const storeContext = createTempStoreContext();
  const storeTracker = createStoreTracker(storeContext.store);
  const seedStarted = performance.now();

  try {
    await ingestAll(context.adapters, storeTracker.store, { kind: "startup-scan" });
    const seed: PhaseSeedArtifact = {
      wallTimeMs: Math.round(performance.now() - seedStarted),
      counts: {
        refsTouched: context.adapterTracker.refCount(),
        bundlesTouched: storeTracker.summary().writeCalls,
        sourceUnitsTouched: context.adapterTracker.sourceUnitCount(),
      },
      adapters: context.adapterTracker.summary(),
      store: storeTracker.summary(),
    };

    context.adapterTracker.reset();
    storeTracker.reset();
    context.sinkTracker.reset();

    const pushSummary = await pushDirty(
      storeTracker.store,
      context.sinks,
      context.routes,
      {
        batchSize: env.runtimePushBatchSize,
        logger: logs.logger,
      },
    );

    return {
      counts: {
        refsTouched: 0,
        bundlesTouched: context.sinkTracker.payloadCount(),
        sourceUnitsTouched: 0,
      },
      target: {
        ...context.target,
        sinkIds: context.sinks.map((sink) => sink.id),
        routeCount: context.routes.length,
      },
      adapters: [],
      store: storeTracker.summary(),
      seed,
      push: {
        mode: context.pushMode,
        sinkIds: context.sinks.map((sink) => sink.id),
        sinkAttempts: pushSummary.sinkAttempts,
        pushedConversations: pushSummary.pushedConversations,
        failedConversations: pushSummary.failedConversations,
        sinks: context.sinkTracker.summary(),
      },
      notes: context.sinks.length === 0
        ? ["No sinks were available for push measurement."]
        : [],
    };
  } finally {
    await closeSinks(context.sinks);
    storeContext.cleanup();
  }
}

async function runRuntimePhase(
  env: HarnessEnv,
  logs: PhaseLogCollector,
): Promise<Omit<
  BenchmarkPhaseArtifact,
  | "schemaVersion"
  | "phase"
  | "status"
  | "startedAt"
  | "endedAt"
  | "wallTimeMs"
  | "rss"
  | "memoryUsage"
  | "logs"
>> {
  const context = await preparePushContext(env, logs);
  const storeContext = createTempStoreContext();
  const storeTracker = createStoreTracker(storeContext.store);
  const handle = await runPipeline({
    adapterSource: context.adapters,
    store: storeTracker.store,
    sinks: context.sinks,
    routes: context.routes,
    scanIntervalMs: null,
    scheduleStartupWork: false,
    deferWatcherStart: true,
    watcherFactory: createNoopWatcher,
    pushBatchSize: env.runtimePushBatchSize,
    rssWarningBytes: env.rssWarningBytes,
    rssHardLimitBytes: env.rssHardLimitBytes,
    logger: logs.logger,
  });
  for (const adapter of context.adapters) {
    handle.enqueue({
      kind: "ingest-adapter",
      adapterId: adapter.id,
      hint: { kind: "startup-scan" },
    });
  }
  await handle.waitForIdle();

  return {
    counts: {
      refsTouched: context.adapterTracker.refCount(),
      bundlesTouched: storeTracker.summary().writeCalls,
      sourceUnitsTouched: context.adapterTracker.sourceUnitCount(),
    },
    target: {
      ...context.target,
      sinkIds: context.sinks.map((sink) => sink.id),
      routeCount: context.routes.length,
    },
    adapters: context.adapterTracker.summary(),
    store: storeTracker.summary(),
    push: {
      mode: context.pushMode,
      sinkIds: context.sinks.map((sink) => sink.id),
      sinkAttempts: context.sinkTracker.summary().reduce(
        (sum, sink) => sum + sink.pushCalls,
        0,
      ),
      pushedConversations: context.sinkTracker.summary().reduce(
        (sum, sink) => sum + sink.payloadsPushed,
        0,
      ),
      failedConversations: context.sinkTracker.summary().reduce(
        (sum, sink) => sum + sink.payloadsFailed,
        0,
      ),
      sinks: context.sinkTracker.summary(),
    },
    notes: [
      "This phase measures startup ingest and push to an idle pipeline. The child process exits immediately after emitting the artifact instead of waiting on shutdown-flush cleanup.",
      `runtime-store=${storeContext.store.dbPath}`,
    ],
  };
}

async function runShutdownFlushPhase(
  env: HarnessEnv,
  logs: PhaseLogCollector,
): Promise<Omit<
  BenchmarkPhaseArtifact,
  | "schemaVersion"
  | "phase"
  | "status"
  | "startedAt"
  | "endedAt"
  | "wallTimeMs"
  | "rss"
  | "memoryUsage"
  | "logs"
>> {
  const context = await preparePushContext(env, logs);
  const storeContext = createTempStoreContext();
  const storeTracker = createStoreTracker(storeContext.store);
  let handle: Awaited<ReturnType<typeof runPipeline>> | null = null;

  try {
    handle = await runPipeline({
      adapterSource: context.adapters,
      store: storeTracker.store,
      sinks: context.sinks,
      routes: context.routes,
      scanIntervalMs: null,
      scheduleStartupWork: false,
      deferWatcherStart: true,
      watcherFactory: createNoopWatcher,
      pushBatchSize: env.runtimePushBatchSize,
      rssWarningBytes: env.rssWarningBytes,
      rssHardLimitBytes: env.rssHardLimitBytes,
      logger: logs.logger,
    });

    const shutdownResult = await handle.shutdown();
    handle = null;

    return {
      counts: {
        refsTouched: context.adapterTracker.refCount(),
        bundlesTouched: storeTracker.summary().writeCalls,
        sourceUnitsTouched: context.adapterTracker.sourceUnitCount(),
      },
      target: {
        ...context.target,
        sinkIds: context.sinks.map((sink) => sink.id),
        routeCount: context.routes.length,
      },
      adapters: context.adapterTracker.summary(),
      store: storeTracker.summary(),
      push: {
        mode: context.pushMode,
        sinkIds: context.sinks.map((sink) => sink.id),
        sinkAttempts: context.sinkTracker.summary().reduce(
          (sum, sink) => sum + sink.pushCalls,
          0,
        ),
        pushedConversations: context.sinkTracker.summary().reduce(
          (sum, sink) => sum + sink.payloadsPushed,
          0,
        ),
        failedConversations: context.sinkTracker.summary().reduce(
          (sum, sink) => sum + sink.payloadsFailed,
          0,
        ),
        sinks: context.sinkTracker.summary(),
      },
      runtime: {
        timedOut: shutdownResult.timedOut,
        abandonedWorkItems: shutdownResult.abandonedWorkItems,
      },
      notes: [],
    };
  } finally {
    if (handle) {
      try {
        await handle.shutdown();
      } catch {}
    }
    storeContext.cleanup();
  }
}

async function preparePhaseContext(
  env: HarnessEnv,
  logs: PhaseLogCollector,
): Promise<PreparedPhaseContext> {
  const base = await loadPhaseConfig(env);
  try {
    const adapters = await detectActiveAdapters(
      base.config,
      base.target.adapterIds,
      logs,
    );
    const adapterTracker = createAdapterTracker(adapters);

    if (base.target.adapterIds.length === 0) {
      base.target.adapterIds = adapters.map((adapter) => adapter.id);
    }

    return {
      ...base,
      adapters: adapterTracker.adapters,
      adapterTracker,
    };
  } catch (error) {
    throw new BenchmarkHarnessPhaseError(
      error instanceof Error ? error.message : String(error),
      base.target,
    );
  }
}

async function preparePushContext(
  env: HarnessEnv,
  logs: PhaseLogCollector,
): Promise<PreparedPushContext> {
  const phaseContext = await preparePhaseContext(env, logs);
  const { sinks, sinkTracker, routes, pushMode } = await createPushPlan(
    phaseContext.config,
    phaseContext.target,
    env.pushMode,
    logs,
  );

  return {
    ...phaseContext,
    pushMode,
    sinks,
    sinkTracker,
    routes,
  };
}

async function loadPhaseConfig(env: HarnessEnv): Promise<PhaseConfigContext> {
  const loaded = await loadConfig();
  const config = cloneConfig(loaded);
  const explicitAdapters = new Set(env.adapterFilter);
  const implicitAdapters = new Set<string>();

  for (const [adapterId, adapterConfig] of Object.entries(config.adapters)) {
    if (
      explicitAdapters.size > 0 &&
      !explicitAdapters.has(adapterId)
    ) {
      adapterConfig.enabled = false;
    }
  }

  for (const [adapterId, dir] of Object.entries(env.adapterDirs)) {
    const nextConfig = resolveAdapterConfig(config.adapters, adapterId);
    nextConfig.enabled = true;
    nextConfig.dataDir = dir;
    nextConfig.allowProtectedSource = true;
    config.adapters[adapterId] = nextConfig;
    implicitAdapters.add(adapterId);
  }

  if (env.datasetDir) {
    const root = resolve(env.datasetDir);
    const adapterIds =
      explicitAdapters.size > 0 ? [...explicitAdapters] : Object.keys(config.adapters);
    let matchedAny = false;

    for (const adapterId of adapterIds) {
      const nestedPath = resolve(root, adapterId);
      if (existsSync(nestedPath)) {
        const nextConfig = resolveAdapterConfig(config.adapters, adapterId);
        nextConfig.enabled = true;
        nextConfig.dataDir = nestedPath;
        nextConfig.allowProtectedSource = true;
        config.adapters[adapterId] = nextConfig;
        implicitAdapters.add(adapterId);
        matchedAny = true;
      }
    }

    if (!matchedAny && adapterIds.length === 1) {
      const adapterId = adapterIds[0];
      const nextConfig = resolveAdapterConfig(config.adapters, adapterId);
      nextConfig.enabled = true;
      nextConfig.dataDir = root;
      nextConfig.allowProtectedSource = true;
      config.adapters[adapterId] = nextConfig;
      implicitAdapters.add(adapterId);
    }
  }

  if (explicitAdapters.size === 0 && implicitAdapters.size > 0) {
    for (const [adapterId, adapterConfig] of Object.entries(config.adapters)) {
      adapterConfig.enabled = implicitAdapters.has(adapterId);
    }
  }

  const adapterDataDirs = Object.fromEntries(
    Object.entries(config.adapters)
      .filter(([, adapterConfig]) => adapterConfig.enabled !== false)
      .flatMap(([adapterId, adapterConfig]) =>
        typeof adapterConfig.dataDir === "string" && adapterConfig.dataDir.trim().length > 0
          ? [[adapterId, resolve(adapterConfig.dataDir)]]
          : [],
      ),
  );

  return {
    config,
    target: {
      adapterIds: mergeAdapterIds(
        [...explicitAdapters],
        [...implicitAdapters],
      ),
      adapterDataDirs,
      pushMode: env.pushMode,
      sinkIds: [],
      routeCount: 0,
      datasetDir: env.datasetDir ? resolve(env.datasetDir) : undefined,
      datasetLabel: env.datasetLabel,
      datasetManifestPath: env.datasetManifestPath
        ? resolve(env.datasetManifestPath)
        : undefined,
    },
  };
}

async function detectActiveAdapters(
  config: JinConfig,
  requestedAdapterIds: string[],
  logs: PhaseLogCollector,
): Promise<V2Adapter[]> {
  const adapters = allAdapters(config.adapters);
  const adaptersById = new Map(
    adapters.map((adapter) => [adapter.id, adapter as unknown as V2Adapter]),
  );
  const activeAdapters: V2Adapter[] = [];

  if (requestedAdapterIds.length > 0) {
    const missingAdapters: string[] = [];

    for (const adapterId of requestedAdapterIds) {
      const adapter = adaptersById.get(adapterId);
      if (!adapter) {
        missingAdapters.push(`${adapterId} (not registered)`);
        continue;
      }
      if (resolveAdapterConfig(config.adapters, adapterId).enabled === false) {
        missingAdapters.push(`${adapterId} (disabled)`);
        continue;
      }
      if (startupProbeBlocked(adapterId, config.adapters)) {
        missingAdapters.push(
          `${adapterId} (startup probe blocked; opt in or set dataDir)`,
        );
        continue;
      }

      try {
        if (await adapter.detect()) {
          activeAdapters.push(adapter);
        } else {
          missingAdapters.push(`${adapterId} (detect() returned false)`);
        }
      } catch (error) {
        missingAdapters.push(
          `${adapterId} (detect() threw: ${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
    }

    if (missingAdapters.length > 0) {
      const message =
        `Requested benchmark adapters were not available: ${missingAdapters.join(", ")}`;
      logs.error(message);
      throw new Error(message);
    }
  } else {
    for (const adapter of adapters) {
      if (resolveAdapterConfig(config.adapters, adapter.id).enabled === false) {
        continue;
      }
      if (startupProbeBlocked(adapter.id, config.adapters)) {
        continue;
      }
      try {
        if (await adapter.detect()) {
          activeAdapters.push(adapter as unknown as V2Adapter);
        }
      } catch (error) {
        logs.warn(
          `benchmark skipped ${adapter.id} after detect() threw: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  if (activeAdapters.length === 0) {
    const message = "No active adapters detected for benchmark harness";
    logs.error(message);
    throw new Error(message);
  }

  return activeAdapters;
}

async function createPushPlan(
  config: JinConfig,
  target: PhaseTarget,
  requestedMode: BenchmarkPushMode,
  logs: PhaseLogCollector,
): Promise<{
  sinks: V2Sink[];
  sinkTracker: SinkTracker;
  routes: RouteConfig[];
  pushMode: BenchmarkPushMode;
}> {
  const configuredSinks =
    requestedMode === "synthetic"
      ? []
      : await createConfiguredSinks(config, logs);
  const useSynthetic =
    requestedMode === "synthetic" || requestedMode === "hybrid";
  const sinks = [...configuredSinks];
  const routes = [...config.routes];

  if (useSynthetic) {
    sinks.push(createBenchmarkNoopSink());
    routes.push({
      match: {},
      sinks: [BENCHMARK_NOOP_SINK_ID],
    });
  }

  const sinkTracker = createSinkTracker(sinks);
  target.sinkIds = sinkTracker.sinks.map((sink) => sink.id);
  target.routeCount = routes.length;
  target.pushMode = requestedMode;

  return {
    sinks: sinkTracker.sinks,
    sinkTracker,
    routes,
    pushMode: requestedMode,
  };
}

async function createConfiguredSinks(
  config: JinConfig,
  logs: PhaseLogCollector,
): Promise<V2Sink[]> {
  const sinks: V2Sink[] = [];

  for (let index = 0; index < config.sinks.length; index += 1) {
    const sinkConfig = config.sinks[index];
    try {
      const sink = createSink(
        sinkConfig,
        index,
      ) as unknown as V2Sink & { enabled?: boolean };

      sink.enabled = sinkConfig.enabled !== false;
      if (sink.enabled === false) {
        sinks.push(sink);
        continue;
      }

      const health = await sink.healthCheck();
      if (health.ok) {
        sinks.push(sink);
      } else {
        logs.warn(`sink ${sink.id} healthCheck failed: ${health.error}`);
      }
    } catch (error) {
      logs.error(
        `sink initialization failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return sinks;
}

function createBenchmarkNoopSink(): V2Sink {
  return {
    id: BENCHMARK_NOOP_SINK_ID,
    name: "Benchmark Noop Sink",
    async healthCheck() {
      return { ok: true };
    },
    async push(payloads: ReadonlyArray<PushPayload>): Promise<PushResult> {
      return {
        pushed: payloads.length,
        failed: 0,
        errors: [],
      };
    },
    async close() {},
  };
}

function createTempStoreContext(): {
  root: string;
  store: SqliteConversationStore;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "jin-benchmark-"));
  const store = openStoreAtPath(join(root, "store.db"));

  return {
    root,
    store,
    cleanup() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function createAdapterTracker(adapters: ReadonlyArray<V2Adapter>): AdapterTracker {
  const metrics = new Map<string, {
    adapterId: string;
    adapterName: string;
    findChangedCalls: number;
    loadCalls: number;
    refsReturned: number;
    bundlesLoaded: number;
    sourceUnits: Set<string>;
  }>();

  const wrapped = adapters.map((adapter) => {
    const releasableAdapter = adapter as BenchmarkWrappedAdapter;
    const releaseDiscoveryMemory =
      typeof releasableAdapter.releaseDiscoveryMemory === "function"
        ? releasableAdapter.releaseDiscoveryMemory.bind(adapter)
        : undefined;
    const releaseTransientMemory =
      typeof releasableAdapter.releaseTransientMemory === "function"
        ? releasableAdapter.releaseTransientMemory.bind(adapter)
        : undefined;
    metrics.set(adapter.id, {
      adapterId: adapter.id,
      adapterName: adapter.name,
      findChangedCalls: 0,
      loadCalls: 0,
      refsReturned: 0,
      bundlesLoaded: 0,
      sourceUnits: new Set<string>(),
    });

    const wrappedAdapter: BenchmarkWrappedAdapter = {
      id: adapter.id,
      name: adapter.name,
      async detect() {
        return adapter.detect();
      },
      async findChanged(hint) {
        const refs = await adapter.findChanged(hint);
        const metric = metrics.get(adapter.id)!;
        metric.findChangedCalls += 1;
        metric.refsReturned += refs.length;
        for (const ref of refs) {
          metric.sourceUnits.add(ref.sourcePath);
        }
        return refs;
      },
      async loadConversation(ref) {
        const bundle = await adapter.loadConversation(ref);
        const metric = metrics.get(adapter.id)!;
        metric.loadCalls += 1;
        metric.sourceUnits.add(ref.sourcePath);
        if (bundle) {
          metric.bundlesLoaded += 1;
        }
        return bundle;
      },
      watchPaths() {
        return adapter.watchPaths();
      },
      releaseDiscoveryMemory,
      releaseTransientMemory,
    };

    return wrappedAdapter;
  });

  return {
    adapters: wrapped,
    summary() {
      return [...metrics.values()].map((metric) => ({
        adapterId: metric.adapterId,
        adapterName: metric.adapterName,
        findChangedCalls: metric.findChangedCalls,
        loadCalls: metric.loadCalls,
        refsReturned: metric.refsReturned,
        bundlesLoaded: metric.bundlesLoaded,
        sourceUnitsTouched: metric.sourceUnits.size,
      }));
    },
    refCount() {
      return [...metrics.values()].reduce(
        (sum, metric) => sum + metric.refsReturned,
        0,
      );
    },
    sourceUnitCount() {
      return [...metrics.values()].reduce(
        (sum, metric) => sum + metric.sourceUnits.size,
        0,
      );
    },
    asCounts(overrides?: Partial<BenchmarkCounts>) {
      return {
        refsTouched: overrides?.refsTouched ?? this.refCount(),
        bundlesTouched: overrides?.bundlesTouched ?? this.summary().reduce(
          (sum, metric) => sum + metric.bundlesLoaded,
          0,
        ),
        sourceUnitsTouched:
          overrides?.sourceUnitsTouched ?? this.sourceUnitCount(),
      };
    },
    reset() {
      for (const metric of metrics.values()) {
        metric.findChangedCalls = 0;
        metric.loadCalls = 0;
        metric.refsReturned = 0;
        metric.bundlesLoaded = 0;
        metric.sourceUnits.clear();
      }
    },
  };
}

function createStoreTracker(
  store: SqliteConversationStore,
): {
  store: BenchmarkTrackedStore;
  summary: () => StoreMetricsSummary;
  reset: () => void;
} {
  const metrics = {
    writeCalls: 0,
    changedWrites: 0,
    dirtyLookupCalls: 0,
    dirtyConversationIdsObserved: new Set<string>(),
    pushResultsRecorded: 0,
  };

  return {
    store: {
      database: store.database,
      writeBundle(bundle: ConversationBundle) {
        metrics.writeCalls += 1;
        const result = store.writeBundle(bundle);
        if (result.changed) {
          metrics.changedWrites += 1;
        }
        return result;
      },
      getConversation(id: string): Conversation | null {
        return store.getConversation(id);
      },
      getMessages(conversationId: string): Message[] {
        return store.getMessages(conversationId);
      },
      getToolCalls(conversationId: string): ToolCall[] {
        return store.getToolCalls(conversationId);
      },
      getRevision(conversationId: string): number {
        return store.getRevision(conversationId);
      },
      conversationsNeedingPush(sinkId: string): string[] {
        metrics.dirtyLookupCalls += 1;
        const ids = store.conversationsNeedingPush(sinkId);
        for (const id of ids) {
          metrics.dirtyConversationIdsObserved.add(id);
        }
        return ids;
      },
      recordPushResult(
        conversationId: string,
        sinkId: string,
        attemptedRevision: number,
        result: RecordedPushResult,
      ) {
        metrics.pushResultsRecorded += 1;
        return store.recordPushResult(
          conversationId,
          sinkId,
          attemptedRevision,
          result,
        );
      },
      findOrphanedConversations() {
        return store.findOrphanedConversations();
      },
      findConversationsMissingSync() {
        return store.findConversationsMissingSync();
      },
      searchMessages(options) {
        return store.searchMessages(options);
      },
    } satisfies BenchmarkTrackedStore,
    summary() {
      return {
        writeCalls: metrics.writeCalls,
        changedWrites: metrics.changedWrites,
        dirtyLookupCalls: metrics.dirtyLookupCalls,
        dirtyConversationIdsObserved: metrics.dirtyConversationIdsObserved.size,
        pushResultsRecorded: metrics.pushResultsRecorded,
      };
    },
    reset() {
      metrics.writeCalls = 0;
      metrics.changedWrites = 0;
      metrics.dirtyLookupCalls = 0;
      metrics.dirtyConversationIdsObserved.clear();
      metrics.pushResultsRecorded = 0;
    },
  };
}

function createSinkTracker(
  sinks: ReadonlyArray<V2Sink>,
): SinkTracker {
  const metrics = new Map<string, {
    sinkId: string;
    sinkName: string;
    pushCalls: number;
    payloadsAttempted: number;
    payloadsPushed: number;
    payloadsFailed: number;
  }>();

  const wrapped = sinks.map((sink) => {
    metrics.set(sink.id, {
      sinkId: sink.id,
      sinkName: sink.name,
      pushCalls: 0,
      payloadsAttempted: 0,
      payloadsPushed: 0,
      payloadsFailed: 0,
    });

    const enabled = (sink as V2Sink & { enabled?: boolean }).enabled;

    return {
      id: sink.id,
      name: sink.name,
      ...(typeof enabled === "boolean" ? { enabled } : {}),
      async healthCheck() {
        return sink.healthCheck();
      },
      async push(payloads: ReadonlyArray<PushPayload>): Promise<PushResult> {
        const metric = metrics.get(sink.id)!;
        metric.pushCalls += 1;
        metric.payloadsAttempted += payloads.length;
        const result = await sink.push(payloads);
        metric.payloadsPushed += result.pushed;
        metric.payloadsFailed += result.failed;
        return result;
      },
      async close() {
        return sink.close();
      },
    } satisfies V2Sink;
  });

  return {
    sinks: wrapped,
    summary() {
      return [...metrics.values()].map((metric) => ({ ...metric }));
    },
    payloadCount() {
      return [...metrics.values()].reduce(
        (sum, metric) => sum + metric.payloadsAttempted,
        0,
      );
    },
    reset() {
      for (const metric of metrics.values()) {
        metric.pushCalls = 0;
        metric.payloadsAttempted = 0;
        metric.payloadsPushed = 0;
        metric.payloadsFailed = 0;
      }
    },
  };
}

function createPhaseLogCollector(): PhaseLogCollector {
  const entries = {
    info: [] as string[],
    warn: [] as string[],
    error: [] as string[],
  };

  return {
    entries,
    logger: {
      info(message: string) {
        entries.info.push(message);
      },
      warn(message: string) {
        entries.warn.push(message);
      },
      error(message: string, error?: unknown) {
        if (error === undefined) {
          entries.error.push(message);
          return;
        }
        entries.error.push(
          `${message} — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    },
    info(message: string) {
      entries.info.push(message);
    },
    warn(message: string) {
      entries.warn.push(message);
    },
    error(message: string) {
      entries.error.push(message);
    },
  };
}

export const __benchmarkInternals = {
  createAdapterTracker,
  createStoreTracker,
};

function captureProcessSnapshot(): ProcessSnapshot {
  const usage = process.memoryUsage();
  return {
    timestamp: new Date().toISOString(),
    osRssBytes: usage.rss,
    osHighWaterMarkBytes: normalizeHighWaterMarkBytes(
      process.resourceUsage().maxRSS,
      usage.rss,
      process.platform,
    ),
    memoryUsage: {
      rssBytes: usage.rss,
      heapTotalBytes: usage.heapTotal,
      heapUsedBytes: usage.heapUsed,
      externalBytes: usage.external,
      arrayBuffersBytes: usage.arrayBuffers,
    },
  };
}

export function normalizeHighWaterMarkBytes(
  maxRss: number,
  fallback: number,
  platform: NodeJS.Platform = process.platform,
): number {
  if (!Number.isFinite(maxRss) || maxRss <= 0) {
    return fallback;
  }

  const normalizedBytes =
    platform === "darwin"
      ? Math.round(maxRss)
      : Math.round(maxRss * 1024);

  return Math.max(normalizedBytes, fallback);
}

async function stabilizeProcess(): Promise<void> {
  await Bun.sleep(0);
  if (typeof Bun.gc === "function") {
    Bun.gc(true);
  }
  await Bun.sleep(0);
}

async function closeSinks(sinks: ReadonlyArray<V2Sink>): Promise<void> {
  await Promise.allSettled(
    sinks.map(async (sink) => {
      try {
        await sink.close();
      } catch {}
    }),
  );
}

function readHarnessEnv(): HarnessEnv {
  const phases = parsePhaseList(process.env.JIN_BENCHMARK_PHASES);
  const pushMode = parsePushMode(process.env.JIN_BENCHMARK_PUSH_MODE);
  const adapterFilter = parseCsvList(process.env.JIN_BENCHMARK_ADAPTERS);
  const adapterDirs = parseAdapterDirMap(process.env.JIN_BENCHMARK_ADAPTER_DIRS);

  return {
    phases,
    pushMode,
    adapterFilter,
    adapterDirs,
    datasetDir: process.env.JIN_BENCHMARK_DATASET_DIR,
    datasetLabel: process.env.JIN_BENCHMARK_DATASET_LABEL,
    datasetManifestPath: process.env.JIN_BENCHMARK_DATASET_MANIFEST,
    outputDir: process.env.JIN_BENCHMARK_OUTPUT_DIR,
    runtimePushBatchSize: parsePositiveInt(
      process.env.JIN_BENCHMARK_RUNTIME_PUSH_BATCH_SIZE,
      DEFAULT_RUNTIME_PUSH_BATCH_SIZE,
    ),
    rssWarningBytes:
      parsePositiveInt(process.env.JIN_BENCHMARK_RSS_WARNING_MB, 200) *
      1024 *
      1024,
    rssHardLimitBytes:
      parsePositiveInt(process.env.JIN_BENCHMARK_RSS_HARD_LIMIT_MB, 256) *
      1024 *
      1024,
  };
}

function parsePhaseList(raw: string | undefined): BenchmarkPhaseName[] {
  if (!raw || raw.trim().length === 0) {
    return [...PHASE_ORDER];
  }

  const phases = parseCsvList(raw)
    .map((value) => parsePhaseName(value))
    .filter((value): value is BenchmarkPhaseName => value !== null);

  return phases.length > 0 ? phases : [...PHASE_ORDER];
}

function parsePhaseName(raw: string | undefined): BenchmarkPhaseName | null {
  if (!raw) {
    return null;
  }

  return PHASE_ORDER.includes(raw as BenchmarkPhaseName)
    ? (raw as BenchmarkPhaseName)
    : null;
}

function parsePushMode(raw: string | undefined): BenchmarkPushMode {
  switch ((raw ?? "synthetic").trim()) {
    case "real":
      return "real";
    case "hybrid":
      return "hybrid";
    default:
      return "synthetic";
  }
}

function parseCsvList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseAdapterDirMap(
  raw: string | undefined,
): Record<string, string> {
  if (!raw) {
    return {};
  }

  const entries: Array<[string, string]> = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const adapterId = trimmed.slice(0, separator).trim();
    const dir = trimmed.slice(separator + 1).trim();
    if (adapterId.length === 0 || dir.length === 0) {
      continue;
    }

    entries.push([adapterId, resolve(dir)]);
  }

  return Object.fromEntries(entries);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function ensureRunDir(rawOutputDir: string | undefined): string {
  if (rawOutputDir && rawOutputDir.trim().length > 0) {
    const resolved = resolve(rawOutputDir);
    ensureDirectory(resolved);
    return resolved;
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const resolved = join(configDir(), "benchmarks", runId);
  ensureDirectory(resolved);
  return resolved;
}

function ensureDirectory(pathValue: string): void {
  if (!existsSync(pathValue)) {
    mkdirSync(pathValue, { recursive: true });
  }
}

function createNoopWatcher() {
  return {
    addPath() {},
    close() {},
  };
}

function cloneConfig(config: JinConfig): JinConfig {
  return JSON.parse(JSON.stringify(config)) as JinConfig;
}

async function readProcessStream(
  stream: ReadableStream | null,
): Promise<string> {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
}

function failedArtifactFromSpawn(
  phase: BenchmarkPhaseName,
  stdout: string,
  stderr: string,
  exitCode: number,
): BenchmarkPhaseArtifact {
  return {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    phase,
    status: "error",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    wallTimeMs: 0,
    rss: {
      startBytes: 0,
      endBytes: 0,
      highWaterMarkBytes: 0,
    },
    memoryUsage: {
      start: zeroMemoryUsage(),
      end: zeroMemoryUsage(),
    },
    counts: emptyCounts(),
    target: emptyTarget(readHarnessEnv()),
    adapters: [],
    notes: [],
    logs: {
      info: [],
      warn: [],
      error: [],
    },
    stderr: stderr.trim() || undefined,
    error:
      stdout.trim().length > 0
        ? `Failed to parse child phase JSON (exit ${exitCode}): ${stdout.trim()}`
        : `Child phase exited ${exitCode} without JSON output`,
  };
}

function emptyCounts(): BenchmarkCounts {
  return {
    refsTouched: 0,
    bundlesTouched: 0,
    sourceUnitsTouched: 0,
  };
}

function emptyTarget(env: HarnessEnv): PhaseTarget {
  return {
    adapterIds: env.adapterFilter,
    adapterDataDirs: env.adapterDirs,
    pushMode: env.pushMode,
    sinkIds: [],
    routeCount: 0,
    datasetDir: env.datasetDir,
    datasetLabel: env.datasetLabel,
    datasetManifestPath: env.datasetManifestPath,
  };
}

function clonePhaseTarget(target: PhaseTarget): PhaseTarget {
  return {
    adapterIds: [...target.adapterIds],
    adapterDataDirs: { ...target.adapterDataDirs },
    pushMode: target.pushMode,
    sinkIds: [...target.sinkIds],
    routeCount: target.routeCount,
    datasetDir: target.datasetDir,
    datasetLabel: target.datasetLabel,
    datasetManifestPath: target.datasetManifestPath,
  };
}

function mergeAdapterIds(...adapterLists: ReadonlyArray<ReadonlyArray<string>>): string[] {
  const merged = new Set<string>();

  for (const adapterIds of adapterLists) {
    for (const adapterId of adapterIds) {
      if (adapterId.trim().length > 0) {
        merged.add(adapterId);
      }
    }
  }

  return [...merged];
}

function zeroMemoryUsage(): MemoryUsageSnapshot {
  return {
    rssBytes: 0,
    heapTotalBytes: 0,
    heapUsedBytes: 0,
    externalBytes: 0,
    arrayBuffersBytes: 0,
  };
}

function printBenchmarkReport(report: BenchmarkReport): void {
  const formatMb = (bytes: number): string =>
    `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  console.log(
    `jin benchmark — v2 perf harness (${report.summary.verdict})\n${report.timestamp}\n`,
  );
  console.log(`run dir    ${report.runDir}`);
  console.log(`push mode  ${report.options.pushMode}`);
  if (report.options.adapterFilter.length > 0) {
    console.log(`adapters   ${report.options.adapterFilter.join(", ")}`);
  }
  if (report.options.datasetDir) {
    console.log(`dataset    ${report.options.datasetDir}`);
  }
  console.log("");
  console.log("phase              status    wall ms    peak RSS    refs  bundles  sources");

  for (const phase of report.phases) {
    const line = [
      phase.phase.padEnd(18, " "),
      phase.status.padEnd(8, " "),
      String(phase.wallTimeMs).padStart(8, " "),
      formatMb(phase.rss.highWaterMarkBytes).padStart(10, " "),
      String(phase.counts.refsTouched).padStart(6, " "),
      String(phase.counts.bundlesTouched).padStart(8, " "),
      String(phase.counts.sourceUnitsTouched).padStart(8, " "),
    ].join("  ");
    console.log(line);
  }

  console.log("");
  console.log(`report     ${report.artifacts.reportPath}`);
  console.log(`latest     ${report.artifacts.latestPath}`);
}

type BenchmarkWrappedAdapter = V2Adapter & {
  releaseDiscoveryMemory?: () => void;
  releaseTransientMemory?: () => void;
};

type BenchmarkTrackedStore = ConversationStore & {
  database?: SqliteConversationStore["database"];
};

type AdapterTracker = {
  adapters: BenchmarkWrappedAdapter[];
  summary: () => AdapterMetricsSummary[];
  refCount: () => number;
  sourceUnitCount: () => number;
  asCounts: (overrides?: Partial<BenchmarkCounts>) => BenchmarkCounts;
  reset: () => void;
};

type SinkTracker = {
  sinks: V2Sink[];
  summary: () => SinkMetricsSummary[];
  payloadCount: () => number;
  reset: () => void;
};

type PhaseLogCollector = {
  entries: {
    info: string[];
    warn: string[];
    error: string[];
  };
  logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
  };
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};
