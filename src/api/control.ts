import { getAllState } from "../daemon/process-state";
import { existsSync } from "fs";
import { homedir } from "os";
import { spawnSync } from "node:child_process";
import { posix, win32 } from "path";
import {
  getRuntimePaths,
  getRuntimeStatus,
} from "../daemon/runtime-state";
import type {
  DesktopControlAction,
  DesktopControlActionResult,
  DesktopControlComponent,
  DesktopControlStatus,
  DesktopHealthStatus,
  DesktopSubsystemHealth,
} from "../contracts/desktop";
import type {
  RuntimeIssue,
  RuntimeState,
} from "../contracts/lifecycle";

export type LocalControlAction = DesktopControlAction;
export type LocalControlSubsystemHealth = DesktopSubsystemHealth;
export type LocalControlHealthStatus = DesktopHealthStatus;
export type LocalControlComponentDto = DesktopControlComponent;
export type LocalControlStatusDto = DesktopControlStatus;
export type LocalControlActionResultDto = DesktopControlActionResult;

export interface LocalControlBoundary {
  getStatus(): LocalControlStatusDto;
  runAction(action: LocalControlAction): Promise<LocalControlActionResultDto>;
}

export interface LocalControlBoundaryOptions {
  executeAction?: (
    action: LocalControlAction,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  getStatus?: () => LocalControlStatusDto;
}

export interface LifecycleCommandOptions {
  argv?: string[];
  electron?: boolean;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  exists?: (path: string) => boolean;
  platform?: NodeJS.Platform;
}

export function createLocalControlBoundary(
  options: LocalControlBoundaryOptions = {},
): LocalControlBoundary {
  const executeAction = options.executeAction ?? executeLifecycleAction;
  const getStatus = options.getStatus ?? getLocalControlStatus;

  return {
    getStatus,
    async runAction(action) {
      const result = await executeAction(action);
      return {
        action,
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
        status: getStatus(),
      };
    },
  };
}

export function getLocalControlStatus(): LocalControlStatusDto {
  const runtime = getRuntimeStatus();
  const issues = runtime.issues ?? [];
  const components = getAllState().map((component) => ({ ...component }));
  const paths = getRuntimePaths();

  return {
    runtime: {
      state: runtime.state,
      owner: runtime.owner ?? null,
      issues,
    },
    health: {
      status: summarizeHealthStatus(runtime.state, issues),
      issueCount: issues.length,
      issueSubsystems: uniqueSubsystems(issues),
      paused: issues.some((issue) => issue.paused === true),
      ingest: summarizeSubsystem("ingest", runtime.state, issues),
      push: summarizeSubsystem("push", runtime.state, issues),
      components: {
        running: components.filter((component) => component.status === "running")
          .length,
        stopped: components.filter((component) => component.status === "stopped")
          .length,
      },
    },
    components,
    paths: {
      configDir: paths.configDir,
      config: paths.configPath,
      store: paths.storePath,
      log: paths.logPath,
      socket: paths.socketPath,
    },
  };
}

async function executeLifecycleAction(
  action: LocalControlAction,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // Delegate through the existing CLI lifecycle entrypoints so ownership checks
  // stay centralized and this API never becomes a second runtime.
  const commandLine = buildLifecycleCommand(action);
  const command = commandLine[0];
  if (!command) {
    throw new Error("Unable to determine the jin lifecycle command.");
  }
  const args = commandLine.slice(1);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr:
      result.stderr ??
      (result.error instanceof Error ? result.error.message : ""),
  };
}

export function buildLifecycleCommand(
  action: LocalControlAction,
  options: LifecycleCommandOptions = {},
): string[] {
  if (options.electron ?? Boolean(process.versions.electron)) {
    return [resolveInstalledJinCli(options), action];
  }

  const platform = options.platform ?? process.platform;
  const pathApi = pathApiForPlatform(platform);
  const binPath = options.execPath ?? process.execPath;
  const executableName = pathApi.basename(binPath).toLowerCase();
  const isCompiled = !["bun", "bun.exe", "node", "node.exe"].includes(
    executableName,
  );

  if (isCompiled) {
    return [binPath, action];
  }

  const entrypoint = (options.argv ?? process.argv)[1];
  if (!entrypoint) {
    throw new Error("Unable to determine the jin entrypoint for lifecycle control.");
  }

  return [binPath, "run", entrypoint, action];
}

