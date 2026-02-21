import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SinkConfig } from "./sinks/types";

export interface JinConfig {
  adapters: Record<string, AdapterConfig>;
  sinks: SinkConfig[];
  team?: TeamConfig;
  push?: PushConfig; // legacy, maps to webhook sink
  store: StoreConfig;
  watch: WatchConfig;
}

export interface AdapterConfig {
  enabled: boolean;
  dataDir?: string; // override default path
}

export interface TeamConfig {
  teamId: string;
  developerId: string;
  syncMode: "realtime" | "periodic" | "manual";
  syncIntervalMs?: number; // for periodic mode
}

export interface PushConfig {
  endpoint: string;
  headers?: Record<string, string>;
  batchSize: number;
}

export interface StoreConfig {
  dbPath: string;
  rawDir: string; // where raw source files are copied
}

export interface WatchConfig {
  debounceMs: number;
  pollIntervalMs: number;
}

const CONFIG_DIR = join(homedir(), ".config", "jin");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULT_DB_PATH = join(CONFIG_DIR, "store.db");
const DEFAULT_RAW_DIR = join(CONFIG_DIR, "raw");

export function configDir(): string {
  return CONFIG_DIR;
}

export function configPath(): string {
  return CONFIG_PATH;
}

export function defaultConfig(): JinConfig {
  return {
    adapters: {
      "claude-code": { enabled: true },
      "cursor": { enabled: true },
      "codex": { enabled: true },
      "warp": { enabled: true },
      "gemini-cli": { enabled: true },
      "kiro": { enabled: true },
      "amp": { enabled: true },
      "opencode": { enabled: true },
      "pi": { enabled: true },
      "piagent": { enabled: true },
    },
    sinks: [],
    team: undefined,
    push: undefined,
    store: {
      dbPath: DEFAULT_DB_PATH,
      rawDir: DEFAULT_RAW_DIR,
    },
    watch: {
      debounceMs: 200,
      pollIntervalMs: 30_000,
    },
  };
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export async function loadConfig(): Promise<JinConfig> {
  ensureConfigDir();
  if (existsSync(CONFIG_PATH)) {
    const raw = await Bun.file(CONFIG_PATH).text();
    const saved = JSON.parse(raw) as Partial<JinConfig>;
    return { ...defaultConfig(), ...saved };
  }
  return defaultConfig();
}

export async function saveConfig(config: JinConfig): Promise<void> {
  ensureConfigDir();
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2));
}
