import { loadConfig, configDir } from "../config";
import { Store } from "../store";
import { allAdapters } from "../adapters/registry";
import { createSink } from "../sinks/registry";
import { FileWatcher } from "../watcher";
import { autoTagSession } from "../tagger";
import type { Adapter, WatchEvent } from "../adapters/types";
import type { Sink, PushPayload } from "../sinks/types";
import { mkdirSync, existsSync, copyFileSync, writeFileSync, readFileSync, unlinkSync, appendFileSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";

const PID_FILE = join(configDir(), "jin.pid");
const LOG_FILE = join(configDir(), "jin.log");

export async function watchCommand(opts: { daemon?: boolean }): Promise<void> {
  const { isServiceActive, isDaemonRunning, isServiceInstalled } = await import("../runguard");

  // Block if OS service is running — but not if WE are the service
  // systemd sets INVOCATION_ID and JOURNAL_STREAM for managed processes
  const launchedByService = !!(process.env.INVOCATION_ID || process.env.JOURNAL_STREAM);
  if (!launchedByService && isServiceActive()) {
    console.log(`  jin is already running as an OS service.`);
    console.log(`  Use \`jin service uninstall\` to remove it first, or \`jin service status\` for details.`);
    process.exit(1);
  }

  // Daemon mode: fork to background
  if (opts.daemon) {
    // Check if already running before forking
    if (isRunning()) {
      const pid = readFileSync(PID_FILE, "utf-8").trim();
      console.log(`  jin is already running (PID ${pid}). Use \`jin stop\` first.`);
      process.exit(1);
    }
    // Warn if service is installed but not active (could start on reboot)
    if (isServiceInstalled()) {
      console.log(`  Warning: jin OS service is installed but not active.`);
      console.log(`  The service may start on reboot and conflict with this daemon.`);
      console.log(`  Consider using \`jin service install\` instead, or \`jin service uninstall\` to remove it.\n`);
    }
    return daemonize();
  }

  // Check if already running
  if (isRunning()) {
    const pid = readFileSync(PID_FILE, "utf-8").trim();
    console.log(`  jin is already running (PID ${pid}). Use \`jin stop\` first.`);
    process.exit(1);
  }

  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  if (!existsSync(config.store.rawDir)) {
    mkdirSync(config.store.rawDir, { recursive: true });
  }

  // Write PID file
  writeFileSync(PID_FILE, String(process.pid));

  const log = (msg: string) => {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    const line = `[${ts}] ${msg}`;
    console.log(`  ${line}`);
    try { appendFileSync(LOG_FILE, line + "\n"); } catch {}
  };

  // Set up sinks
  const sinks: Sink[] = [];
  for (const sinkConfig of config.sinks || []) {
    try {
      const sink = createSink(sinkConfig);
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

  if (activeAdapters.length === 0) {
    log("No active adapters detected. Run `jin init` first.");
    cleanup();
    process.exit(1);
  }

  console.log(`jin watch — monitoring ${activeAdapters.length} tool(s), ${sinks.length} sink(s)\n`);
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
    await pushToSinks(store, sinks, changedSessions, log);
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
      await pushToSinks(store, sinks, ids, log);
    }, PUSH_DEBOUNCE_MS);
  };

  // Set up file watcher
  const watcher = new FileWatcher({
    debounceMs: config.watch.debounceMs,
    onChange: async (event: WatchEvent) => {
      const adapter = activeAdapters.find((a) => a.id === event.adapterId);
      if (!adapter) return;

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

  // Periodic sync for sinks (catch anything the watcher missed)
  const periodicInterval = config.watch.pollIntervalMs || 30_000;
  const periodicTimer = setInterval(async () => {
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
  // For compiled binaries, resolve the real path on disk
  const { realpathSync } = await import("fs");
  let exe: string;
  try {
    exe = realpathSync("/proc/self/exe");
  } catch {
    exe = process.execPath;
  }

  const logFd = require("fs").openSync(LOG_FILE, "a");

  const proc = Bun.spawn([exe, "watch"], {
    stdout: logFd,
    stderr: logFd,
    stdin: "ignore",
    env: { ...process.env },
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

/** Push changed sessions to all sinks */
async function pushToSinks(
  store: Store,
  sinks: Sink[],
  sessionIds: Set<string>,
  log: (msg: string) => void
): Promise<void> {
  const payloads: PushPayload[] = [];
  for (const id of sessionIds) {
    const session = store.getSession(id);
    if (!session) continue;
    const messages = store.getMessages(id);
    payloads.push({ session, messages });
  }

  if (payloads.length === 0) return;

  for (const sink of sinks) {
    try {
      const result = await sink.push(payloads);
      log(`Pushed ${result.pushed} to ${sink.name}${result.failed ? `, ${result.failed} failed` : ""}`);
      if (result.errors.length > 0) {
        for (const e of result.errors.slice(0, 3)) log(`  Error: ${e}`);
      }
    } catch (err) {
      log(`Push error (${sink.name}): ${err}`);
    }
  }
}

/** Ingest adapter, return list of session IDs that were ingested */
async function ingestAdapter(adapter: Adapter, store: Store, rawDir: string): Promise<string[]> {
  const ingested: string[] = [];
  try {
    const sessions = await adapter.sessions();
    for (const session of sessions) {
      store.upsertSession(session);
      ingested.push(session.id);

      if (session.sourcePath && existsSync(session.sourcePath)) {
        try {
          const dest = join(rawDir, adapter.id, `${session.id}${getExt(session.sourcePath)}`);
          const destDir = join(rawDir, adapter.id);
          if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

          const content = await Bun.file(session.sourcePath).arrayBuffer();
          const hash = createHash("sha256").update(Buffer.from(content)).digest("hex");

          const existing = store.getSession(session.id);
          if (!existing?.metadata || (existing.metadata as any).fileHash !== hash) {
            copyFileSync(session.sourcePath, dest);
            session.metadata = { ...session.metadata, fileHash: hash, rawCopyPath: dest };
            store.upsertSession(session);
          }
        } catch {}
      }

      try {
        const messages = await adapter.messages(session.id);
        if (messages.length > 0) {
          store.upsertMessages(session.id, messages);
          autoTagSession(store, session, messages);
        }
      } catch {}
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
