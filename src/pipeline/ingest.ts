import {
  DEFAULT_INGEST_BATCH_SIZE,
  DEFAULT_FIND_CHANGED_TIMEOUT_MS,
  DEFAULT_LOAD_CONVERSATION_TIMEOUT_MS,
} from "../contracts/pipeline";
import type { Adapter, ChangeHint } from "../contracts/adapters";
import type { ConversationRef } from "../contracts/conversations";
import type { ConversationStore } from "../contracts/store";
import type { IngestResult, PipelineLogger } from "./types";

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

  let refs;
  try {
    refs = await withTimeout(
      () => adapter.findChanged(hint),
      findChangedTimeoutMs,
      new AdapterCallTimeoutError({
        adapterId: adapter.id,
        operation: "findChanged",
        timeoutMs: findChangedTimeoutMs,
      }),
    );
  } catch (error) {
    if (error instanceof AdapterCallTimeoutError) {
      logger.warn(
        `Adapter ${adapter.id} findChanged timed out after ${findChangedTimeoutMs}ms; skipping adapter for this cycle`,
      );
      return EMPTY_INGEST_RESULT;
    }

    logger.error(`Adapter ${adapter.id} failed during findChanged`, error);
    return EMPTY_INGEST_RESULT;
  }

  releaseAdapterDiscoveryMemory(adapter);

  const trackChangedConversationIds =
    options.trackChangedConversationIds !== false;
  const changedConversationIds = trackChangedConversationIds
    ? new Set<string>()
    : null;
  let anyChanged = false;
  let loadedConversationCount = 0;

  for (let start = 0; start < refs.length; start += batchSize) {
    const batch = refs.slice(start, start + batchSize);

    for (const ref of batch) {
      try {
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
          continue;
        }

        loadedConversationCount += 1;

        const result = store.writeBundle(bundle);
        if (result.changed) {
          anyChanged = true;
          changedConversationIds?.add(bundle.conversation.id);
        }
      } catch (error) {
        if (error instanceof AdapterCallTimeoutError) {
          logger.warn(
            `Adapter ${adapter.id} loadConversation timed out for ${ref.id} after ${loadConversationTimeoutMs}ms; skipping ref`,
          );
          continue;
        }

        logger.error(
          `Adapter ${adapter.id} failed to load conversation ${ref.id}`,
          error,
        );
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
  const releasableAdapter = adapter as Adapter & {
    releaseTransientMemory?: () => void;
  };
  releasableAdapter.releaseTransientMemory?.();
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
  const releasableAdapter = adapter as Adapter & {
    releaseDiscoveryMemory?: () => void;
  };
  releasableAdapter.releaseDiscoveryMemory?.();
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
