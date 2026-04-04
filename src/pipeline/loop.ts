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
import { ingestAll, ingestOne } from "./ingest";
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
  watcher.reconcile(activeAdapters);

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
  const idleResolvers: Array<() => void> = [];
  let rssWarningActive = false;

  const scanIntervalMs =
    options.scanIntervalMs === undefined
      ? DEFAULT_SCAN_INTERVAL_MS
      : options.scanIntervalMs;
  const periodicTimer =
    scanIntervalMs && scanIntervalMs > 0
      ? setInterval(() => {
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
    enqueue({
      kind: "ingest-all",
      hint: { kind: "startup-scan" },
    });
    enqueue({ kind: "push" });
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

    const accepted = queue.enqueue(work);
    resolveIdleIfNeeded();
    return accepted;
  }

  async function waitForIdle(): Promise<void> {
    if (currentWork === null && queue.isEmpty()) {
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
      let shouldStop = false;

      try {
        if (stopping && work.kind !== "shutdown-flush") {
          continue;
        }

        enforceRssBudget(`pipeline work item ${work.kind}`);

        switch (work.kind) {
          case "reconcile-adapters": {
            activeAdapters = await resolveAdapters(options.adapterSource);
            watcher.reconcile(activeAdapters);
            break;
          }
          case "ingest-all": {
            const result = await ingestAll(
              activeAdapters,
              options.store,
              work.hint,
              {
                batchSize: ingestBatchSize,
                findChangedTimeoutMs,
                loadConversationTimeoutMs,
                logger,
                onBatchProcessed: ({ adapterId, processedRefs, totalRefs }) => {
                  enforceRssBudget(
                    `ingest batch for adapter ${adapterId} (${processedRefs}/${totalRefs})`,
                  );
                },
              },
            );
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

            const result = await ingestOne(
              adapter,
              options.store,
              work.hint,
              {
                batchSize: ingestBatchSize,
                findChangedTimeoutMs,
                loadConversationTimeoutMs,
                logger,
                onBatchProcessed: ({ adapterId, processedRefs, totalRefs }) => {
                  enforceRssBudget(
                    `ingest batch for adapter ${adapterId} (${processedRefs}/${totalRefs})`,
                  );
                },
              },
            );
            if (result.anyChanged) {
              enqueuePush();
            }
            break;
          }
          case "push": {
            await pushDirty(options.store, options.sinks, options.routes, {
              batchSize: pushBatchSize,
              logger,
            });
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
                logger,
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
            });
            shouldStop = true;
            break;
          }
        }
      } catch (error) {
        if (error instanceof PipelineRssHardLimitError) {
          shutdownPromise ??= performShutdown();
          if (work.kind === "shutdown-flush") {
            shouldStop = true;
          }
        } else {
          logger.error(`Pipeline work item ${work.kind} failed`, error);
        }
      } finally {
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

    queue.enqueue({ kind: "push" });
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
    if (currentWork !== null || !queue.isEmpty()) {
      return;
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
