import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { configDir, configPath } from "../config";
import type {
  RuntimeIssue,
  RuntimeMode,
  RuntimeOwnershipRecord,
  RuntimeState,
  RuntimeStatus,
} from "../contracts/lifecycle";

const HOME = process.env.HOME || process.env.USERPROFILE || "";
const PID_FILE = join(configDir(), "jin.pid");
const RUNTIME_STATE_FILE = join(configDir(), "jin.runtime.json");
const LOG_FILE = join(configDir(), "jin.log");
const STARTING_GRACE_MS = 10_000;
const decoder = new TextDecoder();

// Run a powershell command without flashing a console window. Without
// `windowsHide` + `-WindowStyle Hidden`, every probe pops a visible powershell
// console because the daemon process has no inheritable console of its own.
function runHiddenPowerShell(script: string): {
  exitCode: number | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
} {
  return Bun.spawnSync(
    [
      "powershell",
      "-NoLogo",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      script,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    },
  );
}

export type RunMode = RuntimeMode | "none";

interface PersistedRuntimeState {
  state: RuntimeState;
  owner?: RuntimeOwnershipRecord;
  issues: RuntimeIssue[];
  updatedAt: string;
}

export interface RuntimePaths {
  configDir: string;
  configPath: string;
  storePath: string;
  logPath: string;
}

export interface DarwinLaunchAgentStatus {
  loaded: boolean;
  running: boolean;
  pid: number | null;
  state: string | null;
  lastExitCode: string | null;
}

/** Check if a PID file exists and the process is alive. */
export function isDaemonRunning(): { running: boolean; pid?: number } {
  const owner = detectActiveOwner();
  if (!owner || owner.mode === "service") {
    return { running: false };
  }

  return { running: true, pid: owner.pid };
}

/** Check if jin is registered as an OS service. */
export function isServiceInstalled(): boolean {
  try {
    if (process.platform === "linux") {
      return existsSync(join(HOME, ".config", "systemd", "user", "jin.service"));
    }
    if (process.platform === "darwin") {
      return existsSync(join(HOME, "Library", "LaunchAgents", "com.jin.agent.plist"));
    }
    if (process.platform === "win32") {
      const result = runHiddenPowerShell(
        "Get-ScheduledTask -TaskName 'jin' -ErrorAction SilentlyContinue",
      );
      return result.exitCode === 0 && decode(result.stdout).trim().length > 0;
    }
  } catch {}
  return false;
}

/** Check if the OS service is actively running (not just installed). */
export function isServiceActive(): boolean {
  try {
    if (process.platform === "linux") {
      const result = Bun.spawnSync(
        ["systemctl", "--user", "is-active", "jin.service"],
        { stdout: "pipe", stderr: "pipe" },
      );
      const state = decode(result.stdout).trim();
      return state === "active" || state === "activating" || state === "reloading";
    }
    if (process.platform === "darwin") {
      const status = getDarwinLaunchAgentStatus();
      return status?.running === true;
    }
    if (process.platform === "win32") {
      const result = runHiddenPowerShell(
        "(Get-ScheduledTask -TaskName 'jin' -ErrorAction SilentlyContinue).State",
      );
      return decode(result.stdout).trim() === "Running";
    }
  } catch {}
  return false;
}

export function getDarwinLaunchAgentStatus(): DarwinLaunchAgentStatus | null {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const uid = Bun.spawnSync(["id", "-u"], { stdout: "pipe", stderr: "pipe" });
    const uidStr = decode(uid.stdout).trim();
    if (!uidStr) {
      return null;
    }

    const result = Bun.spawnSync(
      ["launchctl", "print", `gui/${uidStr}/com.jin.agent`],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0) {
      return null;
    }

    const output = decode(result.stdout);
    const stateMatch = output.match(/^\s*state = (.+)$/m);
    const pidMatch = output.match(/^\s*pid = (\d+)$/m);
    const lastExitMatch = output.match(/^\s*last exit code = (.+)$/m);
    const pid = pidMatch ? parseInt(pidMatch[1] ?? "", 10) : NaN;

    return {
      loaded: true,
      running:
        (stateMatch?.[1]?.trim() ?? "") === "running" ||
        (Number.isFinite(pid) && pid > 0),
      pid: Number.isFinite(pid) && pid > 0 ? pid : null,
      state: stateMatch?.[1]?.trim() ?? null,
      lastExitCode: lastExitMatch?.[1]?.trim() ?? null,
    };
  } catch {
    return null;
  }
}

