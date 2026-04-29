import type { AdapterConfig } from "../config";
import {
  isProtectedSourceAdapter,
  isProtectedSourceOptedIn,
  resolveAdapterConfig,
} from "../config";
import type { Adapter } from "./types";
import { ClaudeCodeAdapter } from "./claude-code";
import { CursorAdapter } from "./cursor";
import { CodexAdapter } from "./codex";
import { WarpAdapter } from "./warp";
import { GeminiCliAdapter } from "./gemini-cli";
import { KiroAdapter } from "./kiro";
import { AmpAdapter } from "./amp";
import { OpenCodeAdapter } from "./opencode";
import { PiAdapter } from "./pi";
import { PiAgentAdapter } from "./piagent";

type StartupPolicyMode = "mixed-default" | "opt-in-only";

type StartupPolicy = {
  adapterId: string;
  adapterName: string;
  mode: StartupPolicyMode;
  summary: (platform: NodeJS.Platform) => string;
};

const STARTUP_POLICIES: Record<string, StartupPolicy> = {
  cursor: {
    adapterId: "cursor",
    adapterName: "Cursor",
    mode: "mixed-default",
    summary: (platform) =>
      platform === "darwin"
        ? "Cursor startup skips `~/Library/Application Support/Cursor/**` by default; only `.cursor/chats` is auto-detected until you opt in."
        : platform === "win32"
          ? "Cursor startup skips `%APPDATA%\\\\Cursor\\\\User\\\\globalStorage\\\\state.vscdb` by default; only `.cursor/chats` is auto-detected until you opt in."
          : "Cursor startup skips `~/.config/Cursor/User/globalStorage/state.vscdb` by default; only `.cursor/chats` is auto-detected until you opt in.",
  },
  kiro: {
    adapterId: "kiro",
    adapterName: "Kiro",
    mode: "opt-in-only",
    summary: (platform) =>
      platform === "darwin"
        ? "Kiro startup does not probe app-private SQLite stores under `~/Library/Application Support/kiro-cli` or home-private defaults unless you opt in."
        : platform === "win32"
          ? "Kiro startup does not probe home-private SQLite stores such as `~/.kiro` or `~/.amazonq` unless you opt in."
          : "Kiro startup does not probe XDG/home-private SQLite stores such as `~/.kiro`, `~/.amazonq`, or `$XDG_*` app data roots unless you opt in.",
  },
  opencode: {
    adapterId: "opencode",
    adapterName: "OpenCode",
    mode: "opt-in-only",
    summary: (platform) =>
      platform === "darwin"
        ? "OpenCode startup does not probe `~/Library/Application Support/opencode/storage` unless you opt in."
        : platform === "win32"
          ? "OpenCode startup does not probe app-private storage roots unless you opt in or provide `dataDir`."
          : "OpenCode startup does not probe XDG app-data storage under `~/.local/share/opencode/storage` unless you opt in.",
  },
  warp: {
    adapterId: "warp",
    adapterName: "Warp Terminal",
    mode: "opt-in-only",
    summary: (platform) =>
      platform === "darwin"
        ? "Warp startup does not probe `~/Library/Group Containers/**/Application Support/**/warp.sqlite` unless you opt in."
        : platform === "win32"
          ? "Warp startup does not probe `%LOCALAPPDATA%\\\\warp\\\\Warp\\\\data\\\\warp.sqlite` unless you opt in."
          : "Warp startup does not probe XDG state storage such as `~/.local/state/warp-terminal/warp.sqlite` unless you opt in.",
  },
};

type AdapterFactory = {
  id: string;
  create: (config: AdapterConfig) => Adapter;
};

