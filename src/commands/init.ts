import { loadConfig, saveConfig, configDir, configPath, ensureConfigDir } from "../config";
import { Store } from "../store";
import { allAdapters } from "../adapters/registry";
import { decodeTeamConfig } from "../sinks/types";
import { createSink, availableSinks } from "../sinks/registry";

export async function initCommand(opts?: { team?: string; json?: boolean }): Promise<void> {
  ensureConfigDir();
  const config = await loadConfig();

  // Handle --team flag: decode base64 team config
  if (opts?.team) {
    try {
      const sinkConfig = decodeTeamConfig(opts.team);
      if (!sinkConfig.developerId) {
        sinkConfig.developerId = process.env.USER || process.env.USERNAME || "dev-" + Date.now();
      }
      config.sinks = [sinkConfig];
      config.team = {
        teamId: sinkConfig.teamId || "",
        developerId: sinkConfig.developerId || "",
        syncMode: "realtime",
      };

      const sink = createSink(sinkConfig);
      const health = await sink.healthCheck();
      if (health.ok) {
        console.log(`  sink: ${sink.name} connected`);
      } else {
        console.log(`  sink: ${sink.name} failed — ${health.error}`);
      }
      await sink.close();
    } catch (err) {
      console.error(`  error: bad team config — ${err}`);
      process.exit(1);
    }
  }

  // Detect adapters
  const adapters = allAdapters();
  const detected: { id: string; name: string; sessionCount: number }[] = [];
  const notFound: string[] = [];

  for (const adapter of adapters) {
    try {
      if (await adapter.detect()) {
        const sessions = await adapter.sessions();
        detected.push({ id: adapter.id, name: adapter.name, sessionCount: sessions.length });
        config.adapters[adapter.id] = { enabled: true };
      } else {
        notFound.push(adapter.name);
        config.adapters[adapter.id] = { enabled: false };
      }
    } catch {
      notFound.push(adapter.name);
    }
  }

  await saveConfig(config);
  const store = new Store(config.store.dbPath);
  store.close();

  // JSON mode for scripting
  if (opts?.json) {
    console.log(JSON.stringify({
      detected: detected.map(d => ({ id: d.id, name: d.name, sessions: d.sessionCount })),
      notFound,
      sinks: config.sinks.map(s => ({ type: s.type, teamId: s.teamId })),
      config: configPath(),
    }, null, 2));
    return;
  }

  // Clean human output
  console.log("");
  for (const d of detected) {
    console.log(`  \x1b[32m+\x1b[0m ${d.name}  \x1b[2m${d.sessionCount} sessions\x1b[0m`);
  }
  if (notFound.length > 0) {
    console.log(`  \x1b[2m- ${notFound.join(", ")}\x1b[0m`);
  }

  if (config.sinks.length > 0) {
    console.log("");
    for (const s of config.sinks) {
      console.log(`  \x1b[33m>\x1b[0m ${s.type}${s.teamId ? ` (${s.teamId})` : ""}`);
    }
  }

  console.log(`\n  \x1b[2m${configPath()}\x1b[0m`);
  console.log(`\n  Next: \x1b[1mjin watch\x1b[0m`);
}
