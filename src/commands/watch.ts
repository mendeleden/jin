import {
  configDir,
  configPath,
  loadConfig,
  resolveAdapterConfig,
  type JinConfig,
} from "../config";
import type { Adapter as V2Adapter } from "../contracts/adapters";
import type { Sink as V2Sink } from "../contracts/sinks";
import { allAdapters, protectedSourceStartupNotices, startupProbeBlocked } from "../adapters/registry";
import { openStoreAtPath, type SqliteConversationStore } from "../db/store";
import { daemonize } from "../daemon/daemonize";
import { runPipeline } from "../pipeline/loop";
import type { PipelineHandle, PipelineLogger } from "../pipeline/types";
import { createSink } from "../sinks/registry";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

type RuntimeLog = (message: string) => void;

export async function watchCommand(opts: { daemon?: boolean }): Promise<void> {
  const {
    getRuntimePaths,
    isServiceActive,
    isServiceInstalled,
  } = await import("../daemon/runtime-state");

  // Block if OS service is running — but not if WE are the service
  // JIN_LAUNCHED_BY_SERVICE is set in both the systemd unit and launchd plist.
  const launchedByService = !!(
    process.env.JIN_LAUNCHED_BY_SERVICE ||
    process.env.INVOCATION_ID ||
    process.env.JOURNAL_STREAM
  );
  if (!launchedByService && isServiceActive()) {
    console.log("  jin is already running as an OS service.");
    console.log("  Use `jin service uninstall` to remove it first, or `jin service status` for details.");
    process.exit(1);
  }

  // Daemon mode: fork to background (used internally by startCommand).
  if (opts.daemon) {
    if (isRunning()) {
      const pid = readFileSync(pidFilePath(), "utf-8").trim();
      console.log(`  Watcher already running (PID ${pid}).`);
      return;
    }
    if (isServiceInstalled()) {
      console.log("  Note: OS service is installed but not active.");
      console.log("  Consider `jin start --service` instead.\n");
    }
    return daemonize();
  }

  // Foreground mode: error if daemon is already running.
  // Skip check if we ARE the daemon (spawned by daemonize() which already wrote our PID).
  if (!process.env.JIN_DAEMON && isRunning()) {
    const pid = readFileSync(pidFilePath(), "utf-8").trim();
    console.log(`  jin is already running (PID ${pid}). Stop it first with \`jin stop\`.`);
    process.exit(1);
  }

  const config = await loadConfig();
  const protectedSourceNotices = protectedSourceStartupNotices(config.adapters);
  const log = createRuntimeLogger(!!process.env.JIN_DAEMON);
  const sinks = await createActiveSinks(config, log);
  const activeAdapters = await detectActiveAdapters(config);

  if (activeAdapters.length === 0) {
    log("No supported coding tools detected. Open a supported tool, then rerun `jin start`.");
    logProtectedSourceStartupNotices(log, protectedSourceNotices);
    await closeSinks(sinks);
    cleanup();
    process.exit(1);
  }

  logProtectedSourceStartupNotices(log, protectedSourceNotices);

  // Non-blocking update check on startup.
  import("../updater")
    .then(({ checkForUpdate }) =>
      checkForUpdate().then((update) => {
        if (update?.available) {
          log(
            `Update available: ${update.current} -> ${update.latest}. Run \`jin update\` to upgrade.`,
          );
        }
      }),
    )
    .catch(() => {});

  const runtimePaths = getRuntimePaths();
  const store = openStoreAtPath(runtimePaths.storePath);
  writeFileSync(pidFilePath(), String(process.pid));

  console.log(
    `jin start --foreground — local daemon monitoring ${activeAdapters.length} tool(s), ${sinks.length} sink(s)\n`,
  );
  for (const adapter of activeAdapters) {
    console.log(`  [~] ${adapter.name}`);
  }
  if (sinks.length > 0) {
    for (const sink of sinks) {
      console.log(`  [>] ${sink.name}`);
    }
  }
  console.log("");

  Bun.gc(true);
  const pipelineHandle = await startPipeline(config, store, sinks, log, activeAdapters);
  await runUntilShutdown(pipelineHandle, store, log);
}

async function startPipeline(
  config: JinConfig,
  store: SqliteConversationStore,
  sinks: V2Sink[],
  log: RuntimeLog,
  initialAdapters: V2Adapter[],
): Promise<PipelineHandle> {
  let useInitialAdapters = true;

  try {
    const handle = await runPipeline({
      adapterSource: async () => {
        if (useInitialAdapters) {
          useInitialAdapters = false;
          return initialAdapters;
        }
        return detectActiveAdapters(config);
      },
      store,
      sinks,
      routes: config.routes,
      scanIntervalMs: config.watch.pollIntervalMs,
      watchDebounceMs: config.watch.debounceMs,
      // Runtime push batches stay tiny so the live Codex workload can drain
      // store->sink work without pinning a full multi-conversation batch.
      pushBatchSize: 2,
      scheduleStartupWork: false,
      deferWatcherStart: true,
      logger: toPipelineLogger(log),
    });
    for (const adapter of initialAdapters) {
      handle.enqueue({
        kind: "ingest-adapter",
        adapterId: adapter.id,
        hint: { kind: "startup-scan" },
      });
    }
    return handle;
  } catch (error) {
    await closeSinks(sinks);
    store.close();
    cleanup();
    throw error;
  }
}