const ADAPTER_FACTORIES: AdapterFactory[] = [
  {
    id: "claude-code",
    create: (config) =>
      new ClaudeCodeAdapter(config.dataDir ? { projectsDir: config.dataDir } : {}),
  },
  {
    id: "cursor",
    create: (config) => {
      const dataDir = normalizeDataDir(config.dataDir);
      if (dataDir?.endsWith(".vscdb")) {
        return new CursorAdapter({ globalStorageDbPath: dataDir });
      }

      return new CursorAdapter({
        ...(dataDir ? { chatsDir: dataDir } : {}),
        globalStorageDbPath: isProtectedSourceOptedIn(config) ? undefined : "",
      });
    },
  },
  {
    id: "codex",
    create: (config) => new CodexAdapter(normalizeDataDir(config.dataDir)),
  },
  {
    id: "warp",
    create: (config) =>
      new WarpAdapter(resolveProtectedPathOverride(config)),
  },
  {
    id: "gemini-cli",
    create: (config) => new GeminiCliAdapter(normalizeDataDir(config.dataDir)),
  },
  {
    id: "kiro",
    create: (config) =>
      new KiroAdapter(resolveProtectedPathOverride(config)),
  },
  {
    id: "amp",
    create: (config) => new AmpAdapter(normalizeDataDir(config.dataDir)),
  },
  {
    id: "opencode",
    create: (config) =>
      new OpenCodeAdapter(resolveProtectedPathOverride(config)),
  },
  {
    id: "pi",
    create: (config) => new PiAdapter(normalizeDataDir(config.dataDir)),
  },
  {
    id: "piagent",
    create: (config) => new PiAgentAdapter(normalizeDataDir(config.dataDir)),
  },
];

export type ProtectedSourceStartupNotice = {
  adapterId: string;
  adapterName: string;
  mode: StartupPolicyMode;
  summary: string;
};

export function allAdapters(
  adapterConfigs?: Record<string, AdapterConfig>,
): Adapter[] {
  return [
    ...ADAPTER_FACTORIES.map((factory) =>
      factory.create(resolveAdapterConfig(adapterConfigs, factory.id)),
    ),
  ];
}

export function createAdapter(
  adapterId: string,
  config: AdapterConfig,
): Adapter {
  const factory = ADAPTER_FACTORIES.find((candidate) => candidate.id === adapterId);
  if (!factory) {
    throw new Error(`unknown adapter ${adapterId}`);
  }

  return factory.create(
    resolveAdapterConfig(
      {
        [adapterId]: { ...config },
      },
      adapterId,
    ),
  );
}

export function protectedSourceStartupNotices(
  adapterConfigs?: Record<string, AdapterConfig>,
  platform: NodeJS.Platform = process.platform,
): ProtectedSourceStartupNotice[] {
  return Object.values(STARTUP_POLICIES).flatMap((policy) => {
    const config = resolveAdapterConfig(adapterConfigs, policy.adapterId);
    if (config.enabled === false || isProtectedSourceOptedIn(config)) {
      return [];
    }

    return [
      {
        adapterId: policy.adapterId,
        adapterName: policy.adapterName,
        mode: policy.mode,
        summary: policy.summary(platform),
      },
    ];
  });
}

export function startupProbeBlocked(
  adapterId: string,
  adapterConfigs?: Record<string, AdapterConfig>,
): boolean {
  if (!isProtectedSourceAdapter(adapterId)) {
    return false;
  }

  const policy = STARTUP_POLICIES[adapterId];
  if (!policy || policy.mode !== "opt-in-only") {
    return false;
  }

  const config = resolveAdapterConfig(adapterConfigs, adapterId);
  return config.enabled !== false && !isProtectedSourceOptedIn(config);
}

export async function detectAdapters(
  adapterConfigs?: Record<string, AdapterConfig>,
): Promise<Adapter[]> {
  const adapters = allAdapters(adapterConfigs);
  const detected: Adapter[] = [];
  for (const a of adapters) {
    try {
      if (await a.detect()) {
        detected.push(a);
      }
    } catch {
      // skip failed detection
    }
  }
  return detected;
}

function normalizeDataDir(dataDir?: string): string | undefined {
  if (typeof dataDir !== "string") {
    return undefined;
  }

  const trimmed = dataDir.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveProtectedPathOverride(
  config: AdapterConfig,
): string | undefined {
  const dataDir = normalizeDataDir(config.dataDir);
  if (dataDir) {
    return dataDir;
  }

  return isProtectedSourceOptedIn(config) ? undefined : "";
}
