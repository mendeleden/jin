import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { configDir, loadConfig } from "../config";
import { Store } from "../store";

const PID_FILE = join(configDir(), "jin.pid");
const LOG_FILE = join(configDir(), "jin.log");

export async function statusCommand(): Promise<void> {
  const config = await loadConfig();

  // Check daemon
  let running = false;
  let pid = "";
  if (existsSync(PID_FILE)) {
    pid = readFileSync(PID_FILE, "utf-8").trim();
    try {
      process.kill(parseInt(pid), 0);
      running = true;
    } catch {
      running = false;
    }
  }

  console.log(`\n  jin status\n`);
  console.log(`  Daemon:    ${running ? `running (PID ${pid})` : "stopped"}`);

  // Store stats
  try {
    const store = new Store(config.store.dbPath);
    console.log(`  Sessions:  ${store.sessionCount()}`);
    console.log(`  Messages:  ${store.messageCount()}`);
    store.close();
  } catch {
    console.log(`  Store:     not initialized`);
  }

  // Sinks
  console.log(`  Sinks:     ${config.sinks?.length || 0} configured`);
  for (const s of config.sinks || []) {
    console.log(`    [>] ${s.type}${s.teamId ? ` (team: ${s.teamId})` : ""}`);
  }

  // Team
  if (config.team) {
    console.log(`  Team:      ${config.team.teamId}`);
    console.log(`  Dev ID:    ${config.team.developerId}`);
    console.log(`  Sync:      ${config.team.syncMode}`);
  }

  // Log file
  if (existsSync(LOG_FILE)) {
    const stat = statSync(LOG_FILE);
    console.log(`  Log:       ${LOG_FILE} (${(stat.size / 1024).toFixed(1)} KB)`);

    // Show last 5 log lines
    const log = readFileSync(LOG_FILE, "utf-8");
    const lines = log.trim().split("\n").slice(-5);
    if (lines.length > 0) {
      console.log(`\n  Recent log:`);
      for (const line of lines) {
        console.log(`    ${line}`);
      }
    }
  }

  console.log("");
}