async function runUntilShutdown(
  pipelineHandle: PipelineHandle,
  store: SqliteConversationStore,
  log: RuntimeLog,
): Promise<void> {
  let shuttingDown = false;
  let complete = false;
  let resolveStopped: () => void = () => {};
  let rejectStopped: (error: unknown) => void = () => {};
  const stopped = new Promise<void>((resolve, reject) => {
    resolveStopped = resolve;
    rejectStopped = reject;
  });

  const onSigint = () => {
    void shutdown("SIGINT");
  };
  const onSigterm = () => {
    void shutdown("SIGTERM");
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);

    log(`Shutting down (${signal})...`);
    try {
      const result = await pipelineHandle.shutdown();
      store.close();
      cleanup();

      if (result.timedOut) {
        log("Shutdown budget exceeded — abandoning in-flight work.");
        finishWithExit(1);
        return;
      }
      finishWithExit(0);
      return;
    } catch (error) {
      store.close();
      cleanup();
      log(`Shutdown failed: ${formatError(error)}`);
      finishWithExit(1, error);
      return;
    }
  }

  await stopped;

  function finishWithExit(code: number, fallbackError?: unknown): void {
    if (complete) {
      return;
    }
    complete = true;

    try {
      process.exit(code);
      resolveStopped();
    } catch (error) {
      rejectStopped(fallbackError ?? error);
    }
  }
}

async function createActiveSinks(
  config: JinConfig,
  log: RuntimeLog,
): Promise<V2Sink[]> {
  const sinks: V2Sink[] = [];

  for (let index = 0; index < (config.sinks || []).length; index += 1) {
    const sinkConfig = config.sinks[index];
    try {
      const sink = createSink(
        sinkConfig,
        index,
      ) as unknown as V2Sink & { enabled?: boolean };

      sink.enabled = sinkConfig.enabled !== false;

      if (sink.enabled === false) {
        sinks.push(sink);
        log(`Sink disabled: ${sink.name}`);
        continue;
      }

      const health = await sink.healthCheck();
      if (health.ok) {
        sinks.push(sink);
        log(`Sink connected: ${sink.name}`);
      } else {
        log(`Sink failed: ${sink.name} — ${health.error}`);
      }
    } catch (error) {
      log(`Sink error: ${formatError(error)}`);
    }
  }

  return sinks;
}

async function detectActiveAdapters(config: JinConfig): Promise<V2Adapter[]> {
  const adapters = allAdapters(config.adapters);
  const activeAdapters: V2Adapter[] = [];

  for (const adapter of adapters) {
    if (resolveAdapterConfig(config.adapters, adapter.id).enabled === false) {
      continue;
    }
    if (startupProbeBlocked(adapter.id, config.adapters)) {
      continue;
    }

    try {
      if (await adapter.detect()) {
        activeAdapters.push(adapter as unknown as V2Adapter);
      }
    } catch {}
  }

  return activeAdapters;
}

function createRuntimeLogger(isDaemon: boolean): RuntimeLog {
  return (message: string) => {
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const line = `[${timestamp}] ${message}`;
    if (isDaemon) {
      console.log(line);
      return;
    }

    console.log(`  ${line}`);
    try {
      appendFileSync(logFilePath(), `${line}\n`);
    } catch {}
  };
}

function toPipelineLogger(log: RuntimeLog): PipelineLogger {
  return {
    info(message: string) {
      log(message);
    },
    warn(message: string) {
      log(`WARNING: ${message}`);
    },
    error(message: string, error?: unknown) {
      if (error === undefined) {
        log(`ERROR: ${message}`);
        return;
      }
      log(`ERROR: ${message} — ${formatError(error)}`);
    },
  };
}

function logProtectedSourceStartupNotices(
  log: RuntimeLog,
  notices: Array<{ summary: string }>,
): void {
  if (notices.length === 0) {
    return;
  }

  log("Protected/app-private startup sources were not probed without explicit opt-in.");
  for (const notice of notices) {
    log(notice.summary);
  }
  log(
    `Opt in via ${configPath()}: set adapters.<id>.allowProtectedSource = true or adapters.<id>.dataDir to a user-provided path, then restart with \`jin stop\` and \`jin start\`.`,
  );
}

async function closeSinks(sinks: ReadonlyArray<V2Sink>): Promise<void> {
  await Promise.allSettled(
    sinks.map(async (sink) => {
      try {
        await sink.close();
      } catch {}
    }),
  );
}

function isRunning(): boolean {
  const pidPath = pidFilePath();
  if (!existsSync(pidPath)) {
    return false;
  }

  try {
    const pid = Number.parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    cleanup();
    return false;
  }
}

function cleanup(): void {
  try {
    unlinkSync(pidFilePath());
  } catch {}
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function pidFilePath(): string {
  return join(configDir(), "jin.pid");
}

function logFilePath(): string {
  return join(configDir(), "jin.log");
}
