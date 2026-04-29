import { existsSync, readFileSync, statSync } from "fs";
import { configPath, discoveryCachePath, loadConfig } from "../config";
import type { JinConfig } from "../config";
import type { RuntimeStatus } from "../contracts/lifecycle";
import { SqliteDiscoveryCache } from "../db/discovery-cache";
import { openStoreAtPath } from "../db/store";
import { analyzeByAdapter, getOverviewSummary } from "../db/query-surface";
import { getAllState } from "../daemon/process-state";
import type { ComponentState } from "../daemon/process-state";
import {
  getRuntimePaths,
  getRuntimeStatus,
  isServiceInstalled,
  runModeLabel,
} from "../daemon/runtime-state";
import { readProgress } from "../progress";
import { readIngestActivity } from "../daemon/ingest-activity";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export async function statusCommand(opts?: {
  json?: boolean;
  short?: boolean;
}): Promise<void> {
  const config = await loadConfig();
  const runtime = getRuntimeStatus();
  const states = getAllState();
  const paths = getRuntimePaths();

  if (opts?.json) {
    return printJson(config, runtime, states, paths);
  }
  if (opts?.short) {
    return printShort(runtime, states);
  }
  return printFull(config, runtime, states, paths);
}

async function printJson(
  config: JinConfig,
  runtime: RuntimeStatus,
  states: ComponentState[],
  paths: ReturnType<typeof getRuntimePaths>,
): Promise<void> {
  const output: Record<string, unknown> = {
    runtime,
    components: states,
    paths: {
      config: paths.configPath,
      store: paths.storePath,
      log: paths.logPath,
      discoveryCache: discoveryCachePath(),
    },
  };

  const stats = readStoreStats(paths.storePath);
  if (stats) {
    output.sessions = stats.sessions;
    output.messages = stats.messages;
    output.adapters = stats.adapters;
    if (stats.totalCost > 0) {
      output.totalCost = stats.totalCost;
    }
  } else {
    output.sessions = 0;
    output.messages = 0;
    output.adapters = [];
  }

  output.sinks = (config.sinks || []).map((sink, index) => ({
    id: sink.id || `${sink.type}-${index}`,
    type: sink.type,
    enabled: sink.enabled !== false,
  }));
  output.routes = config.routes || [];
  output.discoveryCache = readDiscoveryCacheStatus(discoveryCachePath());

  const progress = readProgress();
  if (progress) {
    output.ingest = {
      adapter: progress.adapter,
      current: progress.current,
      total: progress.total,
      pct: Math.round((progress.current / progress.total) * 100),
    };
  }

  const activity = readIngestActivity();
  if (activity?.active) {
    const a = activity.active;
    const pct =
      a.totalRefs !== undefined && a.processedRefs !== undefined && a.totalRefs > 0
        ? Math.round((a.processedRefs / a.totalRefs) * 100)
        : null;
    output.activity = {
      adapter: a.adapter,
      coldStart: activity.coldStart,
      processedRefs: a.processedRefs ?? null,
      totalRefs: a.totalRefs ?? null,
      pct,
      currentSourcePath: a.currentSourcePath ?? null,
      queued: activity.queued,
    };
  }

  console.log(JSON.stringify(output, null, 2));
}

function printShort(runtime: RuntimeStatus, states: ComponentState[]): void {
  console.log(`  runtime\t${formatRuntimeState(runtime.state)}\t${describeRuntimeOwner(runtime)}`);
  for (const state of states) {
    if (state.status === "running") {
      const details: string[] = [];
      if (state.pid) details.push(`pid ${state.pid}`);
      if (state.mode) details.push(`via ${state.mode}`);
      if (state.lifecycleState && state.lifecycleState !== "running") {
        details.push(`state ${state.lifecycleState}`);
      }
      if (state.uptime) details.push(`uptime ${state.uptime}`);
      console.log(`  ${state.name}\t${green("\u25cf running")}\t${details.join("  ")}`);
    } else {
      console.log(`  ${state.name}\t${dim("- stopped")}`);
    }
  }
}

