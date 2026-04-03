import {
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

    const label =
      state.mode === "service"
        ? "service manager"
        : state.mode === "foreground"
          ? `foreground PID ${state.pid}`
          : `PID ${state.pid}`;
    console.log(`  Requesting watcher shutdown (${label})...`);
    const result = await stopWatcher();
    if (!result.requested) {
      console.log("  Watcher is not running.");
      return;
    }
    if (result.completed) {
      const suffix = result.forced ? " after forcing shutdown." : ".";
      console.log(`  Watcher stopped${suffix}`);
    } else if (result.via === "service") {
      console.log("  Service stop requested. The runtime is still stopping.");
      console.log("  Use your service manager or `jin status` to watch for completion.");
    } else {
      console.log("  Shutdown requested. The runtime is still stopping.");
      console.log("  Run `jin status` to monitor progress.");
    }
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
    console.log("  jin is already stopped.");
    return;
  }

  let watcherResult:
    | Awaited<ReturnType<typeof stopWatcher>>
    | null = null;

  if (watcherState.status === "running") {
    const label =
      watcherState.mode === "service"
        ? "service manager"
        : watcherState.mode === "foreground"
          ? `foreground PID ${watcherState.pid}`
          : `PID ${watcherState.pid}`;
    console.log(`  Requesting watcher shutdown (${label})...`);
    watcherResult = await stopWatcher();
  }
  if (dashboardState.status === "running") {
    console.log(`  Stopping dashboard (PID ${dashboardState.pid})...`);
    await stopDashboard();
    console.log("  Dashboard stopped.");
  }

  if (!watcherResult) {
    return;
  }

  if (watcherResult.completed) {
    const suffix = watcherResult.forced ? " after forcing shutdown." : ".";
    console.log(`  Watcher stopped${suffix}`);
    return;
  }

  if (watcherResult.via === "service") {
    console.log("  Service stop requested. The runtime is still stopping.");
    console.log("  Use your service manager or `jin status` to watch for completion.");
    return;
  }

  console.log("  Shutdown requested. The runtime is still stopping.");
  console.log("  Run `jin status` to monitor progress.");
}
