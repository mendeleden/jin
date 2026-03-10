import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SinkConfig } from "./sinks/types";

export interface RouteMatch {
  project?: string;   // matches project name (case-insensitive)
  remote?: string;    // glob against git remote URL
  directory?: string; // glob against project directory path
}

export interface RouteConfig {
  match: RouteMatch;
  sinks: string[];    // sink IDs to route to
}

export interface JinConfig {
  adapters: Record<string, AdapterConfig>;
  sinks: SinkConfig[];
  routes?: RouteConfig[];       // per-project sink routing rules
  defaultSinks?: string[];      // sink IDs for sessions matching no route (empty = local only)
  routeUnmatchedToAll?: boolean; // if true, unmatched sessions push to ALL sinks (company opt-in)
  team?: TeamConfig;
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

export interface StoreConfig {
  dbPath: string;
  rawDir: string; // where raw source files are copied
}

export interface WatchConfig {
  debounceMs: number;
  pollIntervalMs: number;
}

export function configDir(): string {
  return process.env.JIN_CONFIG_DIR || join(homedir(), ".config", "jin");
}

export function configPath(): string {
  return join(configDir(), "config.json");
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
    store: {
      dbPath: join(configDir(), "store.db"),
      rawDir: join(configDir(), "raw"),
    },
    watch: {
      debounceMs: 5_000,
      pollIntervalMs: 30_000,
    },
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
  if (existsSync(cfgPath)) {
    const raw = await Bun.file(cfgPath).text();
    const saved = JSON.parse(raw) as Partial<JinConfig>;
    return { ...defaultConfig(), ...saved };
  }
  return defaultConfig();
}

export async function saveConfig(config: JinConfig): Promise<void> {
  ensureConfigDir();
  await Bun.write(configPath(), JSON.stringify(config, null, 2));
}
