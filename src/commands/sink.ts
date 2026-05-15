import {
  DEFAULT_S3_PREFIX,
  DEFAULT_S3_REGION,
  loadConfig,
  loadRuntimeConfigGeneration,
  updateConfig,
  type JinConfig,
  type SinkConfig,
} from "../config";
import type { SinkType } from "../contracts/config";
import type { Sink as V2Sink } from "../contracts/sinks";
import {
  isPoisonedLocalStoreError,
  openStoreAtPath,
  printPoisonedLocalStoreResetGuidance,
} from "../db/store";
import { resetPushStateForSink } from "../db/sync";
import {
  getRuntimePaths,
  getRuntimeStatus,
  runModeLabel,
} from "../daemon/runtime-state";
import { DiagnosticLogger } from "../pipeline/diagnostic";
import { pushDirty } from "../pipeline/push";
import type { PipelineLogger } from "../pipeline/types";
import { createSink } from "../sinks/registry";
import { finalizeConfigChange } from "./config-control";
import { join } from "path";

export interface SinkCommandOptions {
  id?: string;
  connectionString?: string;
  url?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string;
  pathStyle?: boolean;
  teamId?: string;
  userId?: string;
  restart?: boolean;
}

export interface SinkCandidateInput extends SinkCommandOptions {
  type: SinkType;
}

export async function sinkAddCommand(
  type: SinkType,
  opts: SinkCommandOptions,
): Promise<void> {
  await preflightSinkCandidate({ ...opts, type });
  const { result } = await updateConfig(
    (config) => ensureSinkConfigured(config, { ...opts, type }, { validate: false }),
    {
      shouldSave: (result) => result.created,
    },
  );

  if (!result.created) {
    console.log(`  Sink already configured: ${result.sinkId}`);
    return;
  }

  await finalizeConfigChange({
    restart: opts.restart,
    changeSummary: `Added sink ${result.sinkId}`,
  });
  console.log(
    `  Add a route with: jin route add --remote="*" --sink=${result.sinkId}`,
  );
}

export async function sinkRemoveCommand(
  sinkId: string,
  opts: { restart?: boolean } = {},
): Promise<void> {
  if (!sinkId) {
    fail("specify a sink id");
  }

  const { result } = await updateConfig((config) => {
    const sinkIndex = findSinkIndexById(config, sinkId);
    if (sinkIndex === -1) {
      fail(`sink "${sinkId}" not found`);
    }

    config.sinks.splice(sinkIndex, 1);

    let affectedRoutes = 0;
    config.routes = config.routes.flatMap((route) => {
      if (!route.sinks.includes(sinkId)) {
        return [route];
      }

      affectedRoutes += 1;
      const remainingSinks = route.sinks.filter((id) => id !== sinkId);
      if (remainingSinks.length === 0) {
        return [];
      }

      return [{ ...route, sinks: remainingSinks }];
    });

    return { affectedRoutes };
  });

  await finalizeConfigChange({
    restart: opts.restart,
    changeSummary:
      result.affectedRoutes > 0
        ? `Removed sink ${sinkId} and updated ${result.affectedRoutes} route${result.affectedRoutes === 1 ? "" : "s"}`
        : `Removed sink ${sinkId}`,
  });
}

export async function sinkDisableCommand(
  sinkId: string,
  opts: { restart?: boolean } = {},
): Promise<void> {
  await setSinkEnabled(sinkId, false, opts);
}

export async function sinkEnableCommand(
  sinkId: string,
  opts: { restart?: boolean } = {},
): Promise<void> {
  await setSinkEnabled(sinkId, true, opts);
}

