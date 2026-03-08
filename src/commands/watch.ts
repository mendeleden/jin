import { loadConfig, saveConfig, configDir } from "../config";
import type { JinConfig } from "../config";
import { Store } from "../store";
import { allAdapters } from "../adapters/registry";
import { createSink } from "../sinks/registry";
import { FileWatcher } from "../watcher";
import { autoTagSession } from "../tagger";
import { sinksForSession } from "../routing";
import type { Adapter, WatchEvent } from "../adapters/types";
import type { Sink, PushPayload } from "../sinks/types";
import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync, appendFileSync, statSync } from "fs";
import { join, basename } from "path";

const PID_FILE = join(configDir(), "jin.pid");
const LOG_FILE = join(configDir(), "jin.log");

export async function watchCommand(opts: { daemon?: boolean }): Promise<void> {
  const { isServiceActive, isDaemonRunning, isServiceInstalled } = await import("../runguard");

  // Block if OS service is running — but not if WE are the service
  // JIN_LAUNCHED_BY_SERVICE is set in both the systemd unit and launchd plist
  const launchedByService = !!(process.env.JIN_LAUNCHED_BY_SERVICE || process.env.INVOCATION_ID || process.env.JOURNAL_STREAM);
  if (!launchedByService && isServiceActive()) {
    console.log(`  jin is already running as an OS service.`);
    console.log(`  Use \`jin service uninstall\` to remove it first, or \`jin service status\` for details.`);
    process.exit(1);
  }

  // Daemon mode: fork to background (used internally by startCommand)
  if (opts.daemon) {
    // Internal call from startCommand
    if (isRunning()) {
      const pid = readFileSync(PID_FILE, "utf-8").trim();
      console.log(`  Watcher already running (PID ${pid}).`);
      return;
    }
    if (isServiceInstalled()) {
      console.log(`  Note: OS service is installed but not active.`);
      console.log(`  Consider \`jin start --service\` instead.\n`);
    }
    return daemonize();
  }

  // Foreground mode: error if daemon is already running
  if (isRunning()) {
    const pid = readFileSync(PID_FILE, "utf-8").trim();
    console.log(`  jin is already running (PID ${pid}). Stop it first with \`jin stop\`.`);
    process.exit(1);
  }

  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  if (!existsSync(config.store.rawDir)) {
    mkdirSync(config.store.rawDir, { recursive: true });
  }

  // Write PID file
  writeFileSync(PID_FILE, String(process.pid));

  // When daemonized, stdout is already redirected to LOG_FILE by daemonize().
  // Only use appendFileSync in foreground mode where stdout goes to terminal.
  const isDaemon = !!process.env.JIN_DAEMON;
  const log = (msg: string) => {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    const line = `[${ts}] ${msg}`;
    if (isDaemon) {
      console.log(line);
    } else {
      console.log(`  ${line}`);
      try { appendFileSync(LOG_FILE, line + "\n"); } catch {}
    }
  };

  // Set up sinks
  const sinks: Sink[] = [];
  for (let i = 0; i < (config.sinks || []).length; i++) {
    const sinkConfig = config.sinks[i];
    try {
      const sink = createSink(sinkConfig, i);
      const health = await sink.healthCheck();
      if (health.ok) {
        sinks.push(sink);
        log(`Sink connected: ${sink.name}`);
      } else {
        log(`Sink failed: ${sink.name} — ${health.error}`);
      }
    } catch (err) {
      log(`Sink error: ${err}`);
    }
  }

  // Detect adapters
  const adapters = allAdapters();
  const activeAdapters: Adapter[] = [];

  for (const adapter of adapters) {
    if (!config.adapters[adapter.id]?.enabled) continue;
    try {
      if (await adapter.detect()) {
        activeAdapters.push(adapter);
      }
    } catch {}
  }

  // Auto-detect newly installed tools that were previously disabled
  for (const adapter of adapters) {
    if (config.adapters[adapter.id]?.enabled) continue; // already handled
    try {
      if (await adapter.detect()) {
        activeAdapters.push(adapter);
        config.adapters[adapter.id] = { enabled: true };
        log(`New tool detected: ${adapter.name} — auto-enabled`);
      }
    } catch {}
  }
  if (Object.values(config.adapters).some((a) => a.enabled)) {
    await saveConfig(config);
  }

  if (activeAdapters.length === 0) {
    log("No active adapters detected. Run `jin init` first.");
    cleanup();
    process.exit(1);
  }

  // Non-blocking update check on daemon start
  import("../updater").then(({ checkForUpdate }) =>
    checkForUpdate().then((u) => {
      if (u?.available) {
        log(`Update available: ${u.current} -> ${u.latest}. Run \`jin update\` to upgrade.`);
      }
    })
  ).catch(() => {});

  console.log(`jin start --foreground — monitoring ${activeAdapters.length} tool(s), ${sinks.length} sink(s)\n`);
  for (const a of activeAdapters) {
    console.log(`  [~] ${a.name}`);
  }
  if (sinks.length > 0) {
    for (const s of sinks) {
      console.log(`  [>] ${s.name}`);
    }
  }
  console.log("");

  // Initial ingest + push
  log("Initial ingest...");
  const changedSessions = new Set<string>();
  for (const adapter of activeAdapters) {
    const ingested = await ingestAdapter(adapter, store, config.store.rawDir);
    for (const id of ingested) changedSessions.add(id);
  }
  log(`Ingested ${store.sessionCount()} sessions, ${store.messageCount()} messages.`);

  // Initial push
  if (sinks.length > 0 && changedSessions.size > 0) {
    await pushToSinks(store, sinks, changedSessions, config, log);
  }

  log("Watching for changes... (Ctrl+C to stop)");
  console.log("");

  // Debounced sink push — batch changes over a window before pushing
  let pushTimer: Timer | null = null;
  const pendingPush = new Set<string>();
  const PUSH_DEBOUNCE_MS = config.watch.debounceMs * 5 || 1000;

  const schedulePush = () => {
    if (sinks.length === 0) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      pushTimer = null;
      if (pendingPush.size === 0) return;
      const ids = new Set(pendingPush);
      pendingPush.clear();
      await pushToSinks(store, sinks, ids, config, log);
    }, PUSH_DEBOUNCE_MS);
  };

  // Build a set of paths to exclude from watching to prevent feedback loops.
  // When jin watches its own active session directory, every ingest/push cycle
  // triggers new watch events, creating a runaway loop.
  const excludePaths = new Set<string>();
  // Exclude the jin project directory itself (this process is running in it)
  const cwdSlug = process.cwd().replace(/\//g, "-").replace(/^-/, "-");
  // Also detect via environment
  if (process.env.CLAUDE_PROJECT_DIR) {
    excludePaths.add(process.env.CLAUDE_PROJECT_DIR);
  }

  // Set up file watcher
  const watcher = new FileWatcher({
    debounceMs: config.watch.debounceMs,
    onChange: async (event: WatchEvent) => {
      const adapter = activeAdapters.find((a) => a.id === event.adapterId);
      if (!adapter) return;

      // Skip events from jin's own project directory to prevent feedback loop:
      // file change → ingest → push → log → repeat
      if (excludePaths.size > 0) {
        const skip = [...excludePaths].some(p => event.path.includes(p));
        if (skip) return;
      }
      // Also skip if the path contains the cwd slug (jin watching its own project)
      if (cwdSlug && event.path.includes(cwdSlug)) return;

      log(`${event.type} — ${adapter.name}: ${basename(event.path)}`);

      // Re-ingest
      const ingested = await ingestAdapter(adapter, store, config.store.rawDir);
      for (const id of ingested) pendingPush.add(id);

      // Schedule batched push to sinks
      schedulePush();
    },
  });

  for (const adapter of activeAdapters) {
    for (const path of adapter.watchPaths()) {
      watcher.addPath(path, adapter.id);
    }
  }

  // RSS kill switch: self-terminate if memory exceeds safe limit
  const RSS_WARN_MB = 200;
  const RSS_MAX_MB = 256;
  const checkMemory = () => {
    const rssMB = process.memoryUsage.rss() / (1024 * 1024);
    if (rssMB > RSS_MAX_MB) {
      log(`CRITICAL: RSS ${Math.round(rssMB)} MB exceeds ${RSS_MAX_MB} MB limit — exiting`);
      store.close();
      cleanup();
      process.exit(1);
    } else if (rssMB > RSS_WARN_MB) {
      log(`WARNING: RSS ${Math.round(rssMB)} MB approaching ${RSS_MAX_MB} MB limit`);
    }
  };

  // Periodic sync for sinks (catch anything the watcher missed)
  const periodicInterval = config.watch.pollIntervalMs || 30_000;
  const periodicTimer = setInterval(async () => {
    checkMemory();
    if (sinks.length === 0) return;
    for (const adapter of activeAdapters) {
      const ingested = await ingestAdapter(adapter, store, config.store.rawDir);
      for (const id of ingested) pendingPush.add(id);
    }
    if (pendingPush.size > 0) schedulePush();
  }, periodicInterval);

  // Graceful shutdown
  const shutdown = () => {
    log("Shutting down...");
    if (pushTimer) clearTimeout(pushTimer);
    clearInterval(periodicTimer);
    watcher.close();
    for (const s of sinks) s.close();
    store.close();
    cleanup();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep alive
  await new Promise(() => {});
}

/** Fork to background */
async function daemonize(): Promise<void> {
  // Resolve how to spawn ourselves
  const { realpathSync } = await import("fs");
  let exe: string;
  try {
    exe = realpathSync("/proc/self/exe");
  } catch {
    exe = process.execPath;
  }

  // Detect if running as compiled binary or via bun
  const isCompiled = !exe.endsWith("bun") && !exe.endsWith("node");
  const cmd = isCompiled
    ? [exe, "start", "--foreground"]
    : [exe, "run", process.argv[1], "start", "--foreground"];

  const logFd = require("fs").openSync(LOG_FILE, "a");

  const proc = Bun.spawn(cmd, {
    stdout: logFd,
    stderr: logFd,
    stdin: "ignore",
    env: { ...process.env, JIN_DAEMON: "1" },
  });

  require("fs").closeSync(logFd);

  // Wait a moment to check it started
  await Bun.sleep(500);
  if (proc.exitCode !== null) {
    console.error("  Failed to start daemon. Check logs at:", LOG_FILE);
    process.exit(1);
  }

  writeFileSync(PID_FILE, String(proc.pid));
  console.log(`  jin daemon started (PID ${proc.pid})`);
  console.log(`  Logs: ${LOG_FILE}`);
  console.log(`  Stop: jin stop`);

  // Detach — let the spawned process run independently
  proc.unref();
}

/** Push changed sessions to sinks, respecting per-project routing.
 *  Uses push_log to skip sessions that haven't changed since last successful push. */
async function pushToSinks(
  store: Store,
  sinks: Sink[],
  sessionIds: Set<string>,
  config: JinConfig,
  log: (msg: string) => void
): Promise<void> {
  // Group payloads by which sinks they should go to
  const sinkPayloads = new Map<Sink, PushPayload[]>();

  // Pre-compute which sessions actually need pushing per sink
  const needsPush = new Map<string, Set<string>>();
  for (const sink of sinks) {
    needsPush.set(sink.id, store.sessionsNeedingPush(sink.id));
  }

  for (const id of sessionIds) {
    const session = store.getSession(id);
    if (!session) continue;

    // Determine which sinks this session routes to
    const targetSinks = sinksForSession(session, store, config, sinks);
    for (const sink of targetSinks) {
      // Skip if this session hasn't changed since last successful push to this sink
      const sinkNeeds = needsPush.get(sink.id);
      if (sinkNeeds && !sinkNeeds.has(id)) continue;

      if (!sinkPayloads.has(sink)) sinkPayloads.set(sink, []);
      const allMessages = store.getMessages(id);
      // Delta push: only for sinks that support merge semantics (e.g. Postgres ON CONFLICT).
      // Sinks like S3 (last-write-wins) must always receive ALL messages.
      let messages = allMessages;
      if (sink.supportsDelta) {
        const lastCount = store.lastPushedMessageCount(id, sink.id);
        if (lastCount > 0 && lastCount < allMessages.length) {
          messages = allMessages.slice(lastCount);
        }
      }
      sinkPayloads.get(sink)!.push({ session, messages });
    }
  }

  for (const [sink, payloads] of sinkPayloads) {
    if (payloads.length === 0) continue;
    try {
      const result = await sink.push(payloads);
      log(`Pushed ${result.pushed} to ${sink.name}${result.failed ? `, ${result.failed} failed` : ""}`);

      // Log successful pushes with total message count so we can delta-push next time
      for (const { session } of payloads) {
        const totalMsgCount = store.getMessages(session.id).length;
        store.logPush(session.id, sink.id, 200, "ok", totalMsgCount);
      }

      if (result.errors.length > 0) {
        for (const e of result.errors.slice(0, 3)) log(`  Error: ${e}`);
      }
    } catch (err) {
      log(`Push error (${sink.name}): ${err}`);
    }
  }
}

// Track file stat to skip re-reading unchanged files during periodic ingest.
// Key: filePath, Value: { size, mtimeMs } from last successful ingest.
const ingestStatCache = new Map<string, { size: number; mtimeMs: number }>();

/** Ingest adapter, return list of session IDs that were ingested */
async function ingestAdapter(adapter: Adapter, store: Store, rawDir: string): Promise<string[]> {
  const ingested: string[] = [];
  try {
    const sessions = await adapter.sessions();
    for (const session of sessions) {
      store.upsertSession(session);

      // Skip if the source file hasn't changed (stat-based)
      if (session.sourcePath && existsSync(session.sourcePath)) {
        const stat = statSync(session.sourcePath);
        const cached = ingestStatCache.get(session.sourcePath);
        if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
          continue;
        }

        // File changed (or first time)
        ingested.push(session.id);

        // Insert only NEW messages (delta), not all messages
        try {
          const existingCount = store.messageCountForSession(session.id);
          if (existingCount > 0 && 'newMessages' in adapter) {
            // Adapter supports delta — only parse and insert new messages
            const newMsgs = await (adapter as any).newMessages(session.id, session.sourcePath, existingCount);
            if (newMsgs.length > 0) {
              store.insertMessages(session.id, newMsgs);
              // Re-tag with all messages only if needed
              const allMsgs = store.getMessages(session.id);
              autoTagSession(store, session, allMsgs);
            }
          } else {
            // Fallback: full message parse (first ingest or non-supporting adapter)
            const messages = await adapter.messages(session.id, session.sourcePath);
            if (messages.length > 0) {
              store.upsertMessages(session.id, messages);
              autoTagSession(store, session, messages);
            }
          }
        } catch {}

        ingestStatCache.set(session.sourcePath, { size: stat.size, mtimeMs: stat.mtimeMs });
      } else {
        ingested.push(session.id);
        try {
          const messages = await adapter.messages(session.id, session.sourcePath);
          if (messages.length > 0) {
            store.upsertMessages(session.id, messages);
            autoTagSession(store, session, messages);
          }
        } catch {}
      }
    }
  } catch {}
  return ingested;
}

function getExt(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

function isRunning(): boolean {
  if (!existsSync(PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
    process.kill(pid, 0); // signal 0 = check if alive
    return true;
  } catch {
    // PID file exists but process is dead — clean up
    cleanup();
    return false;
  }
}

function cleanup(): void {
  try { unlinkSync(PID_FILE); } catch {}
}
