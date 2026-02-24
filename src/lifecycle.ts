import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { configDir } from "./config";
import { isDaemonRunning, isServiceActive, isServiceInstalled } from "./runguard";

const PID_FILE = join(configDir(), "jin.pid");
const UI_PID_FILE = join(configDir(), "ui.pid");
const UI_PORT_FILE = join(configDir(), "ui.port");

export interface ComponentState {
  name: "watcher" | "dashboard";
  status: "running" | "stopped";
  pid?: number;
  mode?: "daemon" | "service" | "foreground";
  port?: number;
  uptime?: string;
}

export function getWatcherState(): ComponentState {
  if (isServiceActive()) {
    return { name: "watcher", status: "running", mode: "service" };
  }

  const { running, pid } = isDaemonRunning();
  if (running && pid) {
    return {
      name: "watcher",
      status: "running",
      pid,
      mode: "daemon",
      uptime: getUptime(pid) || undefined,
    };
  }

  return { name: "watcher", status: "stopped" };
}

export function getDashboardState(): ComponentState {
  const pid = getUiPid();
  if (pid) {
    const port = getUiPort();
    return {
      name: "dashboard",
      status: "running",
      pid,
      port: port || undefined,
    };
  }
  return { name: "dashboard", status: "stopped" };
}

export function getAllState(): ComponentState[] {
  return [getWatcherState(), getDashboardState()];
}

export async function stopAll(): Promise<void> {
  await stopWatcher();
  await stopDashboard();
}

export async function stopWatcher(): Promise<void> {
  // Stop OS service if active
  if (isServiceActive()) {
    await stopService();
    return;
  }

  // Stop daemon
  const { running, pid } = isDaemonRunning();
  if (!running || !pid) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    // Wait up to 5 seconds for graceful shutdown
    for (let i = 0; i < 50; i++) {
      await Bun.sleep(100);
      try {
        process.kill(pid, 0);
      } catch {
        // Process is dead
        cleanupPidFile(PID_FILE);
        return;
      }
    }
    // Force kill if still alive
    process.kill(pid, "SIGKILL");
    cleanupPidFile(PID_FILE);
  } catch {
    cleanupPidFile(PID_FILE);
  }
}

export async function stopDashboard(): Promise<void> {
  const pid = getUiPid();
  if (!pid) return;

  try {
    process.kill(pid, "SIGTERM");
    // Brief wait for cleanup
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(100);
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
    }
  } catch {
    // Process already dead
  }

  cleanupPidFile(UI_PID_FILE);
  cleanupPidFile(UI_PORT_FILE);
}

async function stopService(): Promise<void> {
  try {
    if (process.platform === "linux") {
      Bun.spawnSync(["systemctl", "--user", "stop", "jin.service"], {
        stdout: "pipe",
        stderr: "pipe",
      });
    } else if (process.platform === "darwin") {
      const uid = Bun.spawnSync(["id", "-u"], { stdout: "pipe" });
      const uidStr = new TextDecoder().decode(uid.stdout).trim();
      let result = Bun.spawnSync(
        ["launchctl", "bootout", `gui/${uidStr}/com.jin.agent`],
        { stdout: "pipe", stderr: "pipe" }
      );
      if (result.exitCode !== 0) {
        const HOME = process.env.HOME || "";
        Bun.spawnSync(
          ["launchctl", "unload", join(HOME, "Library", "LaunchAgents", "com.jin.agent.plist")],
          { stdout: "pipe", stderr: "pipe" }
        );
      }
    } else if (process.platform === "win32") {
      Bun.spawnSync(
        ["powershell", "-Command", "Stop-ScheduledTask -TaskName 'jin' -ErrorAction SilentlyContinue"],
        { stdout: "pipe", stderr: "pipe" }
      );
    }
  } catch {}
}

export function getUptime(pid: number): string | null {
  try {
    if (process.platform === "linux") {
      // Read process start time from /proc
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const fields = stat.split(" ");
      const startTicks = parseInt(fields[21]);
      const uptimeSeconds = parseFloat(readFileSync("/proc/uptime", "utf-8").split(" ")[0]);
      const hz = 100; // standard on most Linux
      const processAgeSeconds = uptimeSeconds - startTicks / hz;
      return formatUptime(processAgeSeconds);
    }
    if (process.platform === "darwin") {
      const result = Bun.spawnSync(["ps", "-o", "etime=", "-p", String(pid)], {
        stdout: "pipe",
      });
      const etime = new TextDecoder().decode(result.stdout).trim();
      if (!etime) return null;
      return etime;
    }
  } catch {}
  return null;
}

function formatUptime(seconds: number): string {
  if (seconds < 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getUiPid(): number | null {
  if (!existsSync(UI_PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(UI_PID_FILE, "utf-8").trim());
    process.kill(pid, 0);
    return pid;
  } catch {
    cleanupPidFile(UI_PID_FILE);
    cleanupPidFile(UI_PORT_FILE);
    return null;
  }
}

function getUiPort(): number | null {
  if (!existsSync(UI_PORT_FILE)) return null;
  try {
    return parseInt(readFileSync(UI_PORT_FILE, "utf-8").trim());
  } catch {
    return null;
  }
}

function cleanupPidFile(path: string): void {
  try { unlinkSync(path); } catch {}
}