export function getRuntimePaths(): RuntimePaths {
  const resolvedConfigDir = resolve(configDir());
  const resolvedConfigPath = resolve(configPath());
  const raw = readRawConfig();
  const storePath =
    typeof raw?.store?.dbPath === "string" && raw.store.dbPath.trim().length > 0
      ? resolve(raw.store.dbPath)
      : resolve(join(resolvedConfigDir, "store.db"));

  return {
    configDir: resolvedConfigDir,
    configPath: resolvedConfigPath,
    storePath,
    logPath: resolve(LOG_FILE),
  };
}

export function getRuntimeStatus(): RuntimeStatus {
  const persisted = readPersistedRuntimeState();
  const owner = detectActiveOwner(persisted?.owner?.mode);

  if (!owner) {
    if (persisted) {
      clearRuntimeState();
    }
    return { state: "stopped", issues: [] };
  }

  const issues = persisted?.issues ?? [];
  const state = resolveRuntimeState(owner, persisted, issues);

  if (!persisted || hasOwnerDrifted(owner, persisted.owner)) {
    writePersistedRuntimeState(state, owner, issues);
  }

  return {
    state,
    owner,
    issues,
  };
}

export function markRuntimeStarting(modeHint?: RuntimeMode): RuntimeStatus {
  const owner = detectActiveOwner(modeHint);
  writePersistedRuntimeState("starting", owner, []);
  return getRuntimeStatus();
}

export function markRuntimeRunning(
  modeHint?: RuntimeMode,
  issues: RuntimeIssue[] = [],
): RuntimeStatus {
  const owner = detectActiveOwner(modeHint);
  const state = issues.length > 0 ? "degraded" : "running";
  writePersistedRuntimeState(state, owner, issues);
  return getRuntimeStatus();
}

export function markRuntimeStopping(owner?: RuntimeOwnershipRecord): RuntimeStatus {
  const activeOwner = owner ?? detectActiveOwner();
  writePersistedRuntimeState("stopping", activeOwner, []);
  return getRuntimeStatus();
}

export function clearRuntimeState(): void {
  try {
    unlinkSync(RUNTIME_STATE_FILE);
  } catch {}
}

/** Get the current run mode. */
export function detectRunMode(): RunMode {
  const owner = detectActiveOwner();
  return owner?.mode ?? "none";
}

/** Human-readable description of a run mode. */
export function runModeLabel(mode: RunMode): string {
  switch (mode) {
    case "service":
      return "OS service manager";
    case "daemon":
      return "background daemon (jin start)";
    case "foreground":
      return "foreground runtime (jin start --foreground)";
    default:
      return "not running";
  }
}

function resolveRuntimeState(
  owner: RuntimeOwnershipRecord,
  persisted: PersistedRuntimeState | null,
  issues: RuntimeIssue[],
): RuntimeState {
  if (!persisted) {
    return issues.length > 0 ? "degraded" : "running";
  }

  if (persisted.state === "stopping") {
    return "stopping";
  }

  if (persisted.state === "starting") {
    const updatedAt = Date.parse(persisted.updatedAt);
    if (!Number.isNaN(updatedAt) && Date.now() - updatedAt < STARTING_GRACE_MS) {
      return "starting";
    }
    return issues.length > 0 ? "degraded" : "running";
  }

  if (persisted.state === "degraded" || issues.length > 0) {
    return "degraded";
  }

  if (persisted.state === "stopped") {
    return owner ? (issues.length > 0 ? "degraded" : "running") : "stopped";
  }

  return persisted.state;
}

