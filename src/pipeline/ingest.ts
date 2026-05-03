import {
  DEFAULT_INGEST_BATCH_SIZE,
  DEFAULT_FIND_CHANGED_TIMEOUT_MS,
  DEFAULT_LOAD_CONVERSATION_TIMEOUT_MS,
} from "../contracts/pipeline";
import type { Adapter, ChangeHint } from "../contracts/adapters";
import type { AdapterConfig } from "../contracts/config";
import type { ConversationRef } from "../contracts/conversations";
import type { ConversationStore } from "../contracts/store";
import {
  isDiscoveryCacheCapableAdapter,
  type DiscoveryCacheState,
} from "../adapters/discovery-cache";
import type { DiscoveryCacheRunSummary } from "../db/discovery-cache";
import {
  findChangedViaWorker,
  ingestConversationViaWorker,
} from "./ingest-worker";
import type { WorkerSampleDiagnosticFields } from "./diagnostic";
import type { IngestResult, PipelineLogger } from "./types";
import { selectWorkerCommand } from "./worker-command";

export interface IngestOptions {
  batchSize?: number;
  logger?: PipelineLogger;
  findChangedTimeoutMs?: number;
  loadConversationTimeoutMs?: number;
  reclaimBetweenAdapters?: boolean;
  trackChangedConversationIds?: boolean;
  onBatchProcessed?: (info: {
    adapterId: string;
    processedRefs: number;
    totalRefs: number;
    batchRefIds?: string[];
    batchSourcePaths?: string[];
    reclaim?: {
      beforeRssMb: number;
      afterRssMb: number;
      deltaMb: number;
    };
  }) => void | Promise<void>;
  workerIngest?: {
    command: string[];
    adapterConfigs: Record<string, AdapterConfig>;
  };
  discoveryCache?: {
    store: import("../db/discovery-cache").SqliteDiscoveryCache;
    adapterConfigs: Record<string, AdapterConfig>;
  };
  onDiscoveryResult?: (info: {
    adapterId: string;
    hintKind?: ChangeHint["kind"];
    cachedSources: number;
    invalidatedSources: number;
    freshSources: number;
    cacheDisabledReason?: string;
    invalidationReason?: string;
  }) => void | Promise<void>;
  onWorkerSample?: (
    info: WorkerSampleDiagnosticFields,
  ) => void | Promise<void>;
}

const EMPTY_INGEST_RESULT: IngestResult = {
  scannedRefCount: 0,
  loadedConversationCount: 0,
  changedConversationIds: [],
  anyChanged: false,
};

const NOOP_LOGGER: PipelineLogger = {
  info() {},
  warn() {},
  error() {},
};

const DISCOVERY_CACHE_ADAPTERS = new Set(["claude-code", "codex", "cursor"]);

interface LoadedDiscoveryCacheSummary extends DiscoveryCacheRunSummary {
  importedSourcePaths: string[];
  state: DiscoveryCacheState | null;
}

