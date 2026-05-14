import { sinkIdsForConversation } from "../routing";
import { DEFAULT_PUSH_BATCH_SIZE } from "../contracts/pipeline";
import type { RouteConfig } from "../contracts/config";
import type { PushError, PushPayload, Sink } from "../contracts/sinks";
import type { ConversationStore } from "../contracts/store";
import type { PipelineLogger, PushSummary } from "./types";
import type { DiagnosticLogger, DiagnosticPushReason } from "./diagnostic";

export interface PushOptions {
  batchSize?: number;
  logger?: PipelineLogger;
  diag?: DiagnosticLogger | null;
  reason?: DiagnosticPushReason;
  sampleIntervalMs?: number;
  shouldContinueSinkPush?: (
    sinkId: string,
  ) => boolean | Promise<boolean>;
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
  const diag = options.diag ?? null;
  const reason = options.reason ?? "scheduled";
  const batchSize = normalizeBatchSize(
    options.batchSize,
    DEFAULT_PUSH_BATCH_SIZE,
  );
  const sampleIntervalMs = diag
    ? normalizeSampleIntervalMs(options.sampleIntervalMs)
    : 0;

  let sinkAttempts = 0;
  let pushedConversations = 0;
  let failedConversations = 0;
  const sinkBreakdown: { sinkId: string; pushed: number; failed: number }[] = [];

  for (const sink of sinks) {
    if (!isSinkEnabled(sink)) {
      logger.info(`Skipping disabled sink ${sink.id}`);
      continue;
    }

    let sinkPushed = 0;
    let sinkFailed = 0;
    let sinkSkipped = 0;
    const dirtyConversationIds = store.conversationsNeedingPush(sink.id);
    if (dirtyConversationIds.length === 0) {
      continue;
    }
    const routedConversationIds = dirtyConversationIds.filter((conversationId) =>
      conversationTargetsSink(store, routes, sink.id, conversationId),
    );
    const staleConversations =
      dirtyConversationIds.length - routedConversationIds.length;

    const totalBatches = Math.ceil(routedConversationIds.length / batchSize);
    const sinkStartedAt = performance.now();
    diag?.pushStart({
      sinkId: sink.id,
      reason,
      dirtyConversations: routedConversationIds.length,
      staleConversations,
      batchSize,
      batchCount: totalBatches,
    });

    if (routedConversationIds.length === 0) {
      diag?.pushSinkResult({
        sinkId: sink.id,
        reason,
        dirtyConversations: 0,
        staleConversations,
        pushed: 0,
        failed: 0,
        skippedConversations: 0,
        durationMs: performance.now() - sinkStartedAt,
      });
      continue;
    }

    for (
      let start = 0, batchIndex = 0;
      start < routedConversationIds.length;
      start += batchSize, batchIndex += 1
    ) {
      if (!(await shouldContinueSinkPush(sink.id, options, logger))) {
        const remainingConversations = routedConversationIds.length - start;
        sinkSkipped += remainingConversations;
        logger.warn(
          `Stopping push for disabled sink ${sink.id}; ${remainingConversations} conversation${remainingConversations === 1 ? "" : "s"} remain queued.`,
        );
        break;
      }

      const batchConversationIds = routedConversationIds.slice(
        start,
        start + batchSize,
      );
      const payloads = batchConversationIds
        .map((conversationId) => createPayload(store, conversationId))
        .filter((payload): payload is PushPayload => payload !== null);
      const skippedConversations = batchConversationIds.length - payloads.length;
      const selectedConversations = Math.min(
        routedConversationIds.length,
        start + batchConversationIds.length,
      );
      const remainingConversations = Math.max(
        0,
        routedConversationIds.length - selectedConversations,
      );

      sinkSkipped += skippedConversations;
      diag?.pushBatch({
        sinkId: sink.id,
        reason,
        batchIndex: batchIndex + 1,
        batchCount: totalBatches,
        totalDirtyConversations: routedConversationIds.length,
        selectedConversations,
        remainingConversations,
        dirtyInBatch: batchConversationIds.length,
        payloadCount: payloads.length,
        skippedConversations,
        dirtyConversationIds: batchConversationIds,
        payloadConversationIds: payloads.map((payload) => payload.conversation.id),
      });

      if (payloads.length === 0) {
        if (start + batchSize < routedConversationIds.length) {
          await Bun.sleep(0);
        }
        continue;
      }

      sinkAttempts += 1;

      try {
        const result = await waitForPushResult(
          sink.push(payloads),
          sampleIntervalMs,
          (elapsedMs) => {
            diag?.pushSample({
              sinkId: sink.id,
              reason,
              batchIndex: batchIndex + 1,
              batchCount: totalBatches,
              totalDirtyConversations: routedConversationIds.length,
              selectedConversations,
              remainingConversations,
              inFlightConversations: payloads.length,
              elapsedMs,
              payloadConversationIds: payloads.map(
                (payload) => payload.conversation.id,
              ),
            });
          },
        );
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
            sinkFailed += 1;
            diag?.pushConversation({
              sinkId: sink.id,
              reason,
              conversationId: payload.conversation.id,
              attemptedRevision: payload.attemptedRevision,
              batchIndex: batchIndex + 1,
              totalDirtyConversations: routedConversationIds.length,
              selectedConversations,
              ok: false,
              error,
            });
            store.recordPushResult(
              payload.conversation.id,
              sink.id,
              payload.attemptedRevision,
              { ok: false, error },
            );
            continue;
          }

          pushedConversations += 1;
          sinkPushed += 1;
          diag?.pushConversation({
            sinkId: sink.id,
            reason,
            conversationId: payload.conversation.id,
            attemptedRevision: payload.attemptedRevision,
            batchIndex: batchIndex + 1,
            totalDirtyConversations: routedConversationIds.length,
            selectedConversations,
            ok: true,
          });
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
          sinkFailed += 1;
          diag?.pushConversation({
            sinkId: sink.id,
            reason,
            conversationId: payload.conversation.id,
            attemptedRevision: payload.attemptedRevision,
            batchIndex: batchIndex + 1,
            totalDirtyConversations: routedConversationIds.length,
            selectedConversations,
            ok: false,
            error: message,
          });
          store.recordPushResult(
            payload.conversation.id,
            sink.id,
            payload.attemptedRevision,
            { ok: false, error: message },
          );
        }
      }