export async function sinkRepushCommand(sinkId: string): Promise<void> {
  if (!sinkId) {
    fail("specify a sink id");
  }

  const runtime = getRuntimeStatus();
  if (runtime.owner && runtime.state !== "stopped") {
    fail(
      `jin is already running under ${runModeLabel(runtime.owner.mode)}; stop the active runtime before repushing sink state`,
    );
  }

  const config = await loadConfig();
  const sinkIndex = findSinkIndexById(config, sinkId);
  if (sinkIndex === -1) {
    fail(`sink "${sinkId}" not found`);
  }

  const sinkConfig = config.sinks[sinkIndex];
  if (sinkConfig.enabled === false) {
    fail(`sink "${sinkId}" is disabled; enable it before repushing`);
  }

  const runtimePaths = getRuntimePaths();
  const logger = createSinkCommandLogger();
  let store: ReturnType<typeof openStoreAtPath> | null = null;
  let sink: (V2Sink & { enabled?: boolean }) | null = null;

  try {
    store = openStoreAtPath(runtimePaths.storePath);
    sink = createSink(
      sinkConfig,
      sinkIndex,
    ) as unknown as V2Sink & { enabled?: boolean };
    const sinkEnabled = sinkConfig.enabled === undefined ? true : sinkConfig.enabled;
    sink.enabled = sinkEnabled;

    const diagnosticPath =
      process.env.JIN_DIAGNOSTIC_LOG ||
      join(runtimePaths.configDir, "debug.jsonl");
    const diag = new DiagnosticLogger({
      path: diagnosticPath,
      getRssBytes: () => process.memoryUsage().rss,
      getQueueSize: () => 0,
      getQueueSnapshot: () => [],
    });

    const reset = resetPushStateForSink(store.database, sinkId);
    diag.repushReset({
      sinkId,
      clearedStateRows: reset.clearedStateRows,
      dirtyBefore: reset.dirtyBefore,
      dirtyAfter: reset.dirtyAfter,
    });

    console.log(
      `  Reset ${reset.clearedStateRows} push-state row${reset.clearedStateRows === 1 ? "" : "s"} for sink ${sinkId}.`,
    );

    if (!store.hasLocalData()) {
      console.log("  No local conversations are available to repush.");
      return;
    }

    if (reset.dirtyAfter === 0) {
      console.log("  No conversations are currently pending for that sink.");
      return;
    }

    const startedAt = performance.now();
    const summary = await pushDirty(store, [sink], config.routes, {
      logger,
      diag,
      reason: "repush",
    });
    diag.pushResult(
      summary,
      performance.now() - startedAt,
      summary.sinkBreakdown,
      "repush",
    );

    console.log(
      `  Repush complete. attempts ${summary.sinkAttempts}, pushed ${summary.pushedConversations}, failed ${summary.failedConversations}.`,
    );
    if (
      summary.sinkAttempts === 0 &&
      summary.pushedConversations === 0 &&
      summary.failedConversations === 0
    ) {
      console.log(
        "  No conversations matched the sink's current routes, so the reset remains durable for a later push.",
      );
    }
  } catch (error) {
    if (isPoisonedLocalStoreError(error)) {
      printPoisonedLocalStoreResetGuidance(runtimePaths.configDir);
      process.exit(1);
    }
    throw error;
  } finally {
    await sink?.close().catch(() => {});
    store?.close();
  }
}

export async function ensureSinkConfigured(
  config: JinConfig,
  input: SinkCandidateInput,
  opts: { validate?: boolean } = {},
): Promise<{ sinkId: string; created: boolean; sink: SinkConfig }> {
  const candidate = buildSinkConfig(config, input);

  const existingById = findSinkIndexById(config, candidate.id);
  if (existingById >= 0) {
    const existing = config.sinks[existingById];
    if (sameSinkIdentity(existing, candidate)) {
      return { sinkId: existing.id, created: false, sink: existing };
    }
    fail(`sink id "${candidate.id}" is already configured`);
  }

  const equivalent = config.sinks.find((sink) => sameSinkTransport(sink, candidate));
  if (equivalent) {
    if (sameSinkIdentity(equivalent, candidate)) {
      return { sinkId: equivalent.id, created: false, sink: equivalent };
    }
    fail(
      `sink transport is already configured as "${equivalent.id}" with different teamId/userId; duplicate transport endpoints with different export identity are not supported yet`,
    );
  }

  if (opts.validate !== false) {
    await validateSink(candidate, config.sinks.length);
  }
  config.sinks.push(candidate);
  return { sinkId: candidate.id, created: true, sink: candidate };
}

export async function preflightSinkCandidate(
  input: SinkCandidateInput,
): Promise<void> {
  const config = await loadRuntimeConfigGeneration();
  const candidate = buildSinkConfig(config, input);

  const existingById = findSinkIndexById(config, candidate.id);
  if (existingById >= 0) {
    const existing = config.sinks[existingById];
    if (sameSinkIdentity(existing, candidate)) {
      return;
    }
    fail(`sink id "${candidate.id}" is already configured`);
  }

  const equivalent = config.sinks.find((sink) => sameSinkTransport(sink, candidate));
  if (equivalent) {
    if (sameSinkIdentity(equivalent, candidate)) {
      return;
    }
    fail(
      `sink transport is already configured as "${equivalent.id}" with different teamId/userId; duplicate transport endpoints with different export identity are not supported yet`,
    );
  }

  await validateSink(candidate, config.sinks.length);
}

