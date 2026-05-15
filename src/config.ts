import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { createHash } from "node:crypto";
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

const PROTECTED_SOURCE_ADAPTER_IDS = [
  "cursor",
  "kiro",
  "opencode",
  "warp",
] as const;

const PROTECTED_SOURCE_ADAPTER_ID_SET = new Set<string>(
  PROTECTED_SOURCE_ADAPTER_IDS,
);
const CONFIG_LOCK_FILENAME = "config.lock";
const CONFIG_WRITE_TIMEOUT_MS = 5_000;
const CONFIG_LOCK_STALE_MS = 30_000;
const CONFIG_LOCK_POLL_MS = 50;

export interface AdapterConfig extends ContractAdapterConfig {
  allowProtectedSource?: boolean;
}

export interface TeamConfig {
  teamId: string;
  userId?: string;
  syncMode?: "realtime" | "periodic" | "manual";
  syncIntervalMs?: number;
}

export interface StoreConfig {
  dbPath: string;
  rawDir: string;
}

export type RouteMatch = ContractRouteMatch;

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
  userId?: string;
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
}

export interface RuntimeConfigSnapshot {
  config: JinConfig;
  generationToken: string;
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

export function isProtectedSourceAdapter(adapterId: string): boolean {
  return PROTECTED_SOURCE_ADAPTER_ID_SET.has(adapterId);
}

export function defaultAdapterConfig(adapterId: string): AdapterConfig {
  if (isProtectedSourceAdapter(adapterId)) {
    return {
      enabled: true,
      allowProtectedSource: false,
    };
  }

  return {
    enabled: true,
  };
}

export function resolveAdapterConfig(
  adapters: Record<string, AdapterConfig> | undefined,
  adapterId: string,
): AdapterConfig {
  return {
    ...defaultAdapterConfig(adapterId),
    ...(adapters?.[adapterId] ?? {}),
  };
}

export function isProtectedSourceOptedIn(config: AdapterConfig | undefined): boolean {
  if (!config) {
    return false;
  }

  return config.allowProtectedSource === true || Boolean(config.dataDir);
}

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

export function configLockPath(): string {
  return join(configDir(), CONFIG_LOCK_FILENAME);
}

export function discoveryCachePath(): string {
  return join(configDir(), "discovery-cache.db");
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

export async function loadRuntimeConfigGeneration(): Promise<JinConfig> {
  return (await loadRuntimeConfigSnapshot()).config;
}

export async function loadRuntimeConfigSnapshot(): Promise<RuntimeConfigSnapshot> {
  ensureConfigDir();
  const cfgPath = configPath();
  if (!existsSync(cfgPath)) {
    const config = defaultConfig();
    return {
      config,
      generationToken: hashConfigGeneration(JSON.stringify(config)),
    };
  }

  const rawText = await Bun.file(cfgPath).text();
  const raw = JSON.parse(rawText);
  assertValidRuntimeConfigGeneration(raw);
  return {
    config: normalizeConfig(raw),
    generationToken: hashConfigGeneration(rawText),
  };
}

export async function loadStartupConfig(): Promise<JinConfig> {
  return withConfigLock(async () => {
    ensureConfigDir();
    const cfgPath = configPath();
    if (!existsSync(cfgPath)) {
      const config = defaultConfig();
      await writeConfigFile(config, { normalize: false });
      return config;
    }

    const rawText = await Bun.file(cfgPath).text();
    const raw = JSON.parse(rawText);
    const materialized = materializeConfigShape(raw);
    assertValidRuntimeConfigGeneration(materialized.value);
    if (materialized.changed) {
      await writeConfigFile(materialized.value, { normalize: false });
    }

    return normalizeConfig(materialized.value);
  });
}

export async function saveConfig(config: JinConfig): Promise<void> {
  await withConfigLock(async () => {
    await writeConfigFile(config);
  });
}

export async function updateConfig<T>(
  mutate: (config: JinConfig) => Promise<T> | T,
  opts: {
    shouldSave?: (result: T, config: JinConfig) => boolean;
  } = {},
): Promise<{ config: JinConfig; result: T; saved: boolean }> {
  return withConfigLock(async () => {
    const config = await loadRuntimeConfigGeneration();
    const result = await mutate(config);
    const shouldSave = opts.shouldSave?.(result, config) ?? true;
    if (shouldSave) {
      await writeConfigFile(config);
    }

    return {
      config: normalizeConfig(config),
      result,
      saved: shouldSave,
    };
  });
}

async function writeConfigFile(
  config: unknown,
  opts: { normalize?: boolean } = {},
): Promise<void> {
  ensureConfigDir();
  const cfgPath = configPath();
  const tmpPath = `${cfgPath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
  const value = opts.normalize === false ? config : normalizeConfig(config);
  const serialized = JSON.stringify(value, null, 2);

  try {
    await Bun.write(tmpPath, serialized);
    renameSync(tmpPath, cfgPath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {}
    throw error;
  }
}

async function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  ensureConfigDir();
  const release = await acquireConfigLock();
  try {
    return await fn();
  } finally {
    release();
  }
}

async function acquireConfigLock(
  timeoutMs = CONFIG_WRITE_TIMEOUT_MS,
): Promise<() => void> {
  const lockPath = configLockPath();
  const deadline = Date.now() + Math.max(timeoutMs, CONFIG_LOCK_POLL_MS);
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

  while (true) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync(
          fd,
          JSON.stringify({
            pid: process.pid,
            acquiredAt: new Date().toISOString(),
            token,
          }),
        );
      } finally {
        closeSync(fd);
      }

      return () => releaseConfigLock(lockPath, token);
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error;
      }

      clearStaleConfigLock(lockPath);
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for config lock at ${lockPath}`);
      }