export async function ingestOne(
  adapter: Adapter,
  store: ConversationStore,
  hint?: ChangeHint,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const logger = options.logger ?? NOOP_LOGGER;
  const configuredBatchSize = normalizeBatchSize(
    options.batchSize,
    DEFAULT_INGEST_BATCH_SIZE,
  );
  const batchSize =
    needsSingleRefIngestBatch(adapter.id) ? 1 : configuredBatchSize;
  const findChangedTimeoutMs = normalizeTimeoutMs(
    options.findChangedTimeoutMs,
    DEFAULT_FIND_CHANGED_TIMEOUT_MS,
  );
  const loadConversationTimeoutMs = normalizeTimeoutMs(
    options.loadConversationTimeoutMs,
    DEFAULT_LOAD_CONVERSATION_TIMEOUT_MS,
  );
  let discoverySummary: LoadedDiscoveryCacheSummary = {
    cachedSources: 0,
    invalidatedSources: 0,
    freshSources: 0,
    importedSourcePaths: [],
    state: null,
  };

  let refs: ConversationRef[];
  let discoveryStateSnapshot: DiscoveryCacheState | null = null;
  const workerDiscoverySnapshot = resolveWorkerDiscoverySnapshot(
    adapter.id,
    options,
  );
  try {
    discoverySummary = restoreAdapterDiscoveryState(adapter, hint, store, options);
    if (workerDiscoverySnapshot) {
      const result = await findChangedViaWorker(
        selectWorkerCommand(options.workerIngest!, {
          adapterId: adapter.id,
          operation: "findChanged",
        }),
        {
          hint,
          adapter: workerDiscoverySnapshot,
          discoveryState: discoverySummary.state,
        },
        {
          timeoutMs: findChangedTimeoutMs,
          onWorkerEvent: (phase, fields) => {
            if (phase !== "sample") {
              return;
            }
            const sample = normalizeWorkerSample(fields);
            return sample ? options.onWorkerSample?.(sample) : undefined;
          },
        },
      );
      refs = result.refs;
      discoveryStateSnapshot = result.discoveryState;
    } else {
      if (discoverySummary.state && isDiscoveryCacheCapableAdapter(adapter)) {
        adapter.importDiscoveryState(discoverySummary.state);
      }
      refs = await withTimeout(
        () => adapter.findChanged(hint),
        findChangedTimeoutMs,
        new AdapterCallTimeoutError({
          adapterId: adapter.id,
          operation: "findChanged",
          timeoutMs: findChangedTimeoutMs,
        }),
      );
      discoveryStateSnapshot = snapshotAdapterDiscoveryState(adapter, options);
      releaseAdapterDiscoveryMemory(adapter);
    }
  } catch (error) {
    if (
      error instanceof AdapterCallTimeoutError ||
      (workerDiscoverySnapshot &&
        error instanceof Error &&
        error.message.includes("worker timed out after"))
    ) {
      logger.warn(
        `Adapter ${adapter.id} findChanged timed out after ${findChangedTimeoutMs}ms; skipping adapter for this cycle`,
      );
      return EMPTY_INGEST_RESULT;
    }

    logger.error(`Adapter ${adapter.id} failed during findChanged`, error);
    return EMPTY_INGEST_RESULT;
  }

  const trackChangedConversationIds =
    options.trackChangedConversationIds !== false;
  const changedConversationIds = trackChangedConversationIds
    ? new Set<string>()
    : null;
  let anyChanged = false;
  let loadedConversationCount = 0;
  const excludedDiscoverySourcePaths = new Set<string>();
  const workerSnapshot = resolveWorkerLoadSnapshot(
    adapter.id,
    hint,
    options,
  );
  for (let start = 0; start < refs.length; start += batchSize) {
    const batch = refs.slice(start, start + batchSize);

    for (const ref of batch) {
      try {
        if (workerSnapshot) {
          const result = await ingestConversationViaWorker(
            selectWorkerCommand(options.workerIngest!, {
              adapterId: adapter.id,
              operation: "loadConversation",
            }),
            store,
            {
              ref,
              adapter: workerSnapshot,
            },
            {
              timeoutMs: loadConversationTimeoutMs,
              onWorkerEvent: (phase, fields) => {
                if (phase !== "sample") {
                  return;
                }
                const sample = normalizeWorkerSample(fields);
                return sample ? options.onWorkerSample?.(sample) : undefined;
              },
            },
          );
          if (result.kind === "missing") {
            logger.warn(
              `Adapter ${adapter.id} worker reported missing conversation ${ref.id} from ${ref.sourcePath}`,
            );
            excludedDiscoverySourcePaths.add(ref.sourcePath);
            continue;
          }

          loadedConversationCount += 1;
          if (result.changed) {
            anyChanged = true;
            changedConversationIds?.add(result.conversationId);
          }
        } else {
          const bundle = await withTimeout(
            () => adapter.loadConversation(ref),
            loadConversationTimeoutMs,
            new AdapterCallTimeoutError({
              adapterId: adapter.id,
              operation: "loadConversation",
              ref,
              timeoutMs: loadConversationTimeoutMs,
            }),
          );
          if (!bundle) {
            excludedDiscoverySourcePaths.add(ref.sourcePath);
            continue;
          }

          loadedConversationCount += 1;

          const result = store.writeBundle(bundle);
          if (result.changed) {
            anyChanged = true;
            changedConversationIds?.add(bundle.conversation.id);
          }
        }
      } catch (error) {
        if (error instanceof AdapterCallTimeoutError) {
          logger.warn(
            `Adapter ${adapter.id} loadConversation timed out for ${ref.id} after ${loadConversationTimeoutMs}ms; skipping ref`,
          );
          excludedDiscoverySourcePaths.add(ref.sourcePath);
          continue;
        }

        if (
          workerSnapshot &&
          error instanceof Error &&
          error.message.includes("worker timed out after")
        ) {
          logger.warn(
            `Adapter ${adapter.id} worker loadConversation timed out for ${ref.id} after ${loadConversationTimeoutMs}ms; skipping ref`,
          );
          excludedDiscoverySourcePaths.add(ref.sourcePath);
          continue;
        }

        logger.error(
          `Adapter ${adapter.id} failed to load conversation ${ref.id}`,
          error,
        );
        excludedDiscoverySourcePaths.add(ref.sourcePath);
      }
    }

    const hasMoreRefs = start + batch.length < refs.length;

    const reclaim = needsAggressiveBatchReclaim(adapter.id)
      ? await reclaimAdapterBatchMemory(adapter, store)
      : undefined;

    if (hasMoreRefs) {
      if (options.onBatchProcessed) {
        await options.onBatchProcessed({
          adapterId: adapter.id,
          processedRefs: start + batch.length,
          totalRefs: refs.length,
          batchRefIds: batch.map((ref) => ref.id),
          batchSourcePaths: batch.map((ref) => ref.sourcePath),
          reclaim,
        });
      }

      if (adapter.id !== "codex") {
        await Bun.sleep(0);
      }
    }
  }

  const persistedSummary = persistAdapterDiscoveryState(
    adapter,
    options,
    discoverySummary,
    {
      state: discoveryStateSnapshot,
      excludedSourcePaths: excludedDiscoverySourcePaths,
    },
  );
  if (options.onDiscoveryResult) {
    await options.onDiscoveryResult({
      adapterId: adapter.id,
      hintKind: hint?.kind,
      cachedSources: persistedSummary.cachedSources,
      invalidatedSources: persistedSummary.invalidatedSources,
      freshSources: persistedSummary.freshSources,
      cacheDisabledReason: persistedSummary.disabledReason,
      invalidationReason: persistedSummary.invalidationReason,
    });
  }

  return {
    scannedRefCount: refs.length,
    loadedConversationCount,
    changedConversationIds: changedConversationIds ? [...changedConversationIds] : [],
    anyChanged,
  };
}