function resolveInstalledJinCli(options: LifecycleCommandOptions): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const override =
    env.JIN_DESKTOP_CLI_PATH ||
    env.JIN_CLI_PATH ||
    env.JIN_BIN ||
    env.JIN_BINARY_PATH ||
    env.JIN_BINARY;

  if (override) {
    return override;
  }

  const pathCandidate = findExecutableOnPath(
    platform === "win32" ? "jin.exe" : "jin",
    env.PATH ?? "",
    platform,
    exists,
  );
  if (pathCandidate) {
    return pathCandidate;
  }

  for (const candidate of knownJinInstallPaths(platform, env)) {
    if (candidate && exists(candidate)) {
      return candidate;
    }
  }

  return platform === "win32" ? "jin.exe" : "jin";
}

function findExecutableOnPath(
  executable: string,
  pathValue: string,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean,
): string | null {
  const pathApi = pathApiForPlatform(platform);
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const extensions =
    platform === "win32" && !executable.toLowerCase().endsWith(".exe")
      ? ["", ".exe", ".cmd", ".bat"]
      : [""];

  for (const entry of pathValue.split(pathDelimiter)) {
    if (!entry) {
      continue;
    }

    for (const extension of extensions) {
      const candidate = pathApi.join(entry, `${executable}${extension}`);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function knownJinInstallPaths(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const home = env.HOME || env.USERPROFILE || homedir();
  const pathApi = pathApiForPlatform(platform);

  if (platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA || (home ? pathApi.join(home, "AppData", "Local") : "");
    return [
      home ? pathApi.join(home, ".local", "bin", "jin.exe") : "",
      localAppData ? pathApi.join(localAppData, "jin", "jin.exe") : "",
      localAppData ? pathApi.join(localAppData, "Jin", "jin.exe") : "",
      localAppData ? pathApi.join(localAppData, "Jin", "bin", "jin.exe") : "",
      localAppData
        ? pathApi.join(localAppData, "Programs", "jin", "jin.exe")
        : "",
      env.PROGRAMFILES ? pathApi.join(env.PROGRAMFILES, "jin", "jin.exe") : "",
    ].filter(Boolean);
  }

  return [
    pathApi.join(home, ".local", "bin", "jin"),
    pathApi.join(home, ".bun", "bin", "jin"),
    "/usr/local/bin/jin",
    "/opt/homebrew/bin/jin",
    "/usr/bin/jin",
  ];
}

function pathApiForPlatform(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === "win32" ? win32 : posix;
}

function summarizeHealthStatus(
  runtimeState: RuntimeState,
  issues: RuntimeIssue[],
): DesktopHealthStatus {
  switch (runtimeState) {
    case "stopped":
      return "stopped";
    case "starting":
      return "starting";
    case "stopping":
      return "stopping";
    case "degraded":
      return "degraded";
    case "running":
      return issues.length > 0 ? "degraded" : "healthy";
  }
}

function summarizeSubsystem(
  subsystem: "ingest" | "push",
  runtimeState: RuntimeState,
  issues: RuntimeIssue[],
): DesktopSubsystemHealth {
  if (runtimeState === "stopped") {
    return "inactive";
  }

  const matchingIssues = issues.filter((issue) => issue.subsystem === subsystem);
  if (matchingIssues.some((issue) => issue.paused === true)) {
    return "paused";
  }

  return matchingIssues.length > 0 ? "degraded" : "healthy";
}

function uniqueSubsystems(issues: RuntimeIssue[]): string[] {
  const subsystems = new Set<string>();
  for (const issue of issues) {
    if (typeof issue.subsystem === "string" && issue.subsystem.length > 0) {
      subsystems.add(issue.subsystem);
    }
  }
  return [...subsystems];
}