      await Bun.sleep(CONFIG_LOCK_POLL_MS);
    }
  }
}

function releaseConfigLock(lockPath: string, token: string): void {
  try {
    const raw = readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as { token?: unknown };
    if (parsed.token !== token) {
      return;
    }
    unlinkSync(lockPath);
  } catch {}
}

function clearStaleConfigLock(lockPath: string): void {
  let pid: number | undefined;
  let ageMs = Number.POSITIVE_INFINITY;

  try {
    const raw = readFileSync(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as { pid?: unknown; acquiredAt?: unknown };
    if (typeof parsed.pid === "number" && Number.isFinite(parsed.pid)) {
      pid = parsed.pid;
    }
    if (typeof parsed.acquiredAt === "string") {
      const acquiredMs = Date.parse(parsed.acquiredAt);
      if (Number.isFinite(acquiredMs)) {
        ageMs = Date.now() - acquiredMs;
      }
    }
  } catch {}

  if (!Number.isFinite(ageMs)) {
    try {
      ageMs = Date.now() - statSync(lockPath).mtimeMs;
    } catch {
      ageMs = Number.POSITIVE_INFINITY;
    }
  }

  if (pid !== undefined && isProcessAlive(pid)) {
    return;
  }
  if (ageMs < CONFIG_LOCK_STALE_MS) {
    return;
  }

  try {
    unlinkSync(lockPath);
  } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionError(error);
  }
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

function isPermissionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EPERM"
  );
}

function hashConfigGeneration(rawText: string): string {
  return createHash("sha256").update(rawText).digest("hex");
}

