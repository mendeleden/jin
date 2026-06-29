import { SHUTDOWN_DRAIN_TIMEOUT_MS } from "../contracts/lifecycle";
import { requestDaemonControlStatus } from "../api/client";
import {
  getWatcherState,
  stopWatcher,
} from "../daemon/process-state";
import {
  clearRuntimeState,
  getRuntimePaths,
  isServiceInstalled,
  markRuntimeRunning,
  markRuntimeStarting,
} from "../daemon/runtime-state";
import {
  isPoisonedLocalStoreError,
  printPoisonedLocalStoreResetGuidance,
} from "../db/store";

export async function startCommand(opts: {
  service?: boolean;
  writeDebugJsonl?: boolean;
}): Promise<void> {
  const watcherState = getWatcherState();
  const runtimePaths = getRuntimePaths();

  // --service: install as OS service
  if (opts.service) {
    if (watcherState.status !== "running" && await localSocketResponds()) {
      printRespondingSocketRefusal("enable service mode");
      return;
    }

    if (watcherState.status === "running" && watcherState.mode === "service") {
      console.log("  jin is already running under the OS service manager.");
      console.log("  Use service control or `jin service status` for details.");
      return;
    }

    if (watcherState.status === "running") {
      const ownerLabel =
        watcherState.mode === "foreground"
          ? `foreground runtime (PID ${watcherState.pid})`
          : `runtime (PID ${watcherState.pid})`;
      console.log(`  Stopping existing ${ownerLabel} before enabling service mode...`);
      const stopResult = await stopWatcher({
        waitForExitMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
        forceAfterTimeout: true,
      });
      if (!stopResult.completed) {
        console.log("  The existing runtime is still stopping.");
        console.log("  Wait for `jin status` to report `stopped`, then try again.");
        return;
      }
    }

    const { serviceCommand } = await import("./service");
    await serviceCommand("install", { writeDebugJsonl: opts.writeDebugJsonl });
    return;
  }

  // Default: start watcher as daemon
  if (watcherState.status === "running") {
    if (watcherState.mode === "service") {
      console.log("  jin is already running under the OS service manager.");
      console.log("  Use service control or `jin service status` instead of spawning a daemon.");
    } else if (watcherState.mode === "foreground") {
      console.log(`  jin is already running in the foreground (PID ${watcherState.pid}).`);
      console.log("  Stop that runtime or run `jin stop` before starting a detached daemon.");
    } else {
      console.log(`  jin is already running as a detached daemon (PID ${watcherState.pid}).`);
      console.log("  Use `jin status` or `jin stop` instead of starting a second owner.");
    }
  } else {
    if (await localSocketResponds()) {
      printRespondingSocketRefusal("start a detached daemon");
      return;
    }

    if (isServiceInstalled()) {
      console.log("  Note: OS service is installed but not active.");
      console.log("  The service may start on reboot. Consider `jin start --service` instead.\n");
    }

    markRuntimeStarting("daemon");
    const { watchCommand } = await import("./watch");
    try {
      await watchCommand({
        daemon: true,
        writeDebugJsonl: opts.writeDebugJsonl,
      });
      markRuntimeRunning("daemon");
    } catch (error) {
      clearRuntimeState();
      if (isPoisonedLocalStoreError(error)) {
        printPoisonedLocalStoreResetGuidance(runtimePaths.configDir);
        process.exit(1);
      }
      throw error;
    }
  }

}

async function localSocketResponds(): Promise<boolean> {
  const probe = await requestDaemonControlStatus({ timeoutMs: 500 });
  return probe.status === "available";
}

function printRespondingSocketRefusal(action: string): void {
  console.log("  A Jin daemon socket is already responding, but local owner metadata is missing.");
  console.log(`  Refusing to ${action} because that could create a second runtime owner.`);
  console.log("  Run `jin stop` or remove the stale runtime process before retrying.");
}

export async function restartCommand(opts: {
  service?: boolean;
  writeDebugJsonl?: boolean;
}): Promise<void> {
  const watcherState = getWatcherState();

  if (watcherState.status === "running") {
    console.log("  Restarting the runtime owner...");
    const stopResult = await stopWatcher({
      waitForExitMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
      forceAfterTimeout: true,
    });
    if (!stopResult.completed) {
      console.log("  The runtime is still stopping.");
      console.log("  Run `jin status` to confirm it is stopped, then retry `jin restart`.");
      return;
    }
  }

  await Bun.sleep(300);
  await startCommand(opts);
}
