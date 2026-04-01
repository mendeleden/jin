import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  DEFAULT_S3_PREFIX,
  DEFAULT_S3_REGION,
  DEFAULT_SCAN_INTERVAL_MS,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  SINK_TYPES,
  type AdapterConfig as ContractAdapterConfig,
  type JinConfig as ContractJinConfig,
  type PostgresSinkConfig as ContractPostgresSinkConfig,
  type RouteConfig as ContractRouteConfig,
  type RouteMatch as ContractRouteMatch,
  type S3SinkConfig as ContractS3SinkConfig,
  type SinkConfig as ContractSinkConfig,
  type SinkConfigBase as ContractSinkConfigBase,
  type SinkType,
  type WatchConfig as ContractWatchConfig,
  type WebhookSinkConfig as ContractWebhookSinkConfig,
} from "./contracts/config";

export {
  DEFAULT_S3_PREFIX,
  DEFAULT_S3_REGION,
  DEFAULT_SCAN_INTERVAL_MS,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  SINK_TYPES,
} from "./contracts/config";

export type {
  AdapterConfig as V2AdapterConfig,
  JinConfig as V2JinConfig,
  PostgresSinkConfig as V2PostgresSinkConfig,
  RouteConfig as V2RouteConfig,
  RouteMatch as V2RouteMatch,
  S3SinkConfig as V2S3SinkConfig,
  SinkConfig as V2SinkConfig,
  SinkConfigBase as V2SinkConfigBase,
  WatchConfig as V2WatchConfig,
  WebhookSinkConfig as V2WebhookSinkConfig,
} from "./contracts/config";

export type AdapterConfig = ContractAdapterConfig;

export interface TeamConfig {
  teamId: string;
  developerId?: string;
  syncMode?: "realtime" | "periodic" | "manual";
  syncIntervalMs?: number;
}

export interface StoreConfig {
  dbPath: string;
  rawDir: string;
}

export type RouteMatch = ContractRouteMatch & {
  project?: string;
  directory?: string;
};

export interface RouteConfig extends Omit<ContractRouteConfig, "match"> {
  match: RouteMatch;
}

export type WatchConfig = ContractWatchConfig & {
  debounceMs?: number;
};

export interface SinkConfigBase extends Omit<ContractSinkConfigBase, "enabled"> {
  enabled?: boolean;
  name?: string;
  teamId?: string;
}

export interface PostgresSinkConfig extends SinkConfigBase {
  type: "postgres";
  connectionString: string;
}

export interface S3SinkConfig extends SinkConfigBase {
  type: "s3";
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
  pathStyle?: boolean;
}