function defaultAdapters(): Record<string, AdapterConfig> {
  return Object.fromEntries(
    DEFAULT_ADAPTER_IDS.map((adapterId) => [adapterId, defaultAdapterConfig(adapterId)]),
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

  const adapterIds = new Set<string>([
    ...Object.keys(fallback),
    ...Object.keys(raw),
  ]);

  return Object.fromEntries(
    Array.from(adapterIds).map((adapterId) => [
      adapterId,
      normalizeAdapterConfig(adapterId, raw[adapterId]),
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

function normalizeAdapterConfig(
  adapterId: string,
  raw: unknown,
): AdapterConfig {
  const fallback = defaultAdapterConfig(adapterId);

  if (!isRecord(raw)) {
    return fallback;
  }

  const dataDir = asString(raw.dataDir);
  const allowProtectedSource = asBoolean(raw.allowProtectedSource);
  return {
    enabled: asBoolean(raw.enabled) ?? fallback.enabled,
    ...(fallback.allowProtectedSource !== undefined ||
    allowProtectedSource !== undefined
      ? {
          allowProtectedSource:
            allowProtectedSource ?? fallback.allowProtectedSource,
        }
      : {}),
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
    ...(asNonEmptyString(raw.teamId)
      ? { teamId: asNonEmptyString(raw.teamId) }
      : {}),
    ...(resolveSinkUserId(raw)
      ? { userId: resolveSinkUserId(raw) }
      : {}),
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

function assertValidRuntimeConfigGeneration(raw: unknown): void {
  if (!isRecord(raw)) {
    throw new Error("config root must be an object");
  }

  assertValidAdaptersSection(raw.adapters);
  assertValidSinksSection(raw.sinks);
  assertValidRoutesSection(raw.routes);
  assertValidWatchSection(raw.watch);
}

function assertValidAdaptersSection(raw: unknown): void {
  if (raw === undefined) {
    return;
  }
  if (!isRecord(raw)) {
    throw new Error("config.adapters must be an object");
  }

  for (const [adapterId, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      throw new Error(`config.adapters.${adapterId} must be an object`);
    }
    if ("enabled" in value && typeof value.enabled !== "boolean") {
      throw new Error(`config.adapters.${adapterId}.enabled must be a boolean`);
    }
    if (
      "allowProtectedSource" in value &&
      typeof value.allowProtectedSource !== "boolean"
    ) {
      throw new Error(
        `config.adapters.${adapterId}.allowProtectedSource must be a boolean`,
      );
    }
    if ("dataDir" in value && asNonEmptyString(value.dataDir) === undefined) {
      throw new Error(`config.adapters.${adapterId}.dataDir must be a non-empty string`);
    }
  }
}

function assertValidSinksSection(raw: unknown): void {
  if (raw === undefined) {
    return;
  }
  if (!Array.isArray(raw)) {
    throw new Error("config.sinks must be an array");
  }

  raw.forEach((value, index) => assertValidSinkConfig(value, index));
}

function assertValidSinkConfig(raw: unknown, index: number): void {
  const path = `config.sinks[${index}]`;
  if (!isRecord(raw)) {
    throw new Error(`${path} must be an object`);
  }

  const id = asNonEmptyString(raw.id);
  if (!id) {
    throw new Error(`${path}.id must be a non-empty string`);
  }

  const type = asSinkType(raw.type);
  if (!type) {
    throw new Error(`${path}.type must be one of ${SINK_TYPES.join(", ")}`);
  }

  assertOptionalBoolean(raw.enabled, `${path}.enabled`);
  assertOptionalNonEmptyString(raw.teamId, `${path}.teamId`);
  assertOptionalNonEmptyString(raw.userId, `${path}.userId`);

  switch (type) {
    case "postgres":
      assertRequiredNonEmptyString(raw.connectionString, `${path}.connectionString`);
      return;
    case "s3":
      assertRequiredNonEmptyString(raw.bucket, `${path}.bucket`);
      assertRequiredNonEmptyString(raw.accessKeyId, `${path}.accessKeyId`);
      assertRequiredNonEmptyString(raw.secretAccessKey, `${path}.secretAccessKey`);
      assertOptionalNonEmptyString(raw.region, `${path}.region`);
      assertOptionalNonEmptyString(raw.endpoint, `${path}.endpoint`);
      assertOptionalNonEmptyString(raw.prefix, `${path}.prefix`);
      assertOptionalBoolean(raw.pathStyle, `${path}.pathStyle`);
      return;
    case "webhook":
      assertRequiredNonEmptyString(raw.url, `${path}.url`);
      assertOptionalPositiveInteger(raw.timeoutMs, `${path}.timeoutMs`);
      assertOptionalStringRecord(raw.headers, `${path}.headers`);
      return;
  }
}

function assertValidRoutesSection(raw: unknown): void {
  if (raw === undefined) {
    return;
  }
  if (!Array.isArray(raw)) {
    throw new Error("config.routes must be an array");
  }

  raw.forEach((value, index) => {
    const path = `config.routes[${index}]`;
    if (!isRecord(value)) {
      throw new Error(`${path} must be an object`);
    }
    if (!isRecord(value.match)) {
      throw new Error(`${path}.match must be an object`);
    }
    for (const key of ["remote", "adapter", "branch", "name"] as const) {
      assertOptionalString(value.match[key], `${path}.match.${key}`);
    }
    if (!Array.isArray(value.sinks)) {
      throw new Error(`${path}.sinks must be an array`);
    }
    value.sinks.forEach((sinkId, sinkIndex) => {
      if (asNonEmptyString(sinkId) === undefined) {
        throw new Error(`${path}.sinks[${sinkIndex}] must be a non-empty string`);
      }
    });
  });
}

function assertValidWatchSection(raw: unknown): void {
  if (raw === undefined) {
    return;
  }
  if (!isRecord(raw)) {
    throw new Error("config.watch must be an object");
  }
  assertOptionalPositiveInteger(raw.pollIntervalMs, "config.watch.pollIntervalMs");
  assertOptionalPositiveInteger(raw.debounceMs, "config.watch.debounceMs");
}

function assertRequiredNonEmptyString(value: unknown, path: string): void {
  if (asNonEmptyString(value) === undefined) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertOptionalNonEmptyString(value: unknown, path: string): void {
  if (value !== undefined) {
    assertRequiredNonEmptyString(value, path);
  }
}

function assertOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
}

function assertOptionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }
}

function assertOptionalPositiveInteger(value: unknown, path: string): void {
  if (value !== undefined && asPositiveInteger(value) === undefined) {
    throw new Error(`${path} must be a positive integer`);
  }
}

function assertOptionalStringRecord(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") {
      throw new Error(`${path}.${key} must be a string`);
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

  const debounceMs = asPositiveInteger(raw.debounceMs);
  return {
    pollIntervalMs:
      asPositiveInteger(raw.pollIntervalMs) ?? fallback.pollIntervalMs,
    ...(debounceMs !== undefined ? { debounceMs } : {}),
  };
}

function resolveSinkUserId(raw: Record<string, unknown>): string | undefined {
  return asNonEmptyString(raw.userId);
}

function materializeConfigShape(raw: unknown): {
  value: unknown;
  changed: boolean;
} {
  const base = defaultConfig();
  if (!isRecord(raw)) {
    return { value: raw, changed: false };
  }

  const next: Record<string, unknown> = structuredClone(raw);
  let changed = false;

  if (next.adapters === undefined) {
    next.adapters = structuredClone(base.adapters);
    changed = true;
  } else if (isRecord(next.adapters)) {
    const materializedAdapters = materializeAdaptersSection(
      next.adapters,
      base.adapters,
    );
    if (materializedAdapters.changed) {
      next.adapters = materializedAdapters.value;
      changed = true;
    }
  }

  if (next.sinks === undefined) {
    next.sinks = [];
    changed = true;
  }

  if (next.routes === undefined) {
    next.routes = [];
    changed = true;
  }

  if (next.watch === undefined) {
    next.watch = { ...base.watch };
    changed = true;
  } else if (isRecord(next.watch)) {
    const materializedWatch = materializeWatchSection(next.watch, base.watch);
    if (materializedWatch.changed) {
      next.watch = materializedWatch.value;
      changed = true;
    }
  }

  return { value: next, changed };
}

function materializeAdaptersSection(
  raw: Record<string, unknown>,
  fallback: Record<string, AdapterConfig>,
): {
  value: Record<string, unknown>;
  changed: boolean;
} {
  const next = structuredClone(raw);
  let changed = false;

  for (const [adapterId, defaultAdapter] of Object.entries(fallback)) {
    const existing = next[adapterId];
    if (existing === undefined) {
      next[adapterId] = { ...defaultAdapter };
      changed = true;
      continue;
    }

    if (!isRecord(existing)) {
      continue;
    }

    const merged = { ...defaultAdapter, ...existing };
    if (JSON.stringify(existing) !== JSON.stringify(merged)) {
      next[adapterId] = merged;
      changed = true;
    }
  }

  return { value: next, changed };
}

function materializeWatchSection(
  raw: Record<string, unknown>,
  fallback: WatchConfig,
): {
  value: Record<string, unknown>;
  changed: boolean;
} {
  const next = structuredClone(raw);
  let changed = false;

  if (next.pollIntervalMs === undefined) {
    next.pollIntervalMs = fallback.pollIntervalMs;
    changed = true;
  }

  return { value: next, changed };
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
