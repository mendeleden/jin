import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { configDir } from "./config";

const HOME = process.env.HOME || process.env.USERPROFILE || "";
const PID_FILE = join(configDir(), "jin.pid");

export type RunMode = "service" | "daemon" | "foreground" | "none";

/** Check if a PID file exists and the process is alive */
export function isDaemonRunning(): { running: boolean; pid?: number } {
  if (!existsSync(PID_FILE)) return { running: false };
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    return { running: false };
  }
}

/** Check if jin is registered as an OS service */
export function isServiceInstalled(): boolean {
  try {
    if (process.platform === "linux") {
      return existsSync(join(HOME, ".config", "systemd", "user", "jin.service"));
    }
    if (process.platform === "darwin") {
      return existsSync(join(HOME, "Library", "LaunchAgents", "com.jin.agent.plist"));
    }
    if (process.platform === "win32") {
      const result = Bun.spawnSync(
        ["powershell", "-Command", "Get-ScheduledTask -TaskName 'jin' -ErrorAction SilentlyContinue"],
        { stdout: "pipe", stderr: "pipe" }
      );
      return result.exitCode === 0 && new TextDecoder().decode(result.stdout).trim().length > 0;
    }
  } catch {}
  return false;
}

/** Check if the OS service is actively running (not just installed) */
export function isServiceActive(): boolean {
  try {
    if (process.platform === "linux") {
      const result = Bun.spawnSync(
        ["systemctl", "--user", "is-active", "jin.service"],
        { stdout: "pipe", stderr: "pipe" }
      );
      const state = new TextDecoder().decode(result.stdout).trim();
      return state === "active" || state === "activating" || state === "reloading";
    }
    if (process.platform === "darwin") {
      const result = Bun.spawnSync(["launchctl", "list"], { stdout: "pipe" });
      const output = new TextDecoder().decode(result.stdout);
      const line = output.split("\n").find((l) => l.includes("com.jin.agent"));
      if (!line) return false;
      return line.trim().split(/\s+/)[0] !== "-";
    }
    if (process.platform === "win32") {
      const result = Bun.spawnSync(
        ["powershell", "-Command", "(Get-ScheduledTask -TaskName 'jin' -ErrorAction SilentlyContinue).State"],
        { stdout: "pipe", stderr: "pipe" }
      );
      return new TextDecoder().decode(result.stdout).trim() === "Running";
    }
  } catch {}
  return false;
}

/** Get the current run mode */
export function detectRunMode(): RunMode {
  if (isServiceActive()) return "service";
  const { running } = isDaemonRunning();
  if (running) return "daemon";
  return "none";
}

/** Human-readable description of a run mode */
export function runModeLabel(mode: RunMode): string {
  switch (mode) {
    case "service": return "OS service (systemd/launchd/Task Scheduler)";
    case "daemon": return "background daemon (jin start)";
    case "foreground": return "foreground (jin start --foreground)";
    default: return "not running";
  }
}