export interface WebhookSinkConfig extends SinkConfigBase {
  type: "webhook";
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type SinkConfig =
  | PostgresSinkConfig
  | S3SinkConfig
  | WebhookSinkConfig;

export interface JinConfig extends Omit<ContractJinConfig, "sinks" | "routes" | "watch"> {
  sinks: SinkConfig[];
  routes: RouteConfig[];
  watch: WatchConfig;
  team?: TeamConfig;
  store?: StoreConfig;
  defaultSinks?: string[];
  routeUnmatchedToAll?: boolean;
}

const DEFAULT_ADAPTER_IDS = [
  "claude-code",
  "cursor",
  "codex",
  "warp",
  "gemini-cli",
  "kiro",
  "amp",
  "opencode",
  "pi",
  "piagent",
] as const;

export function configDir(): string {
  if (process.env.JIN_CONFIG_DIR) return process.env.JIN_CONFIG_DIR;
  if (process.platform === "win32") {
    return join(
      process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
      "jin",
    );
  }
  return join(homedir(), ".config", "jin");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function defaultConfig(): JinConfig {
  return {
    adapters: defaultAdapters(),
    sinks: [],
    routes: [],
    watch: {
      pollIntervalMs: DEFAULT_SCAN_INTERVAL_MS,
    },
  };
}

export function normalizeConfig(raw: unknown): JinConfig {
  const base = defaultConfig();
  if (!isRecord(raw)) {
    return base;
  }

  return {
    adapters: normalizeAdapters(raw.adapters, base.adapters),
    sinks: normalizeSinks(raw.sinks),
    routes: normalizeRoutes(raw.routes),
    watch: normalizeWatchConfig(raw.watch, base.watch),
  };
}

export function ensureConfigDir(): void {
  const dir = configDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export async function loadConfig(): Promise<JinConfig> {
  ensureConfigDir();
  const cfgPath = configPath();
  if (!existsSync(cfgPath)) {
    return defaultConfig();
  }

  const raw = await Bun.file(cfgPath).text();
  return normalizeConfig(JSON.parse(raw));
}

export async function saveConfig(config: JinConfig): Promise<void> {
  ensureConfigDir();
  await Bun.write(configPath(), JSON.stringify(normalizeConfig(config), null, 2));
}

function defaultAdapters(): Record<string, AdapterConfig> {
  return Object.fromEntries(
    DEFAULT_ADAPTER_IDS.map((adapterId) => [adapterId, { enabled: true }]),
  );
}

function normalizeAdapters(
  raw: unknown,
  fallback: Record<string, AdapterConfig>,
): Record<string, AdapterConfig> {
  if (raw === undefined) {
    return cloneAdapters(fallback);
  }
  if (!isRecord(raw)) {
    return cloneAdapters(fallback);
  }

  return Object.fromEntries(
    Object.entries(raw).map(([adapterId, value]) => [
      adapterId,
      normalizeAdapterConfig(value),
    ]),
  );
}

function cloneAdapters(
  adapters: Record<string, AdapterConfig>,
): Record<string, AdapterConfig> {
  return Object.fromEntries(
    Object.entries(adapters).map(([adapterId, config]) => [
      adapterId,
      { ...config },
    ]),
  );
}

function normalizeAdapterConfig(raw: unknown): AdapterConfig {
  if (!isRecord(raw)) {
    return { enabled: true };
  }

  const dataDir = asString(raw.dataDir);
  return {
    enabled: asBoolean(raw.enabled) ?? true,
    ...(dataDir ? { dataDir } : {}),
  };
}

function normalizeSinks(raw: unknown): SinkConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((value) => {
    const sink = normalizeSinkConfig(value);
    return sink ? [sink] : [];
  });
}

function normalizeSinkConfig(raw: unknown): SinkConfig | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = asNonEmptyString(raw.id);
  const type = asSinkType(raw.type);
  if (!id || !type) {
    return null;
  }

  const base: SinkConfigBase = {
    id,
    type,
    enabled: asBoolean(raw.enabled) ?? true,
  };

  switch (type) {
    case "postgres": {
      const connectionString = asNonEmptyString(raw.connectionString);
      if (!connectionString) {
        return null;
      }

      const sink: PostgresSinkConfig = {
        ...base,
        type,
        connectionString,
      };
      return sink;
    }

    case "s3": {
      const bucket = asNonEmptyString(raw.bucket);
      const accessKeyId = asNonEmptyString(raw.accessKeyId);
      const secretAccessKey = asNonEmptyString(raw.secretAccessKey);
      if (!bucket || !accessKeyId || !secretAccessKey) {
        return null;
      }

      const sink: S3SinkConfig = {
        ...base,
        type,
        bucket,
        region: asNonEmptyString(raw.region) ?? DEFAULT_S3_REGION,
        accessKeyId,
        secretAccessKey,
        prefix: asNonEmptyString(raw.prefix) ?? DEFAULT_S3_PREFIX,
      };

      const endpoint = asNonEmptyString(raw.endpoint);
      if (endpoint) {
        sink.endpoint = endpoint;
      }

      const pathStyle = asBoolean(raw.pathStyle);
      if (pathStyle !== undefined) {
        sink.pathStyle = pathStyle;
      }

      return sink;
    }

    case "webhook": {
      const url = asNonEmptyString(raw.url);
      if (!url) {
        return null;
      }

      const sink: WebhookSinkConfig = {
        ...base,
        type,
        url,
        timeoutMs:
          asPositiveInteger(raw.timeoutMs) ?? DEFAULT_WEBHOOK_TIMEOUT_MS,
      };

      const headers = normalizeStringRecord(raw.headers);
      if (headers) {
        sink.headers = headers;
      }

      return sink;
    }
  }
}

function normalizeRoutes(raw: unknown): RouteConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((value) => {
    const route = normalizeRouteConfig(value);
    return route ? [route] : [];
  });
}

function normalizeRouteConfig(raw: unknown): RouteConfig | null {
  if (!isRecord(raw)) {
    return null;
  }

  return {
    match: normalizeRouteMatch(raw.match),
    sinks: uniqueStrings(raw.sinks),
  };
}

function normalizeRouteMatch(raw: unknown): RouteMatch {
  if (!isRecord(raw)) {
    return {};
  }

  const match: RouteMatch = {};

  const remote = asString(raw.remote);
  if (remote !== undefined) {
    match.remote = remote;
  }

  const adapter = asString(raw.adapter);
  if (adapter !== undefined) {
    match.adapter = adapter;
  }

  const branch = asString(raw.branch);
  if (branch !== undefined) {
    match.branch = branch;
  }

  const name = asString(raw.name);
  if (name !== undefined) {
    match.name = name;
  }

  return match;
}

function normalizeWatchConfig(raw: unknown, fallback: WatchConfig): WatchConfig {
  if (!isRecord(raw)) {
    return { ...fallback };
  }

  return {
    pollIntervalMs:
      asPositiveInteger(raw.pollIntervalMs) ?? fallback.pollIntervalMs,
  };
}

function normalizeStringRecord(
  raw: unknown,
): Record<string, string> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const entries = Object.entries(raw).flatMap(([key, value]) => {
    if (typeof value !== "string") {
      return [];
    }
    return [[key, value]] as const;
  });

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function uniqueStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const values = raw.filter((value): value is string => typeof value === "string");
  return [...new Set(values)];
}

function asSinkType(value: unknown): SinkType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return SINK_TYPES.find((sinkType) => sinkType === value);
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.floor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