async function printFull(
  config: JinConfig,
  runtime: RuntimeStatus,
  states: ComponentState[],
  paths: ReturnType<typeof getRuntimePaths>,
): Promise<void> {
  console.log(`\n  jin status\n`);
  console.log(`  ${padRight("runtime", 12)}${formatRuntimeState(runtime.state)}    ${describeRuntimeOwner(runtime)}`);
  console.log(`  ${padRight("config", 12)}${configPath()}`);
  console.log(`  ${padRight("store", 12)}${paths.storePath}`);
  console.log(`  ${padRight("cache", 12)}${discoveryCachePath()}`);

  for (const state of states) {
    if (state.status === "running") {
      const parts: string[] = [green("\u25cf running")];
      if (state.pid) parts.push(`pid ${state.pid}`);
      if (state.mode) parts.push(`via ${state.mode}`);
      if (state.lifecycleState && state.lifecycleState !== "running") {
        parts.push(`state ${state.lifecycleState}`);
      }
      if (state.uptime) parts.push(`uptime ${state.uptime}`);
      console.log(`  ${padRight(state.name, 12)}${parts.join("    ")}`);
    } else {
      console.log(`  ${padRight(state.name, 12)}${dim("- stopped")}`);
    }
  }

  if (runtime.issues.length > 0) {
    for (const issue of runtime.issues) {
      const paused = issue.paused ? " (paused)" : "";
      console.log(`  ${padRight("issue", 12)}${yellow(issue.subsystem)}${paused}    ${issue.message}`);
    }
  }

  if (runtime.state === "stopped") {
    if (isServiceInstalled()) {
      console.log(`\n  ${dim("service is installed but inactive; run `jin start --service` or use your service manager")}`);
    } else {
      console.log(`\n  ${dim("run `jin start` to create the long-lived runtime owner")}`);
    }
  } else if (runtime.state === "stopping") {
    console.log(`\n  ${dim("shutdown is in progress; run `jin status` again for completion")}`);
  }

  const progress = readProgress();
  if (progress) {
    const pct = Math.round((progress.current / progress.total) * 100);
    console.log(`\n  ${cyan("ingesting")}  ${progress.adapter}  ${progress.current}/${progress.total} sessions (${pct}%)`);
  }

  const activity = readIngestActivity();
  if (activity?.active) {
    const a = activity.active;
    const phaseLabel = activity.coldStart ? "cold start" : "ingesting";
    const progressText =
      a.totalRefs !== undefined && a.processedRefs !== undefined && a.totalRefs > 0
        ? `${a.processedRefs}/${a.totalRefs} files (${Math.round((a.processedRefs / a.totalRefs) * 100)}%)`
        : "scanning";
    console.log(`\n  ${cyan(phaseLabel)}  ${a.adapter}    ${progressText}`);
    if (a.currentSourcePath) {
      console.log(`  ${dim("current")}     ${shortenPath(a.currentSourcePath, 80)}`);
    }
    if (activity.queued.length > 0) {
      console.log(`  ${dim("queued")}      ${activity.queued.join(", ")}`);
    }
  }

  console.log("");

  const stats = readStoreStats(paths.storePath);
  if (stats) {
    const statsLine = [
      `sessions  ${stats.sessions.toLocaleString()}`,
      `messages  ${stats.messages.toLocaleString()}`,
    ];
    if (stats.totalCost > 0) {
      statsLine.push(`cost  $${stats.totalCost.toFixed(2)}`);
    }
    console.log(`  ${statsLine.join("     ")}`);

    if (stats.adapters.length > 0) {
      console.log(`  adapters    ${stats.adapters.join(", ")}`);
    }
  } else {
    console.log(`  ${dim("store not initialized")}`);
  }

  if (config.sinks && config.sinks.length > 0) {
    const sinkLabels = config.sinks.map((sink, index) => {
      const id = sink.id || `${sink.type}-${index}`;
      const enabled = sink.enabled !== false;
      return enabled ? `${green("\u25cf")} ${id}` : `${yellow("\u25cf")} ${id} (disabled)`;
    });
    console.log(`  sinks       ${sinkLabels.join("   ")}`);
  }

  if (config.routes && config.routes.length > 0) {
    console.log(`  routes      ${config.routes.length} configured`);
  }

  const discoveryCache = readDiscoveryCacheStatus(discoveryCachePath());
  if (discoveryCache.length > 0) {
    console.log("");
    for (const row of discoveryCache) {
      const counters = [
        `cached ${row.cachedSources}`,
        `fresh ${row.freshSources}`,
        `invalidated ${row.invalidatedSources}`,
      ];
      const extras = [
        row.lastInvalidationReason
          ? `last-invalid ${row.lastInvalidationReason}`
          : "",
        row.lastDisabledReason ? `disabled ${row.lastDisabledReason}` : "",
      ].filter(Boolean);
      console.log(
        `  cache:${row.adapterId}  ${counters.join("    ")}${
          extras.length > 0 ? `    ${extras.join("    ")}` : ""
        }`,
      );
    }
  }

  console.log("");

  if (existsSync(paths.logPath)) {
    console.log(`  log  ${paths.logPath}`);
    try {
      const stat = statSync(paths.logPath);
      if (stat.size > 0) {
        const log = readFileSync(paths.logPath, "utf-8");
        const lines = log.trim().split("\n");
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
          console.log(`  last: ${lastLine}`);
        }
      }
    } catch {}
  }

  console.log("");
}

