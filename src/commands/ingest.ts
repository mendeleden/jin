import { loadConfig, resolveAdapterConfig, type JinConfig } from "../config";
import type { Adapter as V2Adapter } from "../contracts/adapters";
import type { Sink as V2Sink } from "../contracts/sinks";
import { allAdapters } from "../adapters/registry";
import {
  isPoisonedLocalStoreError,
  openStoreAtPath,
  printPoisonedLocalStoreResetGuidance,
} from "../db/store";
import { getRuntimePaths, getRuntimeStatus, runModeLabel } from "../daemon/runtime-state";
import { ingestAll } from "../pipeline/ingest";
import { pushDirty } from "../pipeline/push";
import type { PipelineLogger } from "../pipeline/types";
import { createSink } from "../sinks/registry";

export async function ingestCommand(): Promise<void> {
  const runtime = getRuntimeStatus();
  if (runtime.owner && runtime.state !== "stopped") {
    console.error(
      `  Error: jin is already running under ${runModeLabel(runtime.owner.mode)}.`,
    );
    console.error(
      "  Stop the active runtime or use `jin start` / `jin status` instead of running a second write-capable coordinator.",
    );
    process.exit(1);
  }

  const runtimePaths = getRuntimePaths();
  const config = await loadConfig();
  const logger = createIngestLogger();
  const activeAdapters = await detectActiveAdapters(config);
  let store: ReturnType<typeof openStoreAtPath> | null = null;
  let sinks: V2Sink[] = [];

  if (activeAdapters.length === 0) {
    console.log("  No supported coding tools detected.");
    return;
  }

  try {
    store = openStoreAtPath(runtimePaths.storePath);
    sinks = await createActiveSinks(config, logger);

    const ingestSummary = await ingestAll(
      activeAdapters,
      store,
      { kind: "startup-scan" },
      { logger },
    );

    let pushSummary = {
      sinkAttempts: 0,
      pushedConversations: 0,
      failedConversations: 0,
    };
    if (sinks.length > 0 && ingestSummary.anyChanged) {
      pushSummary = await pushDirty(store, sinks, config.routes, { logger });
    }

    console.log(
      `  Done. scanned ${ingestSummary.scannedRefCount} refs, loaded ${ingestSummary.loadedConversationCount} conversations, changed ${ingestSummary.changedConversationIds.length}.`,
    );
    if (sinks.length > 0) {
      console.log(
        `  Push attempts: ${pushSummary.sinkAttempts}, pushed: ${pushSummary.pushedConversations}, failed: ${pushSummary.failedConversations}.`,
      );
    }
  } catch (error) {
    if (isPoisonedLocalStoreError(error)) {
      printPoisonedLocalStoreResetGuidance(runtimePaths.configDir);
      process.exit(1);
    }
    throw error;
  } finally {
    await closeSinks(sinks);
    store?.close();
  }
}

async function detectActiveAdapters(config: JinConfig): Promise<V2Adapter[]> {
  const adapters = allAdapters(config.adapters);
  const activeAdapters: V2Adapter[] = [];

  for (const adapter of adapters) {
    if (resolveAdapterConfig(config.adapters, adapter.id).enabled === false) {
      continue;
    }
    try {
      if (await adapter.detect()) {
        activeAdapters.push(adapter as unknown as V2Adapter);
      }
    } catch {}
  }

  return activeAdapters;
}

async function createActiveSinks(
  config: JinConfig,
  logger: PipelineLogger,
): Promise<V2Sink[]> {
  const sinks: V2Sink[] = [];

  for (let index = 0; index < (config.sinks || []).length; index += 1) {
    const sinkConfig = config.sinks[index];
    try {
      const sink = createSink(
        sinkConfig,
        index,
      ) as unknown as V2Sink & { enabled?: boolean };
      sink.enabled = sinkConfig.enabled !== false;

      if (sink.enabled === false) {
        sinks.push(sink);
        logger.info(`Skipping disabled sink ${sink.name}`);
        continue;
      }

      const health = await sink.healthCheck();
      if (health.ok) {
        sinks.push(sink);
      } else {
        logger.warn(`Sink ${sink.name} failed health check: ${health.error}`);
      }
    } catch (error) {
      logger.error("Sink initialization failed", error);
    }
  }

  return sinks;
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

function createIngestLogger(): PipelineLogger {
  return {
    info(message: string) {
      console.log(`  ${message}`);
    },
    warn(message: string) {
      console.log(`  WARNING: ${message}`);
    },
    error(message: string, error?: unknown) {
      if (error === undefined) {
        console.error(`  ERROR: ${message}`);
        return;
      }
      if (error instanceof Error) {
        console.error(`  ERROR: ${message} — ${error.message}`);
        return;
      }
      console.error(`  ERROR: ${message} — ${String(error)}`);
    },
  };
}
