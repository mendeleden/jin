import {
  configDir,
  configPath,
  discoveryCachePath,
  loadRuntimeConfigGeneration,
  loadStartupConfig,
  resolveAdapterConfig,
  type JinConfig,
} from "../config";
import type { Adapter as V2Adapter } from "../contracts/adapters";
import type { Sink as V2Sink } from "../contracts/sinks";
import { allAdapters, protectedSourceStartupNotices, startupProbeBlocked } from "../adapters/registry";
import { createLocalControlBoundary } from "../api/control";
import { startLocalApiServer, type LocalApiServer } from "../api/server";
import { SqliteDiscoveryCache } from "../db/discovery-cache";
import { openStoreAtPath, type SqliteConversationStore } from "../db/store";
import { daemonize } from "../daemon/daemonize";
import { appendDiagnosticEvent } from "../pipeline/diagnostic";
import { runPipeline } from "../pipeline/loop";
import type { PipelineHandle, PipelineLogger } from "../pipeline/types";
import { createSink } from "../sinks/registry";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "fs";
import { basename, join } from "path";
import { resolveSelfCommand } from "../runtime/self-command";

type RuntimeLog = (message: string) => void;
const CONFIG_RELOAD_WATCH_DEBOUNCE_MS = 150;

export async function watchCommand(opts: { daemon?: boolean }): Promise<void> {
  const {
    getRuntimeStatus,
    getRuntimePaths,
    isServiceInstalled,
  } = await import("../daemon/runtime-state");

  // Block if OS service is running — but not if WE are the service
  // JIN_LAUNCHED_BY_SERVICE is set in both the systemd unit and launchd plist.
  const launchedByService = !!(
    process.env.JIN_LAUNCHED_BY_SERVICE ||
    process.env.INVOCATION_ID ||
    process.env.JOURNAL_STREAM
  );
  const runtime = getRuntimeStatus();
  if (!launchedByService && runtime.owner?.mode === "service" && runtime.state !== "stopped") {
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

  const config = await loadStartupConfig();
  const protectedSourceNotices = protectedSourceStartupNotices(config.adapters);
  const log = createRuntimeLogger(!!process.env.JIN_DAEMON);
  const diagnosticPath =
    process.env.JIN_DIAGNOSTIC_LOG || join(configDir(), "debug.jsonl");
  const sinks = await createActiveSinks(config, log);
  const activeAdapters = await detectActiveAdapters(config, diagnosticPath);

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
  const discoveryCache = openDiscoveryCache(log);
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
  const pipelineHandle = await startPipeline(
    config,
    store,
    discoveryCache,
    sinks,
    log,
    activeAdapters,
    diagnosticPath,
  );
  let apiServer: LocalApiServer | null = null;

  try {
    apiServer = startLocalApiServer({
      queryStore: store,
      controlBoundary: createLocalControlBoundary({
        requestConfigReload: () => pipelineHandle.reloadConfig("command"),
      }),
      socketPath: runtimePaths.socketPath,
    });
  } catch (error) {
    await pipelineHandle.shutdown();
    store.close();
    discoveryCache?.close();
    cleanup();
    throw error;
  }

  if (apiServer) {
    log(`Local daemon query socket ready at ${apiServer.socketPath}`);
  } else {
    log("Local daemon query socket is not available on this platform yet.");
  }

  await runUntilShutdown(pipelineHandle, store, discoveryCache, log, apiServer);
}

async function startPipeline(
  config: JinConfig,
  store: SqliteConversationStore,
  discoveryCache: SqliteDiscoveryCache | null,
  sinks: V2Sink[],
  log: RuntimeLog,
  initialAdapters: V2Adapter[],
  diagnosticPath: string,
): Promise<PipelineHandle> {
  let currentConfig = config;
  let currentSinks = sinks;
  let useInitialAdapters = true;

  try {
    const handle = await runPipeline({
      adapterSource: async () => {
        if (useInitialAdapters) {
          useInitialAdapters = false;
          return initialAdapters;
        }
        return detectActiveAdapters(currentConfig, diagnosticPath);
      },
      store,
      sinks: currentSinks,
      routes: currentConfig.routes,
      getSinks: () => currentSinks,
      getRoutes: () => currentConfig.routes,
      getScanIntervalMs: () => currentConfig.watch.pollIntervalMs,
      shouldContinueSinkPush: (sinkId) => diskConfigAllowsSinkPush(sinkId, log),
      scanIntervalMs: currentConfig.watch.pollIntervalMs,
      watchDebounceMs: currentConfig.watch.debounceMs,
      // Runtime push batches stay tiny so the live Codex workload can drain
      // store->sink work without pinning a full multi-conversation batch.
      pushBatchSize: 2,
      scheduleStartupWork: false,
      deferWatcherStart: true,
      logger: toPipelineLogger(log),
      diagnosticLogPath: diagnosticPath,
      onConfigReload: async (source) => {
        const next = await reloadRuntimeConfig(currentConfig, currentSinks, {
          source,
          log,
        });
        if (!next) {
          return false;
        }

        currentConfig = next.config;
        currentSinks = next.sinks;
        return true;
      },
      workerIngest: {
        command: resolveSelfCommand(),
        adapterConfigs: currentConfig.adapters,
        getAdapterConfigs: () => currentConfig.adapters,
      },
      ...(discoveryCache
        ? {
            discoveryCache: {
              store: discoveryCache,
              adapterConfigs: currentConfig.adapters,
              getAdapterConfigs: () => currentConfig.adapters,
            },
          }
        : {}),
    });
    const configWatcher = watchConfigFile(() => {
      handle.reloadConfig("config-file");
    }, log);
    for (const adapter of initialAdapters) {
      handle.enqueue({
        kind: "ingest-adapter",
        adapterId: adapter.id,
        hint: { kind: "startup-scan" },
      });
    }
    return {
      enqueue: handle.enqueue,
      reloadConfig: handle.reloadConfig,
      waitForIdle: handle.waitForIdle,
      shutdown: async () => {
        configWatcher.close();
        return handle.shutdown();
      },
    };
  } catch (error) {
    await closeSinks(sinks);
    store.close();
    discoveryCache?.close();
    cleanup();
    throw error;
  }
}

async function runUntilShutdown(
  pipelineHandle: PipelineHandle,
  store: SqliteConversationStore,
  discoveryCache: SqliteDiscoveryCache | null,
  log: RuntimeLog,
  apiServer: LocalApiServer | null,
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
      apiServer?.stop();
      store.close();
      discoveryCache?.close();
      cleanup();

      if (result.timedOut) {
        log("Shutdown budget exceeded — abandoning in-flight work.");
        finishWithExit(1);
        return;
      }
      finishWithExit(0);
      return;
    } catch (error) {
      apiServer?.stop();
      store.close();
      discoveryCache?.close();
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

function openDiscoveryCache(log: RuntimeLog): SqliteDiscoveryCache | null {
  try {
    return new SqliteDiscoveryCache(discoveryCachePath());
  } catch (error) {
    log(
      `Discovery cache disabled: ${formatError(error)}`,
    );
    return null;
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

async function detectActiveAdapters(
  config: JinConfig,
  diagnosticPath?: string,
): Promise<V2Adapter[]> {
  const adapters = allAdapters(config.adapters);
  const activeAdapters: V2Adapter[] = [];
  const startedAt = performance.now();

  if (diagnosticPath) {
    appendDiagnosticEvent(diagnosticPath, {
      event: "detect:start",
      candidateIds: adapters.map((adapter) => adapter.id),
    });
  }

  for (const adapter of adapters) {
    if (resolveAdapterConfig(config.adapters, adapter.id).enabled === false) {
      if (diagnosticPath) {
        appendDiagnosticEvent(diagnosticPath, {
          event: "detect:adapter",
          adapterId: adapter.id,
          status: "disabled",
        });
      }
      continue;
    }
    if (startupProbeBlocked(adapter.id, config.adapters)) {
      if (diagnosticPath) {
        appendDiagnosticEvent(diagnosticPath, {
          event: "detect:adapter",
          adapterId: adapter.id,
          status: "blocked",
          reason: "protected-source-startup-blocked",
        });
      }
      continue;
    }

    try {
      const detected = await adapter.detect();
      if (diagnosticPath) {
        appendDiagnosticEvent(diagnosticPath, {
          event: "detect:adapter",
          adapterId: adapter.id,
          status: detected ? "detected" : "missing",
        });
      }
      if (detected) {
        activeAdapters.push(adapter as unknown as V2Adapter);
      }
    } catch (error) {
      if (diagnosticPath) {
        appendDiagnosticEvent(diagnosticPath, {
          event: "detect:adapter",
          adapterId: adapter.id,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (diagnosticPath) {
    appendDiagnosticEvent(diagnosticPath, {
      event: "detect:result",
      activeAdapterIds: activeAdapters.map((adapter) => adapter.id),
      activeAdapterCount: activeAdapters.length,
      durationMs: Math.round(performance.now() - startedAt),
    });
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
    `Opt in via ${configPath()}: set adapters.<id>.allowProtectedSource = true or adapters.<id>.dataDir to a user-provided path, then save the file. A running runtime will reload it shortly; otherwise restart with \`jin stop\` and \`jin start\`.`,
  );
}

async function reloadRuntimeConfig(
  currentConfig: JinConfig,
  currentSinks: ReadonlyArray<V2Sink>,
  options: {
    source: "config-file" | "command";
    log: RuntimeLog;
  },
): Promise<{ config: JinConfig; sinks: V2Sink[] } | null> {
  try {
    const nextConfig = await loadRuntimeConfigGeneration();
    if (JSON.stringify(nextConfig) === JSON.stringify(currentConfig)) {
      options.log("Config file changed, but the runtime view is unchanged.");
      return {
        config: currentConfig,
        sinks: [...currentSinks],
      };
    }

    const nextSinks = await createActiveSinks(nextConfig, options.log);
    await closeSinks(currentSinks);

    options.log(
      `Reloaded config from ${
        options.source === "command" ? "control event" : "config file"
      }: ${nextConfig.routes.length} route(s), ${nextSinks.length} sink(s).`,
    );
    return {
      config: nextConfig,
      sinks: nextSinks,
    };
  } catch (error) {
    options.log(`ERROR: Config reload failed; stopping runtime. ${formatError(error)}`);
    requestSelfShutdown();
    return null;
  }
}

async function diskConfigAllowsSinkPush(
  sinkId: string,
  log: RuntimeLog,
): Promise<boolean> {
  try {
    const nextConfig = await loadRuntimeConfigGeneration();
    const sinkConfig = nextConfig.sinks.find((sink) => sink.id === sinkId);
    return sinkConfig?.enabled !== false;
  } catch (error) {
    log(
      `WARNING: Stopping push while current config cannot be validated: ${formatError(error)}`,
    );
    return false;
  }
}

function requestSelfShutdown(): void {
  setTimeout(() => {
    try {
      process.kill(process.pid, "SIGTERM");
    } catch {
      process.exit(1);
    }
  }, 0);
}

function watchConfigFile(
  onChange: () => void,
  log: RuntimeLog,
): { close(): void } {
  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const watchedFilename = basename(configPath());

  try {
    watcher = watch(configDir(), (_eventType, filename) => {
      const reportedFilename = filename?.toString();
      if (reportedFilename && reportedFilename !== watchedFilename) {
        return;
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        onChange();
      }, CONFIG_RELOAD_WATCH_DEBOUNCE_MS);
    });
  } catch (error) {
    log(`WARNING: Config file watcher is unavailable; config changes will apply on restart only. ${formatError(error)}`);
  }

  return {
    close() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      watcher?.close();
      watcher = null;
    },
  };
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
