import {
  DEFAULT_S3_PREFIX,
  DEFAULT_S3_REGION,
  loadConfig,
  saveConfig,
  type JinConfig,
  type SinkConfig,
  type SinkType,
} from "../config";
import { createSink } from "../sinks/registry";
import { applySinkPauseControl, persistConfigChange } from "./config-control";

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
  yes?: boolean;
}

export interface SinkCandidateInput extends SinkCommandOptions {
  type: SinkType;
}

export async function sinkAddCommand(
  type: SinkType,
  opts: SinkCommandOptions,
): Promise<void> {
  const config = await loadConfig();
  const result = await ensureSinkConfigured(config, { ...opts, type });

  if (!result.created) {
    console.log(`  Sink already configured: ${result.sinkId}`);
    return;
  }

  await persistConfigChange(config, {
    yes: opts.yes,
    changeSummary: `Added sink ${result.sinkId}`,
  });
  console.log(
    `  Add a route with: jin route add --remote="*" --sink=${result.sinkId}`,
  );
}

export async function sinkRemoveCommand(
  sinkId: string,
  opts: { yes?: boolean } = {},
): Promise<void> {
  if (!sinkId) {
    fail("specify a sink id");
  }

  const config = await loadConfig();
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

  await persistConfigChange(config, {
    yes: opts.yes,
    changeSummary:
      affectedRoutes > 0
        ? `Removed sink ${sinkId} and updated ${affectedRoutes} route${affectedRoutes === 1 ? "" : "s"}`
        : `Removed sink ${sinkId}`,
  });
}

export async function sinkDisableCommand(sinkId: string): Promise<void> {
  await setSinkEnabled(sinkId, false);
}

export async function sinkEnableCommand(sinkId: string): Promise<void> {
  await setSinkEnabled(sinkId, true);
}

export async function ensureSinkConfigured(
  config: JinConfig,
  input: SinkCandidateInput,
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

  const equivalent = config.sinks.find((sink) => sameSinkIdentity(sink, candidate));
  if (equivalent) {
    return { sinkId: equivalent.id, created: false, sink: equivalent };
  }

  await validateSink(candidate, config.sinks.length);
  config.sinks.push(candidate);
  return { sinkId: candidate.id, created: true, sink: candidate };
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
}

function autoSinkId(config: Pick<JinConfig, "sinks">, type: SinkType): string {
  const count = config.sinks.filter((sink) => sink.type === type).length;
  return `${type}-${count}`;
}

function sameSinkIdentity(left: SinkConfig, right: SinkConfig): boolean {
  if (left.type !== right.type) {
    return false;
  }

  switch (left.type) {
    case "postgres":
      return left.connectionString === right.connectionString;
    case "webhook":
      return left.url === right.url;
    case "s3":
      return (
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

async function setSinkEnabled(sinkId: string, enabled: boolean): Promise<void> {
  if (!sinkId) {
    fail("specify a sink id");
  }

  const config = await loadConfig();
  const sinkIndex = findSinkIndexById(config, sinkId);
  if (sinkIndex === -1) {
    fail(`sink "${sinkId}" not found`);
  }

  const current = config.sinks[sinkIndex];
  const alreadyEnabled = current.enabled !== false;
  if (alreadyEnabled === enabled) {
    console.log(
      enabled
        ? `  Sink ${sinkId} is already enabled.`
        : `  Sink ${sinkId} is already disabled.`,
    );
    return;
  }

  config.sinks[sinkIndex] = {
    ...current,
    enabled,
  };

  await persistSinkControlChange(config, sinkId, enabled);
}

async function persistSinkControlChange(
  config: JinConfig,
  sinkId: string,
  enabled: boolean,
): Promise<void> {
  await persistConfigOnly(config);

  const runtimeUpdated = applySinkPauseControl(sinkId, !enabled);
  if (enabled) {
    console.log(`  Sink ${sinkId} enabled.`);
  } else {
    console.log(`  Sink ${sinkId} disabled.`);
  }

  if (runtimeUpdated) {
    console.log("  Updated the active runtime without a full restart.");
  } else {
    console.log("  Change saved; it will apply on the next start.");
  }
}

async function persistConfigOnly(config: JinConfig): Promise<void> {
  await saveConfig(config);
}

function fail(message: string): never {
  console.error(`  Error: ${message}`);
  process.exit(1);
}
