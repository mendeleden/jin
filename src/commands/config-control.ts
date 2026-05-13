import { saveConfig, type JinConfig } from "../config";
import type { RuntimeIssue } from "../contracts/lifecycle";
import { getWatcherState } from "../daemon/process-state";
import { getRuntimeStatus, markRuntimeRunning } from "../daemon/runtime-state";
import { restartCommand } from "./start";

const OPERATOR_PAUSE_PREFIX = "sink paused by operator:";

export async function persistConfigChange(
  config: JinConfig,
  opts: {
    yes?: boolean;
    changeSummary?: string;
  } = {},
): Promise<void> {
  await saveConfig(config);
  await finalizeConfigChange(opts);
}

export async function finalizeConfigChange(
  opts: {
    yes?: boolean;
    changeSummary?: string;
  } = {},
): Promise<void> {
  if (opts.changeSummary) {
    console.log(`  ${opts.changeSummary}.`);
  }

  const watcher = getWatcherState();
  if (watcher.status !== "running") {
    console.log("  Changes will apply the next time jin starts.");
    return;
  }

  if (!opts.yes) {
    console.log("  Restart jin to apply config changes.");
    console.log("  Re-run with `--yes` to perform a controlled restart now.");
    return;
  }

  console.log("  Restarting jin to apply config changes...");
  const runtime = getRuntimeStatus();
  await restartCommand({
    ...(runtime.owner?.mode === "service" ? { service: true } : {}),
  });
}

export function applySinkPauseControl(
  sinkId: string,
  paused: boolean,
): boolean {
  const runtime = getRuntimeStatus();
  if (
    !runtime.owner ||
    (runtime.state !== "running" && runtime.state !== "degraded")
  ) {
    return false;
  }

  const nextIssues = runtime.issues.filter(
    (issue) => !isOperatorPauseIssue(issue, sinkId),
  );

  if (paused) {
    nextIssues.push({
      subsystem: "push",
      message: operatorPauseMessage(sinkId),
      paused: true,
    });
  }

  markRuntimeRunning(runtime.owner.mode, nextIssues);
  return true;
}

function operatorPauseMessage(sinkId: string): string {
  return `${OPERATOR_PAUSE_PREFIX} ${sinkId}`;
}

function isOperatorPauseIssue(issue: RuntimeIssue, sinkId: string): boolean {
  return issue.message === operatorPauseMessage(sinkId);
}
