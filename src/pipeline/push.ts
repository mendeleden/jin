import { sinkIdsForConversation } from "../routing";
import { DEFAULT_PUSH_BATCH_SIZE } from "../contracts/pipeline";
import type { RouteConfig } from "../contracts/config";
import type { PushError, PushPayload, Sink } from "../contracts/sinks";
import type { ConversationStore } from "../contracts/store";
import type { PipelineLogger, PushSummary } from "./types";

export interface PushOptions {
  batchSize?: number;
  logger?: PipelineLogger;
}

const NOOP_LOGGER: PipelineLogger = {
  info() {},
  warn() {},
  error() {},
};

export async function pushDirty(
  store: ConversationStore,
  sinks: ReadonlyArray<Sink>,
  routes: ReadonlyArray<RouteConfig>,
  options: PushOptions = {},
): Promise<PushSummary> {
  const logger = options.logger ?? NOOP_LOGGER;
  const batchSize = normalizeBatchSize(
    options.batchSize,
    DEFAULT_PUSH_BATCH_SIZE,
  );

  let sinkAttempts = 0;
  let pushedConversations = 0;
  let failedConversations = 0;

  for (const sink of sinks) {
    if (!isSinkEnabled(sink)) {
      logger.info(`Skipping disabled sink ${sink.id}`);
      continue;
    }

    const dirtyConversationIds = store.conversationsNeedingPush(sink.id);
    if (dirtyConversationIds.length === 0) {
      continue;
    }

    for (
      let start = 0;
      start < dirtyConversationIds.length;
      start += batchSize
    ) {
      const batchConversationIds = dirtyConversationIds.slice(
        start,
        start + batchSize,
      );
      const payloads = batchConversationIds
        .map((conversationId) =>
          createPayloadForSink(store, routes, sink.id, conversationId),
        )
        .filter((payload): payload is PushPayload => payload !== null);

      if (payloads.length === 0) {
        if (start + batchSize < dirtyConversationIds.length) {
          await Bun.sleep(0);
        }
        continue;
      }

      sinkAttempts += 1;

      try {
        const result = await sink.push(payloads);
        const errorsByConversation = mapPushErrors(
          sink,
          payloads,
          result.errors,
          result.failed,
          logger,
        );

        for (const payload of payloads) {
          const error = errorsByConversation.get(payload.conversation.id);
          if (error) {
            failedConversations += 1;
            store.recordPushResult(
              payload.conversation.id,
              sink.id,
              payload.attemptedRevision,
              { ok: false, error },
            );
            continue;
          }

          pushedConversations += 1;
          store.recordPushResult(
            payload.conversation.id,
            sink.id,
            payload.attemptedRevision,
            { ok: true },
          );
        }
      } catch (error) {
        logger.error(`Sink ${sink.id} failed during push`, error);
        const message = errorToMessage(error);

        for (const payload of payloads) {
          failedConversations += 1;
          store.recordPushResult(
            payload.conversation.id,
            sink.id,
            payload.attemptedRevision,
            { ok: false, error: message },
          );
        }
      }

      if (start + batchSize < dirtyConversationIds.length) {
        await Bun.sleep(0);
      }
    }
  }

  return {
    sinkAttempts,
    pushedConversations,
    failedConversations,
  };
}

function createPayloadForSink(
  store: ConversationStore,
  routes: ReadonlyArray<RouteConfig>,
  sinkId: string,
  conversationId: string,
): PushPayload | null {
  const conversation = store.getConversation(conversationId);
  if (!conversation) {
    return null;
  }

  const targetSinkIds = sinkIdsForConversation(conversation, routes);
  if (!targetSinkIds.includes(sinkId)) {
    return null;
  }

  return {
    attemptedRevision: store.getRevision(conversationId),
    conversation,
    messages: store.getMessages(conversationId),
    toolCalls: store.getToolCalls(conversationId),
  };
}

function mapPushErrors(
  sink: Sink,
  payloads: ReadonlyArray<PushPayload>,
  errors: ReadonlyArray<PushError>,
  failedCount: number,
  logger: PipelineLogger,
): Map<string, string> {
  const errorsByConversation = new Map<string, string>();

  for (const error of errors) {
    errorsByConversation.set(error.conversationId, error.error);
  }

  const missingFailures = Math.max(0, failedCount - errorsByConversation.size);
  if (missingFailures === 0) {
    return errorsByConversation;
  }

  logger.warn(
    `Sink ${sink.id} reported ${failedCount} failures but only returned ${errorsByConversation.size} errors`,
  );

  let assigned = 0;
  for (const payload of payloads) {
    if (errorsByConversation.has(payload.conversation.id)) {
      continue;
    }

    errorsByConversation.set(
      payload.conversation.id,
      `Sink ${sink.id} failed without a per-conversation error`,
    );
    assigned += 1;

    if (assigned >= missingFailures) {
      break;
    }
  }

  return errorsByConversation;
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

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isSinkEnabled(sink: Sink): boolean {
  return (sink as Sink & { enabled?: boolean }).enabled !== false;
}
