import { SHUTDOWN_DRAIN_TIMEOUT_MS } from "../contracts/lifecycle";
import {
  getWatcherState,
  getDashboardState,
  stopDashboard,
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
  ui?: boolean;
  all?: boolean;
  port?: number;
}): Promise<void> {
  const watcherState = getWatcherState();
  const dashboardState = getDashboardState();
  const runtimePaths = getRuntimePaths();

  // --service: install as OS service
  if (opts.service) {
    if (watcherState.status === "running" && watcherState.mode === "service") {
      console.log("  jin is already running under the OS service manager.");
      console.log("  Use service control or `jin service status` for details.");
      if (opts.ui || opts.all) {
        await startUiIfNeeded(dashboardState, opts.port);
      }
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
    await serviceCommand("install");
    if (opts.ui || opts.all) {
      await startUiIfNeeded(dashboardState, opts.port);
    }
    return;
  }

  // --ui only: start dashboard without touching watcher
  if (opts.ui && !opts.all) {
    await startUiIfNeeded(dashboardState, opts.port);
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
    if (isServiceInstalled()) {
      console.log("  Note: OS service is installed but not active.");
      console.log("  The service may start on reboot. Consider `jin start --service` instead.\n");
    }

    markRuntimeStarting("daemon");
    const { watchCommand } = await import("./watch");
    try {
      await watchCommand({ daemon: true });
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

  // --all: also start dashboard
  if (opts.all) {
    const freshDashboard = getDashboardState();
    await startUiIfNeeded(freshDashboard, opts.port);
  }
}

export async function restartCommand(opts: {
  service?: boolean;
  ui?: boolean;
  all?: boolean;
  port?: number;
}): Promise<void> {
  if (opts.ui && !opts.all) {
    await stopDashboard();
    console.log("  Dashboard stopped.");
    await Bun.sleep(300);
    await startCommand(opts);
    return;
  }

  const watcherState = getWatcherState();
  const dashboardState = getDashboardState();

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

  if (dashboardState.status === "running") {
    await stopDashboard();
    console.log("  Dashboard stopped.");
  }

  await Bun.sleep(300);
  await startCommand(opts);
}

async function startUiIfNeeded(
  dashboardState: { status: string; pid?: number; port?: number },
  port?: number,
): Promise<void> {
  if (dashboardState.status === "running") {
    const url = `http://localhost:${dashboardState.port || 4000}`;
    console.log(`  Dashboard already running (PID ${dashboardState.pid}) at ${url}`);
    return;
  }
  const { startDetached } = await import("../api/server");
  await startDetached({ port: port || 4000 });
}