      if (start + batchSize < routedConversationIds.length) {
        await Bun.sleep(0);
      }
    }

    diag?.pushSinkResult({
      sinkId: sink.id,
      reason,
      dirtyConversations: routedConversationIds.length,
      staleConversations,
      pushed: sinkPushed,
      failed: sinkFailed,
      skippedConversations: sinkSkipped,
      durationMs: performance.now() - sinkStartedAt,
    });
    sinkBreakdown.push({ sinkId: sink.id, pushed: sinkPushed, failed: sinkFailed });
  }

  return {
    sinkAttempts,
    pushedConversations,
    failedConversations,
    sinkBreakdown,
  };
}

function conversationTargetsSink(
  store: ConversationStore,
  routes: ReadonlyArray<RouteConfig>,
  sinkId: string,
  conversationId: string,
): boolean {
  const conversation = store.getConversation(conversationId);
  if (!conversation) {
    return false;
  }

  return sinkIdsForConversation(conversation, routes).includes(sinkId);
}

function createPayload(
  store: ConversationStore,
  conversationId: string,
): PushPayload | null {
  const conversation = store.getConversation(conversationId);
  if (!conversation) {
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

function normalizeSampleIntervalMs(
  sampleIntervalMs: number | undefined,
): number {
  if (
    typeof sampleIntervalMs !== "number" ||
    !Number.isFinite(sampleIntervalMs) ||
    sampleIntervalMs < 1
  ) {
    return 1_000;
  }

  return Math.max(1, Math.floor(sampleIntervalMs));
}

async function waitForPushResult<T>(
  operation: Promise<T>,
  sampleIntervalMs: number,
  onSample: (elapsedMs: number) => void,
): Promise<T> {
  let timer: ReturnType<typeof setInterval> | null = null;

  if (sampleIntervalMs > 0) {
    const startedAt = performance.now();
    timer = setInterval(() => {
      onSample(performance.now() - startedAt);
    }, sampleIntervalMs);
  }

  try {
    return await operation;
  } finally {
    if (timer !== null) {
      clearInterval(timer);
    }
  }
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function shouldContinueSinkPush(
  sinkId: string,
  options: PushOptions,
  logger: PipelineLogger,
): Promise<boolean> {
  if (!options.shouldContinueSinkPush) {
    return true;
  }

  try {
    return (await options.shouldContinueSinkPush(sinkId)) !== false;
  } catch (error) {
    logger.warn(
      `Stopping push for sink ${sinkId}; current config state could not be verified: ${errorToMessage(error)}`,
    );
    return false;
  }
}

function isSinkEnabled(sink: Sink): boolean {
  return (sink as Sink & { enabled?: boolean }).enabled !== false;
}
