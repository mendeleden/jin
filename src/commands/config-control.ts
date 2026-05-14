import { saveConfig, type JinConfig } from "../config";
import { requestDaemonConfigReload } from "../api/client";
import { getWatcherState } from "../daemon/process-state";
import { getRuntimeStatus } from "../daemon/runtime-state";
import { restartCommand } from "./start";

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
  const runtime = getRuntimeStatus();
  if (!isRuntimeExpectedToReloadConfig(runtime, watcher)) {
    console.log("  Changes will apply the next time jin starts.");
    return;
  }

  if (opts.yes) {
    console.log("  Restarting jin to apply config changes...");
    await restartCommand({
      ...(runtime.owner?.mode === "service" ? { service: true } : {}),
    });
    return;
  }

  const reloadResult = await requestDaemonConfigReload();
  if (reloadResult.status === "accepted") {
    console.log("  Running runtime accepted config reload request.");
    console.log("  Re-run with `--yes` to force a full controlled restart instead.");
    return;
  }

  console.log(
    `  WARNING: Config saved, but jin could not notify the running runtime to reload: ${reloadResult.message}`,
  );
  console.log(
    "  File watcher fallback will try to apply the change; otherwise restart jin.",
  );
}

function isRuntimeExpectedToReloadConfig(
  runtime: ReturnType<typeof getRuntimeStatus>,
  watcher: ReturnType<typeof getWatcherState>,
): boolean {
  if (runtime.owner && runtime.state !== "stopped" && runtime.state !== "stopping") {
    return true;
  }

  return watcher.status === "running";
}
