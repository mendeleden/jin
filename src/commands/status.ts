import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { configDir, loadConfig } from "../config";
import type { JinConfig } from "../config";
import { Store } from "../store";
import { getAllState } from "../lifecycle";
import type { ComponentState } from "../lifecycle";

const LOG_FILE = join(configDir(), "jin.log");

// ANSI helpers
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export async function statusCommand(opts?: {
  json?: boolean;
  short?: boolean;
}): Promise<void> {
  const config = await loadConfig();
  const states = getAllState();

  if (opts?.json) {
    return printJson(config, states);
  }
  if (opts?.short) {
    return printShort(states);
  }
  return printFull(config, states);
}

async function printJson(config: JinConfig, states: ComponentState[]): Promise<void> {
  const output: Record<string, unknown> = {
    components: states,
  };

  try {
    const store = new Store(config.store.dbPath);
    output.sessions = store.sessionCount();
    output.messages = store.messageCount();

    // Get active adapters
    const adapterRows = store.analyzeByAdapter();
    output.adapters = Object.keys(adapterRows);

    store.close();
  } catch {
    output.sessions = 0;
    output.messages = 0;
    output.adapters = [];
  }

  output.sinks = (config.sinks || []).map((s, i) => ({
    id: s.id || `${s.type}-${i}`,
    type: s.type,
    teamId: s.teamId || null,
  }));

  if (config.routes?.length) {
    output.routes = config.routes;
    output.defaultSinks = config.defaultSinks || [];
  }

  output.log = LOG_FILE;

  console.log(JSON.stringify(output, null, 2));
}

function printShort(states: ComponentState[]): void {
  for (const s of states) {
    if (s.status === "running") {
      const details: string[] = [];
      if (s.pid) details.push(`pid ${s.pid}`);
      if (s.mode) details.push(`via ${s.mode}`);
      if (s.port) details.push(`http://localhost:${s.port}`);
      if (s.uptime) details.push(`uptime ${s.uptime}`);
      console.log(`  ${s.name}\t${green("\u25cf running")}\t${details.join("  ")}`);
    } else {
      console.log(`  ${s.name}\t${dim("- stopped")}`);
    }
  }
}

async function printFull(config: JinConfig, states: ComponentState[]): Promise<void> {
  console.log(`\n  jin status\n`);

  // Components
  for (const s of states) {
    if (s.status === "running") {
      const parts: string[] = [green("\u25cf running")];
      if (s.pid) parts.push(`pid ${s.pid}`);
      if (s.mode) parts.push(`via ${s.mode}`);
      if (s.uptime) parts.push(`uptime ${s.uptime}`);
      if (s.port) parts.push(cyan(`http://localhost:${s.port}`));
      console.log(`  ${padRight(s.name, 12)}${parts.join("    ")}`);
    } else {
      console.log(`  ${padRight(s.name, 12)}${dim("- stopped")}`);
    }
  }

  // Hint if everything is stopped
  const allStopped = states.every((s) => s.status === "stopped");
  if (allStopped) {
    console.log(`\n  ${dim("run 'jin start' to begin watching")}`);
  }

  console.log("");

  // Store stats
  try {
    const store = new Store(config.store.dbPath);
    const sessions = store.sessionCount();
    const messages = store.messageCount();

    // Compute total cost
    const byAdapter = store.analyzeByAdapter();
    let totalCost = 0;
    const adapterNames: string[] = [];
    for (const [name, stats] of Object.entries(byAdapter)) {
      totalCost += stats.cost;
      adapterNames.push(name);
    }

    const statsLine = [
      `sessions  ${sessions.toLocaleString()}`,
      `messages  ${messages.toLocaleString()}`,
    ];
    if (totalCost > 0) {
      statsLine.push(`cost  $${totalCost.toFixed(2)}`);
    }
    console.log(`  ${statsLine.join("     ")}`);

    if (adapterNames.length > 0) {
      console.log(`  adapters    ${adapterNames.join(", ")}`);
    }

    store.close();
  } catch {
    console.log(`  ${dim("store not initialized")}`);
  }

  // Sinks
  if (config.sinks && config.sinks.length > 0) {
    const sinkLabels = config.sinks.map((s, i) => {
      const id = s.id || `${s.type}-${i}`;
      const label = s.name || (s.teamId ? `${s.type}/${s.teamId}` : id);
      return `${green("\u25cf")} ${label}`;
    });
    console.log(`  sinks       ${sinkLabels.join("   ")}`);
  }

  // Routes
  if (config.routes && config.routes.length > 0) {
    const routeLabels = config.routes.map((r) => {
      const match = r.match.project || r.match.remote || r.match.directory || "?";
      return `${match} \u2192 ${r.sinks.join(",")}`;
    });
    const defaultLabel = config.routeUnmatchedToAll
      ? "all sinks"
      : config.defaultSinks?.length
        ? config.defaultSinks.join(",")
        : "local only";
    routeLabels.push(`* \u2192 ${defaultLabel}`);
    console.log(`  routes      ${routeLabels.join(" | ")}`);
  }

  console.log("");

  // Log file
  if (existsSync(LOG_FILE)) {
    const stat = statSync(LOG_FILE);
    console.log(`  log  ${LOG_FILE}`);

    // Show last log line
    try {
      const log = readFileSync(LOG_FILE, "utf-8");
      const lines = log.trim().split("\n");
      const lastLine = lines[lines.length - 1];
      if (lastLine) {
        console.log(`  last: ${lastLine}`);
      }
    } catch {}
  }

  console.log("");
}

function padRight(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - s.length));
}
