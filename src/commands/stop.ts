import {
  stopWatcher,
  getWatcherState,
} from "../daemon/process-state";

export async function stopCommand(opts?: {
  watcher?: boolean;
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

  // Default: stop everything
  const watcherState = getWatcherState();

  if (watcherState.status === "stopped") {
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