export async function ingestAll(
  adapters: ReadonlyArray<Adapter>,
  store: ConversationStore,
  hint?: ChangeHint,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const trackChangedConversationIds =
    options.trackChangedConversationIds !== false;
  const changedConversationIds = trackChangedConversationIds
    ? new Set<string>()
    : null;
  let scannedRefCount = 0;
  let loadedConversationCount = 0;
  let anyChanged = false;

  for (const adapter of adapters) {
    const result = await ingestOne(adapter, store, hint, options);
    scannedRefCount += result.scannedRefCount;
    loadedConversationCount += result.loadedConversationCount;
    anyChanged ||= result.anyChanged;

    if (changedConversationIds) {
      for (const conversationId of result.changedConversationIds) {
        changedConversationIds.add(conversationId);
      }
    }

    if (options.reclaimBetweenAdapters) {
      await reclaimAdapterBoundaryMemory(store);
    }
  }

  return {
    scannedRefCount,
    loadedConversationCount,
    changedConversationIds: changedConversationIds ? [...changedConversationIds] : [],
    anyChanged,
  };
}

function resolveWorkerAdapterSnapshot(
  adapterId: string,
  options: IngestOptions,
): {
  adapterId: string;
  adapterConfig: AdapterConfig;
} | null {
  if (!options.workerIngest) {
    return null;
  }

  return {
    adapterId,
    adapterConfig: options.workerIngest.adapterConfigs[adapterId] ?? {
      enabled: true,
    },
  };
}

function resolveWorkerDiscoverySnapshot(
  adapterId: string,
  options: IngestOptions,
): {
  adapterId: string;
  adapterConfig: AdapterConfig;
} | null {
  return resolveWorkerAdapterSnapshot(adapterId, options);
}

function resolveWorkerLoadSnapshot(
  adapterId: string,
  _hint: ChangeHint | undefined,
  options: IngestOptions,
): {
  adapterId: string;
  adapterConfig: AdapterConfig;
} | null {
  const snapshot = resolveWorkerAdapterSnapshot(adapterId, options);
  if (!snapshot) {
    return null;
  }

  return snapshot;
}

