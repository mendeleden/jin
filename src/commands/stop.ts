import {
  stopAll,
  stopWatcher,
  stopDashboard,
  getWatcherState,
  getDashboardState,
} from "../lifecycle";

export async function stopCommand(opts?: {
  watcher?: boolean;
  ui?: boolean;
}): Promise<void> {
  if (opts?.watcher) {
    const state = getWatcherState();
    if (state.status === "stopped") {
      console.log("  Watcher is not running.");
      return;
    }
    const label = state.mode === "service" ? "service" : `PID ${state.pid}`;
    console.log(`  Stopping watcher (${label})...`);
    await stopWatcher();
    console.log("  Watcher stopped.");
    return;
  }

  if (opts?.ui) {
    const state = getDashboardState();
    if (state.status === "stopped") {
      console.log("  Dashboard is not running.");
      return;
    }
    console.log(`  Stopping dashboard (PID ${state.pid})...`);
    await stopDashboard();
    console.log("  Dashboard stopped.");
    return;
  }

  // Default: stop everything
  const watcherState = getWatcherState();
  const dashboardState = getDashboardState();

  if (watcherState.status === "stopped" && dashboardState.status === "stopped") {
    console.log("  jin is not running.");
    return;
  }

  if (watcherState.status === "running") {
    const label = watcherState.mode === "service" ? "service" : `PID ${watcherState.pid}`;
    console.log(`  Stopping watcher (${label})...`);
  }
  if (dashboardState.status === "running") {
    console.log(`  Stopping dashboard (PID ${dashboardState.pid})...`);
  }

  await stopAll();
  console.log("  Stopped.");
}
