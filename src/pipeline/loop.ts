import { DEFAULT_SCAN_INTERVAL_MS } from "../contracts/config";
import { SHUTDOWN_DRAIN_TIMEOUT_MS } from "../contracts/lifecycle";
import {
  DEFAULT_INGEST_BATCH_SIZE,
  DEFAULT_FIND_CHANGED_TIMEOUT_MS,
  DEFAULT_LOAD_CONVERSATION_TIMEOUT_MS,
  DEFAULT_PUSH_BATCH_SIZE,
  DEFAULT_WATCH_DEBOUNCE_MS,
} from "../contracts/pipeline";
import type { Adapter, ChangeHint } from "../contracts/adapters";
import {
  ingestAll,
  ingestOne,
  reclaimAdapterBoundaryMemory,
} from "./ingest";
import { pushDirty } from "./push";
import { WorkQueue } from "./queue";
import type {
  PipelineHandle,
  PipelineLogger,
  PipelineShutdownResult,
  PipelineWorkItem,
  QueueablePipelineWorkItem,
  RunPipelineOptions,
} from "./types";
import { WatcherController } from "./watcher";
import { DiagnosticLogger } from "./diagnostic";

const NOOP_LOGGER: PipelineLogger = {
  info() {},
  warn() {},
  error() {},
};

const DEFAULT_RSS_WARNING_BYTES = 200 * 1024 * 1024;
const DEFAULT_RSS_HARD_LIMIT_BYTES = 256 * 1024 * 1024;

// BP-02 uses a shutdown-specific full scan, but the frozen adapter contract only
// publishes startup/fs-change/periodic hints. Reusing periodic-scan preserves
// the full-scan semantics without widening the contract surface in this packet.
const SHUTDOWN_SCAN_HINT: ChangeHint = { kind: "periodic-scan" };