function detectActiveOwner(modeHint?: RuntimeMode): RuntimeOwnershipRecord | null {
  const persisted = readPersistedRuntimeState();
  const paths = getRuntimePaths();
  const livePid = readLivePid();

  const serviceOwner = detectServiceOwner(paths, persisted, livePid, modeHint);
  if (serviceOwner) {
    return serviceOwner;
  }

  if (!livePid) {
    return null;
  }

  const inferredMode =
    modeHint && modeHint !== "service"
      ? modeHint
      : persisted?.owner?.mode && persisted.owner.mode !== "service"
        ? persisted.owner.mode
        : inferProcessMode(livePid);

  return buildOwnershipRecord(livePid, inferredMode, paths, persisted?.owner);
}

function detectServiceOwner(
  paths: RuntimePaths,
  persisted: PersistedRuntimeState | null,
  livePid: number | null,
  modeHint?: RuntimeMode,
): RuntimeOwnershipRecord | null {
  if (!isServiceActive()) {
    return null;
  }

  const persistedOwner = persisted?.owner;
  const persistedServiceOwner =
    persistedOwner?.mode === "service" &&
    ownershipMatchesRuntime(persistedOwner, paths)
      ? persistedOwner
      : null;
  const servicePid = getServicePid();

  if (modeHint === "service") {
    const pid = livePid ?? servicePid ?? persistedServiceOwner?.pid;
    if (!pid) {
      return null;
    }
    return buildOwnershipRecord(pid, "service", paths, persistedOwner);
  }

  if (servicePid && livePid && servicePid === livePid) {
    return buildOwnershipRecord(servicePid, "service", paths, persistedOwner);
  }

  if (persistedServiceOwner) {
    return buildOwnershipRecord(
      servicePid ?? persistedServiceOwner.pid,
      "service",
      paths,
      persistedOwner,
    );
  }

  return null;
}

function buildOwnershipRecord(
  pid: number,
  mode: RuntimeMode,
  paths: RuntimePaths,
  prior?: RuntimeOwnershipRecord,
): RuntimeOwnershipRecord {
  const startedAt =
    prior && prior.pid === pid && prior.mode === mode
      ? prior.startedAt
      : getProcessStartedAt(pid) ?? new Date().toISOString();

  return {
    pid,
    mode,
    startedAt,
    configDir: paths.configDir,
    storePath: paths.storePath,
    logPath: paths.logPath,
  };
}