function restoreAdapterDiscoveryState(
  adapter: Adapter,
  hint: ChangeHint | undefined,
  store: ConversationStore,
  options: IngestOptions,
): LoadedDiscoveryCacheSummary {
  const cacheOptions = options.discoveryCache;
  if (!cacheOptions || !DISCOVERY_CACHE_ADAPTERS.has(adapter.id)) {
    return {
      cachedSources: 0,
      invalidatedSources: 0,
      freshSources: 0,
      importedSourcePaths: [],
      state: null,
    };
  }

  if (hint?.kind === "startup-scan" && !storeHasWarmLocalState(store)) {
    return {
      cachedSources: 0,
      invalidatedSources: 0,
      freshSources: 0,
      importedSourcePaths: [],
      state: null,
    };
  }

  if (!isDiscoveryCacheCapableAdapter(adapter)) {
    return {
      cachedSources: 0,
      invalidatedSources: 0,
      freshSources: 0,
      disabledReason: "adapter-missing-cache-hooks",
      importedSourcePaths: [],
      state: null,
    };
  }

  const result = cacheOptions.store.loadForAdapter(
    adapter,
    cacheOptions.adapterConfigs[adapter.id] ?? { enabled: true },
  );

  return {
    cachedSources: result.cachedSources,
    invalidatedSources: 0,
    freshSources: 0,
    invalidationReason: result.invalidationReason,
    disabledReason: result.disabledReason,
    importedSourcePaths: result.state?.sources.map((source) => source.sourcePath) ?? [],
    state: result.state,
  };
}

function persistAdapterDiscoveryState(
  adapter: Adapter,
  options: IngestOptions,
  baseline: LoadedDiscoveryCacheSummary,
  overrides?: {
    state?: DiscoveryCacheState | null;
    excludedSourcePaths?: ReadonlySet<string>;
  },
): DiscoveryCacheRunSummary {
  const cacheOptions = options.discoveryCache;
  if (!cacheOptions || !DISCOVERY_CACHE_ADAPTERS.has(adapter.id)) {
    return baseline;
  }

  if (!isDiscoveryCacheCapableAdapter(adapter)) {
    return {
      ...baseline,
      disabledReason: baseline.disabledReason ?? "adapter-missing-cache-hooks",
    };
  }

  const state =
    overrides?.state ?? snapshotAdapterDiscoveryState(adapter, options);
  if (!state) {
    return baseline;
  }
  const excludedSourcePaths = overrides?.excludedSourcePaths ?? new Set<string>();
  const filteredState =
    excludedSourcePaths.size === 0
      ? state
      : {
          sources: state.sources.filter(
            (source) => !excludedSourcePaths.has(source.sourcePath),
          ),
        };
  const importedPaths = new Set<string>(baseline.importedSourcePaths);
  const exportedPaths = new Set<string>(
    filteredState.sources.map((source) => source.sourcePath),
  );
  let invalidatedSources = 0;
  let freshSources = 0;

  for (const sourcePath of exportedPaths) {
    if (!importedPaths.has(sourcePath)) {
      freshSources += 1;
    }
  }
  for (const sourcePath of importedPaths) {
    if (!exportedPaths.has(sourcePath)) {
      invalidatedSources += 1;
    }
  }

  const summary: DiscoveryCacheRunSummary = {
    cachedSources: baseline.cachedSources,
    invalidatedSources,
    freshSources,
    invalidationReason:
      excludedSourcePaths.size > 0
        ? "partial-load-failure-excluded-sources"
        : baseline.invalidationReason,
    disabledReason: baseline.disabledReason,
  };

  cacheOptions.store.saveForAdapter(
    adapter,
    cacheOptions.adapterConfigs[adapter.id] ?? { enabled: true },
    filteredState,
    summary,
  );

  return summary;
}

function snapshotAdapterDiscoveryState(
  adapter: Adapter,
  options: IngestOptions,
): DiscoveryCacheState | null {
  const cacheOptions = options.discoveryCache;
  if (!cacheOptions || !DISCOVERY_CACHE_ADAPTERS.has(adapter.id)) {
    return null;
  }

  if (!isDiscoveryCacheCapableAdapter(adapter)) {
    return null;
  }

  return adapter.exportDiscoveryState();
}

function storeHasWarmLocalState(store: ConversationStore): boolean {
  return store.hasLocalData?.() ?? false;
}

function normalizeBatchSize(
  batchSize: number | undefined,
  fallback: number,
): number {
  if (typeof batchSize !== "number" || !Number.isFinite(batchSize)) {
    return fallback;
  }

  return Math.max(1, Math.floor(batchSize));
}

function normalizeTimeoutMs(
  timeoutMs: number | undefined,
  fallback: number,
): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return fallback;
  }

  return Math.max(1, Math.floor(timeoutMs));
}

