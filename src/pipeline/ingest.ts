import {
  DEFAULT_INGEST_BATCH_SIZE,
} from "../contracts/pipeline";
import type { Adapter, ChangeHint } from "../contracts/adapters";
import type { ConversationStore } from "../contracts/store";
import type { IngestResult, PipelineLogger } from "./types";

export interface IngestOptions {
  batchSize?: number;
  logger?: PipelineLogger;
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

  let refs;
  try {
    refs = await adapter.findChanged(hint);
  } catch (error) {
    logger.error(`Adapter ${adapter.id} failed during findChanged`, error);
    return EMPTY_INGEST_RESULT;
  }

  const changedConversationIds = new Set<string>();
  let loadedConversationCount = 0;

  for (let start = 0; start < refs.length; start += batchSize) {
    const batch = refs.slice(start, start + batchSize);

    for (const ref of batch) {
      try {
        const bundle = await adapter.loadConversation(ref);
        if (!bundle) {
          continue;
        }

        loadedConversationCount += 1;

        const result = store.writeBundle(bundle);
        if (result.changed) {
          changedConversationIds.add(bundle.conversation.id);
        }
      } catch (error) {
        logger.error(
          `Adapter ${adapter.id} failed to load conversation ${ref.id}`,
          error,
        );
      }
    }

    if (start + batchSize < refs.length) {
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