function readLivePid(): number | null {
  if (!existsSync(PID_FILE)) {
    return null;
  }

  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      cleanupPidFile();
      return null;
    }

    if (!isPidAlive(pid)) {
      cleanupPidFile();
      return null;
    }

    return pid;
  } catch {
    cleanupPidFile();
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getServicePid(): number | null {
  try {
    if (process.platform === "linux") {
      const result = Bun.spawnSync(
        ["systemctl", "--user", "show", "jin.service", "--property", "MainPID", "--value"],
        { stdout: "pipe", stderr: "pipe" },
      );
      const pid = parseInt(decode(result.stdout).trim(), 10);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    }

    if (process.platform === "darwin") {
      return getDarwinLaunchAgentStatus()?.pid ?? null;
    }
  } catch {}

  return null;
}

function inferProcessMode(pid: number): RuntimeMode {
  if (process.platform === "linux" || process.platform === "darwin") {
    try {
      const result = Bun.spawnSync(["ps", "-o", "tty=", "-p", String(pid)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const tty = decode(result.stdout).trim();
      if (tty.length > 0 && tty !== "?" && tty !== "??") {
        return "foreground";
      }
    } catch {}
  }

  return "daemon";
}

function getProcessStartedAt(pid: number): string | null {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    return null;
  }

  try {
    const result = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const value = decode(result.stdout).trim();
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  } catch {
    return null;
  }
}

function readPersistedRuntimeState(): PersistedRuntimeState | null {
  if (!existsSync(RUNTIME_STATE_FILE)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(RUNTIME_STATE_FILE, "utf-8"));
    if (!isRecord(raw) || !isRuntimeState(raw.state) || typeof raw.updatedAt !== "string") {
      return null;
    }

    const owner = parseOwnershipRecord(raw.owner);
    const issues = Array.isArray(raw.issues) ? raw.issues.flatMap(parseRuntimeIssue) : [];

    return {
      state: raw.state,
      owner: owner ?? undefined,
      issues,
      updatedAt: raw.updatedAt,
    };
  } catch {
    return null;
  }
}

function writePersistedRuntimeState(
  state: RuntimeState,
  owner?: RuntimeOwnershipRecord | null,
  issues: RuntimeIssue[] = [],
): void {
  try {
    mkdirSync(configDir(), { recursive: true });
    const record: PersistedRuntimeState = {
      state,
      updatedAt: new Date().toISOString(),
      issues,
      ...(owner ? { owner } : {}),
    };
    writeFileSync(RUNTIME_STATE_FILE, JSON.stringify(record, null, 2));
  } catch {}
}

function hasOwnerDrifted(
  owner: RuntimeOwnershipRecord,
  previous?: RuntimeOwnershipRecord,
): boolean {
  if (!previous) {
    return true;
  }

  return (
    previous.pid !== owner.pid ||
    previous.mode !== owner.mode ||
    previous.configDir !== owner.configDir ||
    previous.storePath !== owner.storePath ||
    previous.logPath !== owner.logPath
  );
}

function ownershipMatchesRuntime(
  owner: RuntimeOwnershipRecord,
  paths: RuntimePaths,
): boolean {
  return (
    owner.configDir === paths.configDir &&
    owner.storePath === paths.storePath &&
    (owner.logPath ?? paths.logPath) === paths.logPath
  );
}

function parseOwnershipRecord(raw: unknown): RuntimeOwnershipRecord | null {
  if (!isRecord(raw)) {
    return null;
  }

  const pid = asNumber(raw.pid);
  const mode = raw.mode;
  const startedAt = raw.startedAt;
  const ownershipConfigDir = raw.configDir;
  const storePath = raw.storePath;
  const logPath = raw.logPath;

  if (
    !pid ||
    !isRuntimeMode(mode) ||
    typeof startedAt !== "string" ||
    typeof ownershipConfigDir !== "string" ||
    typeof storePath !== "string"
  ) {
    return null;
  }

  return {
    pid,
    mode,
    startedAt,
    configDir: ownershipConfigDir,
    storePath,
    ...(typeof logPath === "string" ? { logPath } : {}),
  };
}

function parseRuntimeIssue(raw: unknown): RuntimeIssue[] {
  if (!isRecord(raw)) {
    return [];
  }

  if ((raw.subsystem !== "ingest" && raw.subsystem !== "push") || typeof raw.message !== "string") {
    return [];
  }

  return [
    {
      subsystem: raw.subsystem,
      message: raw.message,
      ...(typeof raw.paused === "boolean" ? { paused: raw.paused } : {}),
    },
  ];
}

function readRawConfig(): Record<string, any> | null {
  if (!existsSync(configPath())) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf-8"));
    return isRecord(raw) ? raw : null;
  } catch {
    return null;
  }
}

function cleanupPidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {}
}

function decode(input: Uint8Array<ArrayBufferLike>): string {
  return decoder.decode(input);
}

function isRuntimeMode(value: unknown): value is RuntimeMode {
  return value === "foreground" || value === "daemon" || value === "service";
}

function isRuntimeState(value: unknown): value is RuntimeState {
  return (
    value === "stopped" ||
    value === "starting" ||
    value === "running" ||
    value === "degraded" ||
    value === "stopping"
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