function readStoreStats(storePath: string): {
  sessions: number;
  messages: number;
  adapters: string[];
  totalCost: number;
} | null {
  if (!existsSync(storePath)) {
    return null;
  }

  try {
    const store = openStoreAtPath(storePath);
    const overview = getOverviewSummary(store.database);
    const byAdapter = analyzeByAdapter(store.database);
    const adapters = Object.keys(byAdapter);
    let totalCost = 0;
    for (const stats of Object.values(byAdapter)) {
      totalCost += stats.cost;
    }
    store.close();
    return {
      // Keep status output labels stable while reading from the v2 store.
      sessions: overview.conversations,
      messages: overview.messages,
      adapters,
      totalCost,
    };
  } catch {
    return null;
  }
}

function readDiscoveryCacheStatus(cachePath: string): Array<{
  adapterId: string;
  cachedSources: number;
  invalidatedSources: number;
  freshSources: number;
  lastInvalidationReason: string;
  lastDisabledReason: string;
}> {
  if (!existsSync(cachePath)) {
    return [];
  }

  let cache: SqliteDiscoveryCache | null = null;
  try {
    cache = new SqliteDiscoveryCache(cachePath);
    return cache.getStatusRows().map((row) => ({
      adapterId: row.adapterId,
      cachedSources: row.cachedSources,
      invalidatedSources: row.invalidatedSources,
      freshSources: row.freshSources,
      lastInvalidationReason: row.lastInvalidationReason,
      lastDisabledReason: row.lastDisabledReason,
    }));
  } catch {
    return [];
  } finally {
    cache?.close();
  }
}

function formatRuntimeState(state: RuntimeStatus["state"]): string {
  switch (state) {
    case "running":
      return green("\u25cf running");
    case "degraded":
      return yellow("\u25cf degraded");
    case "starting":
      return yellow("\u25cf starting");
    case "stopping":
      return yellow("\u25cf stopping");
    default:
      return dim("- stopped");
  }
}

function describeRuntimeOwner(runtime: RuntimeStatus): string {
  if (!runtime.owner) {
    return dim(runModeLabel("none"));
  }

  const parts = [runModeLabel(runtime.owner.mode)];
  if (runtime.owner.pid) {
    parts.push(`pid ${runtime.owner.pid}`);
  }
  return parts.join("    ");
}

function padRight(value: string, length: number): string {
  return value + " ".repeat(Math.max(0, length - value.length));
}

function shortenPath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  const head = path.slice(0, 20);
  const tail = path.slice(path.length - (maxLen - 23));
  return `${head}...${tail}`;
}