export function findSinkIndexById(config: Pick<JinConfig, "sinks">, sinkId: string): number {
  return config.sinks.findIndex((sink) => sink.id === sinkId);
}

function buildSinkConfig(
  config: Pick<JinConfig, "sinks">,
  input: SinkCandidateInput,
): SinkConfig {
  const id = input.id ?? autoSinkId(config, input.type);

  switch (input.type) {
    case "postgres": {
      if (!input.connectionString) {
        fail("postgres sinks require --connection-string");
      }

      return {
        id,
        type: "postgres",
        enabled: true,
        connectionString: input.connectionString,
        ...(input.teamId ? { teamId: input.teamId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
      };
    }
    case "webhook": {
      if (!input.url) {
        fail("webhook sinks require --url");
      }

      return {
        id,
        type: "webhook",
        enabled: true,
        url: input.url,
        ...(input.teamId ? { teamId: input.teamId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(typeof input.timeoutMs === "number"
          ? { timeoutMs: input.timeoutMs }
          : {}),
      };
    }
    case "s3": {
      if (!input.bucket) {
        fail("s3 sinks require --bucket");
      }
      if (!input.accessKeyId || !input.secretAccessKey) {
        fail("s3 sinks require both --access-key-id and --secret-access-key");
      }

      return {
        id,
        type: "s3",
        enabled: true,
        bucket: input.bucket,
        region: input.region ?? DEFAULT_S3_REGION,
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        prefix: input.prefix ?? DEFAULT_S3_PREFIX,
        ...(input.teamId ? { teamId: input.teamId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.endpoint ? { endpoint: input.endpoint } : {}),
        ...(typeof input.pathStyle === "boolean"
          ? { pathStyle: input.pathStyle }
          : {}),
      };
    }
  }

  return fail(`unsupported sink type: ${String(input.type)}`);
}

function autoSinkId(config: Pick<JinConfig, "sinks">, type: SinkType): string {
  const count = config.sinks.filter((sink) => sink.type === type).length;
  return `${type}-${count}`;
}

function sameSinkIdentity(left: SinkConfig, right: SinkConfig): boolean {
  return (
    sameSinkTransport(left, right) &&
    left.teamId === right.teamId &&
    left.userId === right.userId
  );
}

function sameSinkTransport(left: SinkConfig, right: SinkConfig): boolean {
  if (left.type !== right.type) {
    return false;
  }

  switch (left.type) {
    case "postgres":
      return right.type === "postgres" && left.connectionString === right.connectionString;
    case "webhook":
      return right.type === "webhook" && left.url === right.url;
    case "s3":
      return (
        right.type === "s3" &&
        left.bucket === right.bucket &&
        left.region === right.region &&
        left.endpoint === right.endpoint
      );
  }
}

async function validateSink(sinkConfig: SinkConfig, index: number): Promise<void> {
  const sink = createSink(sinkConfig, index);
  try {
    const health = await sink.healthCheck();
    if (!health.ok) {
      fail(health.error ? `sink health check failed: ${health.error}` : "sink health check failed");
    }
  } finally {
    await sink.close().catch(() => {});
  }
}

async function setSinkEnabled(
  sinkId: string,
  enabled: boolean,
  opts: { restart?: boolean } = {},
): Promise<void> {
  if (!sinkId) {
    fail("specify a sink id");
  }

  const { result } = await updateConfig(
    (config) => {
      const sinkIndex = findSinkIndexById(config, sinkId);
      if (sinkIndex === -1) {
        fail(`sink "${sinkId}" not found`);
      }

      const current = config.sinks[sinkIndex];
      const alreadyEnabled = current.enabled !== false;
      if (alreadyEnabled === enabled) {
        return { changed: false };
      }

      config.sinks[sinkIndex] = {
        ...current,
        enabled,
      };

      return { changed: true };
    },
    {
      shouldSave: (result) => result.changed,
    },
  );

  if (!result.changed) {
    console.log(
      enabled
        ? `  Sink ${sinkId} is already enabled.`
        : `  Sink ${sinkId} is already disabled.`,
    );
    return;
  }

  await persistSinkControlChange(sinkId, enabled, opts);
}

async function persistSinkControlChange(
  sinkId: string,
  enabled: boolean,
  opts: { restart?: boolean },
): Promise<void> {
  await finalizeConfigChange({
    restart: opts.restart,
    changeSummary: `Sink ${sinkId} ${enabled ? "enabled" : "disabled"}`,
  });
}

function createSinkCommandLogger(): PipelineLogger {
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

function fail(message: string): never {
  console.error(`  Error: ${message}`);
  process.exit(1);
}