export async function runPipeline(
  options: RunPipelineOptions,
): Promise<PipelineHandle> {
  const logger = options.logger ?? NOOP_LOGGER;
  let activeAdapters = await resolveAdapters(options.adapterSource);

  const queue = new WorkQueue();
  const watcher = new WatcherController({
    debounceMs: options.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS,
    onChange: (event) => {
      enqueue({
        kind: "ingest-adapter",
        adapterId: event.adapterId,
        hint: {
          kind: "fs-change",
          changedPaths: [event.path],
        },
      });
    },
    watcherFactory: options.watcherFactory,
  });
  const deferWatcherStart = options.deferWatcherStart === true;
  let watcherStarted = false;
  if (!deferWatcherStart) {
    watcher.reconcile(activeAdapters);
    watcherStarted = true;
  }

  const ingestBatchSize = normalizeBatchSize(
    options.ingestBatchSize,
    DEFAULT_INGEST_BATCH_SIZE,
  );
  const pushBatchSize = normalizeBatchSize(
    options.pushBatchSize,
    DEFAULT_PUSH_BATCH_SIZE,
  );
  const findChangedTimeoutMs = normalizeTimeoutMs(
    DEFAULT_FIND_CHANGED_TIMEOUT_MS,
  );
  const loadConversationTimeoutMs = normalizeTimeoutMs(
    DEFAULT_LOAD_CONVERSATION_TIMEOUT_MS,
  );
  const shutdownDrainTimeoutMs =
    options.shutdownDrainTimeoutMs ?? SHUTDOWN_DRAIN_TIMEOUT_MS;
  const rssWarningBytes = normalizeRssBytes(
    options.rssWarningBytes,
    DEFAULT_RSS_WARNING_BYTES,
  );
  const rssHardLimitBytes = normalizeRssBytes(
    options.rssHardLimitBytes,
    DEFAULT_RSS_HARD_LIMIT_BYTES,
  );
  const getRssBytes = options.getRssBytes ?? (() => process.memoryUsage().rss);

  let currentWork: PipelineWorkItem | null = null;
  let stopping = false;
  let shutdownPromise: Promise<PipelineShutdownResult> | null = null;
  let shutdownInitiated = false;
  let abandonedWorkItems = 0;
  let handedOffWorkItems = 0;
  const idleResolvers: Array<() => void> = [];
  let rssWarningActive = false;

  const diag = options.diagnosticLogPath
    ? new DiagnosticLogger({
        path: options.diagnosticLogPath,
        getRssBytes,
        getQueueSize: () => queue.size,
        getQueueSnapshot: () => queue.snapshot(),
      })
    : null;

  const scanIntervalMs =
    options.scanIntervalMs === undefined
      ? DEFAULT_SCAN_INTERVAL_MS
      : options.scanIntervalMs;
  const periodicTimer =
    scanIntervalMs && scanIntervalMs > 0
      ? setInterval(() => {
          diag?.periodicTick();
          enqueue({ kind: "reconcile-adapters" });
          enqueue({
            kind: "ingest-all",
            hint: { kind: "periodic-scan" },
          });
          enqueue({ kind: "push" });
        }, scanIntervalMs)
      : null;

  const coordinatorDone = coordinator();

  if (options.scheduleStartupWork !== false) {
    queueMicrotask(() => {
      for (const adapter of activeAdapters) {
        enqueue({
          kind: "ingest-adapter",
          adapterId: adapter.id,
          hint: { kind: "startup-scan" },
        });
      }
    });
  }

  return {
    enqueue,
    waitForIdle,
    shutdown,
  };

  function enqueue(work: QueueablePipelineWorkItem): boolean {
    if (stopping) {
      return false;
    }

    const enqueueResult = queue.enqueue(work);
    diag?.queueEvent(
      enqueueResult,
      work.kind,
      work.kind === "ingest-adapter" ? work.adapterId : undefined,
    );
    if (enqueueResult === "handed-off") {
      handedOffWorkItems += 1;
    }
    resolveIdleIfNeeded();
    return true;
  }

  async function waitForIdle(): Promise<void> {
    if (currentWork === null && handedOffWorkItems === 0 && queue.isEmpty()) {
      return;
    }

    await new Promise<void>((resolve) => {
      idleResolvers.push(resolve);
    });
  }

  async function shutdown(): Promise<PipelineShutdownResult> {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = performShutdown();
    return shutdownPromise;
  }

  async function performShutdown(): Promise<PipelineShutdownResult> {
    initiateShutdown();

    const timedOut = await Promise.race([
      coordinatorDone.then(() => false),
      Bun.sleep(shutdownDrainTimeoutMs).then(() => true),
    ]);

    const result: PipelineShutdownResult = {
      timedOut,
      abandonedWorkItems,
    };

    if (timedOut) {
      logger.warn("Shutdown budget exceeded while flushing pipeline work");
      if (options.onShutdownTimeout) {
        await options.onShutdownTimeout(result);
      }
      return result;
    }

    await Promise.allSettled(
      options.sinks.map(async (sink) => {
        try {
          await sink.close();
        } catch (error) {
          logger.error(`Sink ${sink.id} failed during close`, error);
        }
      }),
    );

    return result;
  }

  async function coordinator(): Promise<void> {
    while (true) {
      const work = await queue.take();
      currentWork = work;
      if (handedOffWorkItems > 0) {
        handedOffWorkItems -= 1;
      }
      let shouldStop = false;
      let workError: string | undefined;
      const workStartedAt = performance.now();
      diag?.workStart(work);

      try {
        if (stopping && work.kind !== "shutdown-flush") {
          continue;
        }

        enforceRssBudget(`pipeline work item ${work.kind}`);

        switch (work.kind) {
          case "reconcile-adapters": {
            const t0 = performance.now();
            activeAdapters = await resolveAdapters(options.adapterSource);
            if (watcherStarted) {
              watcher.reconcile(activeAdapters);
            }
            diag?.reconcileResult(activeAdapters.length, activeAdapters.map(a => a.id), performance.now() - t0);
            break;
          }
          case "ingest-all": {
            const t0 = performance.now();
            const result = await ingestAll(
              activeAdapters,
              options.store,
              work.hint,
              {
                batchSize: ingestBatchSize,
                findChangedTimeoutMs,
                loadConversationTimeoutMs,
                reclaimBetweenAdapters: true,
                trackChangedConversationIds: false,
                logger,
                workerIngest: options.workerIngest,
                discoveryCache: options.discoveryCache,
                onDiscoveryResult: (info) => {
                  diag?.discoveryResult(info);
                },
                onWorkerSample: (info) => {
                  diag?.workerSample(info);
                },
                onBatchProcessed: (info) => {
                  diag?.ingestBatch(info);
                  enforceRssBudget(
                    `ingest batch for adapter ${info.adapterId} (${info.processedRefs}/${info.totalRefs})`,
                  );
                },
              },
            );
            diag?.ingestResult("*", result, performance.now() - t0);
            if (result.anyChanged) {
              enqueuePush();
            }
            break;
          }
          case "ingest-adapter": {
            const adapter = activeAdapters.find(
              (candidate) => candidate.id === work.adapterId,
            );
            if (!adapter) {
              logger.warn(
                `Skipping ingest for unknown adapter ${work.adapterId}`,
              );
              break;
            }

            const t0 = performance.now();
            const result = await ingestOne(
              adapter,
              options.store,
              work.hint,
              {
                batchSize: ingestBatchSize,
                findChangedTimeoutMs,
                loadConversationTimeoutMs,
                reclaimBetweenAdapters: true,
                trackChangedConversationIds: false,
                logger,
                workerIngest: options.workerIngest,
                discoveryCache: options.discoveryCache,
                onDiscoveryResult: (info) => {
                  diag?.discoveryResult(info);
                },
                onWorkerSample: (info) => {
                  diag?.workerSample(info);
                },
                onBatchProcessed: (info) => {
                  diag?.ingestBatch(info);
                  enforceRssBudget(
                    `ingest batch for adapter ${info.adapterId} (${info.processedRefs}/${info.totalRefs})`,
                  );
                },
              },
            );
            diag?.ingestResult(work.adapterId, result, performance.now() - t0);
            if (result.anyChanged) {
              enqueuePush();
            }
            const reclaim = await reclaimAdapterBoundaryMemory(options.store);
            diag?.adapterBoundaryReclaim(work.adapterId, reclaim);
            break;
          }
          case "push": {
            const t0 = performance.now();
            const summary = await pushDirty(options.store, options.sinks, options.routes, {
              batchSize: pushBatchSize,
              logger,
              diag,
            });
            diag?.pushResult(summary, performance.now() - t0, summary.sinkBreakdown);
            break;
          }
          case "shutdown-flush": {
            await ingestAll(
              activeAdapters,
              options.store,
              SHUTDOWN_SCAN_HINT,
              {
                batchSize: ingestBatchSize,
                findChangedTimeoutMs,
                loadConversationTimeoutMs,
                trackChangedConversationIds: false,
                logger,
                workerIngest: options.workerIngest,
                discoveryCache: options.discoveryCache,
                onDiscoveryResult: (info) => {
                  diag?.discoveryResult(info);
                },
                onWorkerSample: (info) => {
                  diag?.workerSample(info);
                },
                onBatchProcessed: ({ adapterId, processedRefs, totalRefs }) => {
                  enforceRssBudget(
                    `shutdown ingest batch for adapter ${adapterId} (${processedRefs}/${totalRefs})`,
                  );
                },
              },
            );
            await pushDirty(options.store, options.sinks, options.routes, {
              batchSize: pushBatchSize,
              logger,
              diag,
            });
            shouldStop = true;
            break;
          }
        }
      } catch (error) {
        workError = error instanceof Error ? error.message : String(error);
        if (error instanceof PipelineRssHardLimitError) {
          shutdownPromise ??= performShutdown();
          if (work.kind === "shutdown-flush") {
            shouldStop = true;
          }
        } else {
          logger.error(`Pipeline work item ${work.kind} failed`, error);
        }
      } finally {
        diag?.workEnd(work, performance.now() - workStartedAt, workError);
        currentWork = null;
        resolveIdleIfNeeded();
      }

      if (shouldStop) {
        return;
      }
    }
  }

  function enqueuePush(): void {
    if (stopping) {
      return;
    }

    enqueue({ kind: "push" });
  }

  function initiateShutdown(): void {
    if (shutdownInitiated) {
      return;
    }

    shutdownInitiated = true;
    stopping = true;
    watcher.close();

    if (periodicTimer) {
      clearInterval(periodicTimer);
    }

    abandonedWorkItems = queue.discard(
      (item) => item.kind !== "shutdown-flush",
    );
    queue.enqueue({ kind: "shutdown-flush" });
    diag?.queueEvent("queued", "shutdown-flush");
  }

  function enforceRssBudget(context: string): void {
    const rssBytes = getRssBytes();
    if (!Number.isFinite(rssBytes) || rssBytes < 0) {
      return;
    }

    if (rssBytes >= rssHardLimitBytes) {
      logger.error(
        `RSS ${formatRssMb(rssBytes)} MB exceeded the ${formatRssMb(rssHardLimitBytes)} MB hard limit during ${context}; starting bounded shutdown`,
      );
      throw new PipelineRssHardLimitError(rssBytes, rssHardLimitBytes);
    }

    if (rssBytes >= rssWarningBytes) {
      if (!rssWarningActive) {
        logger.warn(
          `RSS ${formatRssMb(rssBytes)} MB is above the ${formatRssMb(rssWarningBytes)} MB warning threshold during ${context}`,
        );
        rssWarningActive = true;
      }
      return;
    }

    rssWarningActive = false;
  }

  function resolveIdleIfNeeded(): void {
    if (currentWork !== null || handedOffWorkItems > 0 || !queue.isEmpty()) {
      return;
    }

    if (!stopping && deferWatcherStart && !watcherStarted) {
      watcher.reconcile(activeAdapters);
      watcherStarted = true;
    }

    while (idleResolvers.length > 0) {
      idleResolvers.shift()?.();
    }
  }
}

async function resolveAdapters(
  adapterSource: RunPipelineOptions["adapterSource"],
): Promise<Adapter[]> {
  if (typeof adapterSource === "function") {
    return [...(await adapterSource())];
  }

  return [...adapterSource];
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

function normalizeTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) {
    return 1;
  }

  return Math.max(1, Math.floor(timeoutMs));
}

function normalizeRssBytes(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function formatRssMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

class PipelineRssHardLimitError extends Error {
  readonly rssBytes: number;
  readonly hardLimitBytes: number;

  constructor(rssBytes: number, hardLimitBytes: number) {
    super(
      `RSS ${formatRssMb(rssBytes)} MB exceeded hard limit ${formatRssMb(hardLimitBytes)} MB`,
    );
    this.name = "PipelineRssHardLimitError";
    this.rssBytes = rssBytes;
    this.hardLimitBytes = hardLimitBytes;
  }
}
