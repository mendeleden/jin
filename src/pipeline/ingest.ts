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
  onBatchProcessed?: (info: {
    adapterId: string;
    processedRefs: number;
    totalRefs: number;
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
  const batchSize = normalizeBatchSize(
    options.batchSize,
    DEFAULT_INGEST_BATCH_SIZE,
  );
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

  const changedConversationIds = new Set<string>();
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
          changedConversationIds.add(bundle.conversation.id);
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

    if (start + batchSize < refs.length) {
      if (options.onBatchProcessed) {
        await options.onBatchProcessed({
          adapterId: adapter.id,
          processedRefs: start + batch.length,
          totalRefs: refs.length,
        });
      }
      await Bun.sleep(0);
    }
  }

  return {
    scannedRefCount: refs.length,
    loadedConversationCount,
    changedConversationIds: [...changedConversationIds],
    anyChanged: changedConversationIds.size > 0,
  };
}

export async function ingestAll(
  adapters: ReadonlyArray<Adapter>,
  store: ConversationStore,
  hint?: ChangeHint,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const changedConversationIds = new Set<string>();
  let scannedRefCount = 0;
  let loadedConversationCount = 0;

  for (const adapter of adapters) {
    const result = await ingestOne(adapter, store, hint, options);
    scannedRefCount += result.scannedRefCount;
    loadedConversationCount += result.loadedConversationCount;

    for (const conversationId of result.changedConversationIds) {
      changedConversationIds.add(conversationId);
    }
  }

  return {
    scannedRefCount,
    loadedConversationCount,
    changedConversationIds: [...changedConversationIds],
    anyChanged: changedConversationIds.size > 0,
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
  return Promise.race([
    work(),
    Bun.sleep(timeoutMs).then(() => {
      throw error;
    }),
  ]);
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
