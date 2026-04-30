import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { configDir } from "../config";
import {
  SHUTDOWN_DRAIN_TIMEOUT_MS,
  type RuntimeIssue,
  type RuntimeMode,
  type RuntimeOwnershipRecord,
  type RuntimeState,
} from "../contracts/lifecycle";
import {
  clearRuntimeState,
  getRuntimeStatus,
  markRuntimeStopping,
} from "./runtime-state";
import { windowsTaskIdentityPowerShellLines } from "../windows-task";

const PID_FILE = join(configDir(), "jin.pid");
const DEFAULT_STOP_WAIT_MS = 2_000;

export interface ComponentState {
  name: "watcher";
  status: "running" | "stopped";
  pid?: number;
  mode?: RuntimeMode;
  uptime?: string;
  lifecycleState?: RuntimeState;
  issues?: RuntimeIssue[];
}

export interface StopWatcherOptions {
  waitForExitMs?: number;
  forceAfterTimeout?: boolean;
}

export interface StopWatcherResult {
  requested: boolean;
  completed: boolean;
  forced: boolean;
  owner?: RuntimeOwnershipRecord;
  via: "signal" | "service" | "none";
}

export function getWatcherState(): ComponentState {
  const runtime = getRuntimeStatus();
  if (runtime.state === "stopped" || !runtime.owner) {
    return { name: "watcher", status: "stopped", lifecycleState: "stopped" };
  }

  return {
    name: "watcher",
    status: "running",
    pid: runtime.owner.pid,
    mode: runtime.owner.mode,
    uptime: getUptime(runtime.owner.pid) || undefined,
    lifecycleState: runtime.state,
    ...(runtime.issues.length > 0 ? { issues: runtime.issues } : {}),
  };
}

export function getAllState(): ComponentState[] {
  return [getWatcherState()];
}

export async function stopAll(
  options?: StopWatcherOptions,
): Promise<StopWatcherResult> {
  return stopWatcher(options);
}

export async function stopWatcher(
  options: StopWatcherOptions = {},
): Promise<StopWatcherResult> {
  const runtime = getRuntimeStatus();
  if (runtime.state === "stopped" || !runtime.owner) {
    cleanupPidFile(PID_FILE);
    clearRuntimeState();
    return {
      requested: false,
      completed: true,
      forced: false,
      via: "none",
    };
  }

  const waitForExitMs = options.waitForExitMs ?? DEFAULT_STOP_WAIT_MS;
  const forceAfterTimeout = options.forceAfterTimeout ?? false;
  markRuntimeStopping(runtime.owner);

  if (runtime.owner.mode === "service") {
    await requestServiceStop();
    const completed = await waitForServiceStop(waitForExitMs);
    if (completed) {
      cleanupPidFile(PID_FILE);
      clearRuntimeState();
    }
    return {
      requested: true,
      completed,
      forced: false,
      owner: runtime.owner,
      via: "service",
    };
  }

  try {
    process.kill(runtime.owner.pid, "SIGTERM");
  } catch {
    cleanupPidFile(PID_FILE);
    clearRuntimeState();
    return {
      requested: true,
      completed: true,
      forced: false,
      owner: runtime.owner,
      via: "signal",
    };
  }

  const completed = await waitForPidExit(runtime.owner.pid, waitForExitMs);
  if (completed) {
    cleanupPidFile(PID_FILE);
    clearRuntimeState();
    return {
      requested: true,
      completed: true,
      forced: false,
      owner: runtime.owner,
      via: "signal",
    };
  }

  if (!forceAfterTimeout) {
    return {
      requested: true,
      completed: false,
      forced: false,
      owner: runtime.owner,
      via: "signal",
    };
  }

  try {
    process.kill(runtime.owner.pid, "SIGKILL");
  } catch {}

  const forced = await waitForPidExit(runtime.owner.pid, 1_000);
  if (forced) {
    cleanupPidFile(PID_FILE);
    clearRuntimeState();
  }

  return {
    requested: true,
    completed: forced,
    forced,
    owner: runtime.owner,
    via: "signal",
  };
}

export function getUptime(pid: number): string | null {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const fields = stat.split(" ");
      const startTicks = parseInt(fields[21], 10);
      const uptimeSeconds = parseFloat(
        readFileSync("/proc/uptime", "utf-8").split(" ")[0],
      );
      const hz = 100;
      const processAgeSeconds = uptimeSeconds - startTicks / hz;
      return formatUptime(processAgeSeconds);
    }

    if (process.platform === "darwin") {
      const result = Bun.spawnSync(["ps", "-o", "etime=", "-p", String(pid)], {
        stdout: "pipe",
      });
      const etime = new TextDecoder().decode(result.stdout).trim();
      return etime || null;
    }
  } catch {}

  return null;
}

function formatUptime(seconds: number): string {
  if (seconds < 0) return "0s";

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}

async function requestServiceStop(): Promise<void> {
  try {
    if (process.platform === "linux") {
      Bun.spawnSync(["systemctl", "--user", "stop", "jin.service"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      return;
    }

    if (process.platform === "darwin") {
      const uid = Bun.spawnSync(["id", "-u"], { stdout: "pipe" });
      const uidStr = new TextDecoder().decode(uid.stdout).trim();
      let result = Bun.spawnSync(
        ["launchctl", "bootout", `gui/${uidStr}/com.jin.agent`],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (result.exitCode !== 0) {
        const homeDir = process.env.HOME || "";
        result = Bun.spawnSync(
          [
            "launchctl",
            "unload",
            join(homeDir, "Library", "LaunchAgents", "com.jin.agent.plist"),
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
      }
      return;
    }

    if (process.platform === "win32") {
      const ps = [
        ...windowsTaskIdentityPowerShellLines(),
        "Stop-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue",
      ].join("; ");
      Bun.spawnSync(
        [
          "powershell",
          "-NoLogo",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          ps,
        ],
        { stdout: "pipe", stderr: "pipe", windowsHide: true },
      );
    }
  } catch {}
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() <= deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }

    await Bun.sleep(100);
  }

  return false;
}

async function waitForServiceStop(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, Math.min(timeoutMs, SHUTDOWN_DRAIN_TIMEOUT_MS));
  while (Date.now() <= deadline) {
    const runtime = getRuntimeStatus();
    if (runtime.state === "stopped") {
      return true;
    }
    await Bun.sleep(200);
  }

  return false;
}

function cleanupPidFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {}
}