function normalizeWorkerSample(
  fields: Record<string, unknown>,
): WorkerSampleDiagnosticFields | null {
  if (
    typeof fields.adapterId !== "string" ||
    typeof fields.phase !== "string" ||
    typeof fields.childRssMb !== "number" ||
    typeof fields.childCpuPct !== "number" ||
    typeof fields.combinedRssMb !== "number" ||
    typeof fields.combinedCpuPct !== "number"
  ) {
    return null;
  }

  return {
    adapterId: fields.adapterId,
    ...(typeof fields.refId === "string" ? { refId: fields.refId } : {}),
    phase: fields.phase,
    ...(typeof fields.childPid === "number" ? { childPid: fields.childPid } : {}),
    workerRssMb: fields.childRssMb,
    workerCpuPct: fields.childCpuPct,
    ...(typeof fields.childJscHeapMb === "number"
      ? { workerJscHeapMb: fields.childJscHeapMb }
      : {}),
    ...(typeof fields.childExternalMb === "number"
      ? { workerExternalMb: fields.childExternalMb }
      : {}),
    combinedRssMb: fields.combinedRssMb,
    combinedCpuPct: fields.combinedCpuPct,
  };
}

async function withTimeout<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  error: AdapterCallTimeoutError,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

class AdapterCallTimeoutError extends Error {
  readonly adapterId: string;
  readonly operation: "findChanged" | "loadConversation";
  readonly ref?: ConversationRef;
  readonly timeoutMs: number;

  constructor(options: {
    adapterId: string;
    operation: "findChanged" | "loadConversation";
    ref?: ConversationRef;
    timeoutMs: number;
  }) {
    const target =
      options.operation === "findChanged"
        ? "findChanged"
        : `loadConversation(${options.ref?.id ?? "unknown"})`;
    super(
      `Adapter ${options.adapterId} ${target} timed out after ${options.timeoutMs}ms`,
    );
    this.name = "AdapterCallTimeoutError";
    this.adapterId = options.adapterId;
    this.operation = options.operation;
    this.ref = options.ref;
    this.timeoutMs = options.timeoutMs;
  }
}

function needsSingleRefIngestBatch(adapterId: string): boolean {
  return (
    adapterId === "codex" ||
    adapterId === "claude-code" ||
    adapterId === "cursor"
  );
}

function needsAggressiveBatchReclaim(adapterId: string): boolean {
  return (
    adapterId === "codex" ||
    adapterId === "claude-code" ||
    adapterId === "cursor"
  );
}

async function reclaimAdapterBatchMemory(
  adapter: Adapter,
  store: ConversationStore,
): Promise<{
  beforeRssMb: number;
  afterRssMb: number;
  deltaMb: number;
}> {
  const beforeRssMb = currentRssMb();
  adapter.releaseTransientMemory?.();
  if (needsAggressiveBatchReclaim(adapter.id)) {
    reclaimSqliteStoreMemory(store);
  }
  await collectProcessGarbage(true);
  const afterRssMb = currentRssMb();
  return {
    beforeRssMb,
    afterRssMb,
    deltaMb: afterRssMb - beforeRssMb,
  };
}

function releaseAdapterDiscoveryMemory(adapter: Adapter): void {
  adapter.releaseDiscoveryMemory?.();
}

function reclaimSqliteStoreMemory(store: ConversationStore): void {
  const sqliteStore = store as ConversationStore & {
    database?: {
      exec?: (sql: string) => unknown;
    };
  };
  const exec = sqliteStore.database?.exec;
  if (typeof exec !== "function") {
    return;
  }

  try {
    exec.call(sqliteStore.database, "PRAGMA wal_checkpoint(PASSIVE)");
    exec.call(sqliteStore.database, "PRAGMA shrink_memory");
  } catch {
    // Skip SQLite-specific reclaim when the active store does not support it.
  }
}

async function reclaimProcessMemory(
  store: ConversationStore,
  doubleCollect = true,
): Promise<void> {
  reclaimSqliteStoreMemory(store);
  await collectProcessGarbage(doubleCollect);
}

export async function reclaimAdapterBoundaryMemory(
  store?: ConversationStore,
): Promise<{
  beforeRssMb: number;
  afterRssMb: number;
  deltaMb: number;
}> {
  const beforeRssMb = currentRssMb();
  if (store) {
    reclaimSqliteStoreMemory(store);
  }
  await collectProcessGarbage(true);
  const afterRssMb = currentRssMb();
  return {
    beforeRssMb,
    afterRssMb,
    deltaMb: afterRssMb - beforeRssMb,
  };
}

async function collectProcessGarbage(doubleCollect = true): Promise<void> {
  Bun.gc(true);
  await Bun.sleep(0);
  if (doubleCollect) {
    Bun.gc(true);
  }
}

function currentRssMb(): number {
  return Math.round(process.memoryUsage().rss / (1024 * 1024));
}
