import { getAllState } from "../lifecycle";
import {
  getRuntimePaths,
  getRuntimeStatus,
} from "../runguard";
import type {
  RuntimeIssue,
  RuntimeOwnershipRecord,
  RuntimeState,
} from "../contracts/lifecycle";

export type LocalControlAction = "start" | "stop" | "restart";
export type LocalControlSubsystemHealth =
  | "inactive"
  | "healthy"
  | "degraded"
  | "paused";
export type LocalControlHealthStatus =
  | "stopped"
  | "starting"
  | "healthy"
  | "degraded"
  | "stopping";

export interface LocalControlComponentDto {
  name: "watcher" | "dashboard";
  status: "running" | "stopped";
  pid?: number;
  mode?: RuntimeOwnershipRecord["mode"];
  port?: number;
  uptime?: string;
  lifecycleState?: RuntimeState;
  issues?: RuntimeIssue[];
}

export interface LocalControlStatusDto {
  runtime: {
    state: RuntimeState;
    owner: RuntimeOwnershipRecord | null;
    issues: RuntimeIssue[];
  };
  health: {
    status: LocalControlHealthStatus;
    issueCount: number;
    issueSubsystems: string[];
    paused: boolean;
    ingest: LocalControlSubsystemHealth;
    push: LocalControlSubsystemHealth;
    components: {
      running: number;
      stopped: number;
    };
  };
  components: LocalControlComponentDto[];
  paths: {
    configDir: string;
    config: string;
    store: string;
    log: string;
  };
}

export interface LocalControlActionResultDto {
  action: LocalControlAction;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  status: LocalControlStatusDto;
}

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

const DECODER = new TextDecoder();

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
    },
  };
}

async function executeLifecycleAction(
  action: LocalControlAction,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // Delegate through the existing CLI lifecycle entrypoints so ownership checks
  // stay centralized and this API never becomes a second runtime.
  const result = Bun.spawnSync(buildLifecycleCommand(action), {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env },
  });

  return {
    exitCode: result.exitCode,
    stdout: DECODER.decode(result.stdout),
    stderr: DECODER.decode(result.stderr),
  };
}

function buildLifecycleCommand(action: LocalControlAction): string[] {
  const binPath = process.execPath;
  const isCompiled = !binPath.endsWith("bun") && !binPath.endsWith("node");

  if (isCompiled) {
    return [binPath, action];
  }

  const entrypoint = process.argv[1];
  if (!entrypoint) {
    throw new Error("Unable to determine the jin entrypoint for lifecycle control.");
  }

  return [binPath, "run", entrypoint, action];
}

function summarizeHealthStatus(
  runtimeState: RuntimeState,
  issues: RuntimeIssue[],
): LocalControlHealthStatus {
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
): LocalControlSubsystemHealth {
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
