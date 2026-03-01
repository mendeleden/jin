import { getWatcherState, getDashboardState, stopWatcher } from "../lifecycle";
import { isServiceInstalled } from "../runguard";

export async function startCommand(opts: {
  service?: boolean;
  ui?: boolean;
  all?: boolean;
  port?: number;
}): Promise<void> {
  const watcherState = getWatcherState();
  const dashboardState = getDashboardState();

  // --service: install as OS service
  if (opts.service) {
    if (watcherState.status === "running" && watcherState.mode === "service") {
      console.log("  Watcher already running as OS service.");
      if (opts.ui || opts.all) {
        await startUiIfNeeded(dashboardState, opts.port);
      }
      return;
    }
    // Stop daemon if running, then install service
    if (watcherState.status === "running" && watcherState.mode === "daemon") {
      console.log(`  Stopping daemon (PID ${watcherState.pid}) to install service...`);
      await stopWatcher();
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
      console.log("  Watcher already running as OS service.");
    } else {
      console.log(`  Watcher already running (PID ${watcherState.pid}).`);
    }
  } else {
    // Warn if service is installed but not active
    if (isServiceInstalled()) {
      console.log("  Note: OS service is installed but not active.");
      console.log("  The service may start on reboot. Consider `jin start --service` instead.\n");
    }
    // Daemonize
    const { watchCommand } = await import("./watch");
    await watchCommand({ daemon: true });
  }

  // --all: also start dashboard
  if (opts.all) {
    // Re-check dashboard state after watcher start
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
  const { stopAll, stopWatcher: stopW, stopDashboard: stopD } = await import("../lifecycle");

  if (opts.ui && !opts.all) {
    await stopD();
    console.log("  Dashboard stopped.");
  } else {
    await stopAll();
    console.log("  All components stopped.");
  }

  // Brief pause for cleanup
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
