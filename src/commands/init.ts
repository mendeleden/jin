import { loadConfig, saveConfig, configDir, configPath, ensureConfigDir } from "../config";
import { Store } from "../store";
import { allAdapters } from "../adapters/registry";
import { decodeTeamConfig } from "../sinks/types";
import { createSink, availableSinks } from "../sinks/registry";

export async function initCommand(opts?: { team?: string }): Promise<void> {
  console.log("jin init — detecting agentic coding tools...\n");

  ensureConfigDir();
  const config = await loadConfig();

  // Handle --team flag: decode base64 team config
  if (opts?.team) {
    try {
      const sinkConfig = decodeTeamConfig(opts.team);
      console.log(`  Team config decoded:`);
      console.log(`    Sink:     ${sinkConfig.type}`);
      console.log(`    Team:     ${sinkConfig.teamId || "(not set)"}`);
      console.log(`    Dev ID:   ${sinkConfig.developerId || "(auto)"}`);
      console.log("");

      // Auto-set developer ID from system if not provided
      if (!sinkConfig.developerId) {
        sinkConfig.developerId = process.env.USER || process.env.USERNAME || "dev-" + Date.now();
      }

      // Add sink to config
      config.sinks = [sinkConfig];
      config.team = {
        teamId: sinkConfig.teamId || "",
        developerId: sinkConfig.developerId || "",
        syncMode: "realtime",
      };

      // Test sink connectivity
      console.log("  Testing sink connection...");
      const sink = createSink(sinkConfig);
      const health = await sink.healthCheck();
      if (health.ok) {
        console.log(`  [ok] ${sink.name} connected successfully.\n`);
      } else {
        console.log(`  [!]  ${sink.name} health check failed: ${health.error}`);
        console.log(`       (Sink saved anyway — you can fix the connection later.)\n`);
      }
      await sink.close();
    } catch (err) {
      console.error(`  Error decoding team config: ${err}`);
      console.error(`  Expected base64-encoded JSON. Generate with: jin team-config\n`);
    }
  }

  // Detect adapters
  const adapters = allAdapters();
  const detected: { id: string; name: string; paths: string[] }[] = [];
  const notFound: string[] = [];

  for (const adapter of adapters) {
    try {
      const found = await adapter.detect();
      if (found) {
        const paths = adapter.watchPaths();
        detected.push({ id: adapter.id, name: adapter.name, paths });
        config.adapters[adapter.id] = { enabled: true };
      } else {
        notFound.push(adapter.name);
        config.adapters[adapter.id] = { enabled: false };
      }
    } catch {
      notFound.push(adapter.name);
    }
  }

  // Save config
  await saveConfig(config);

  // Initialize store
  const store = new Store(config.store.dbPath);
  store.close();

  // Report
  console.log(`  Detected ${detected.length} tool(s):\n`);
  for (const d of detected) {
    console.log(`    [x] ${d.name} (${d.id})`);
    for (const p of d.paths) {
      console.log(`        ${p}`);
    }
  }

  if (notFound.length > 0) {
    console.log(`\n  Not found: ${notFound.join(", ")}`);
  }

  if (config.sinks.length > 0) {
    console.log(`\n  Sinks configured:`);
    for (const s of config.sinks) {
      console.log(`    [>] ${s.type}${s.teamId ? ` (team: ${s.teamId})` : ""}`);
    }
  }

  console.log(`\n  Config:  ${configPath()}`);
  console.log(`  Store:   ${config.store.dbPath}`);

  if (config.sinks.length > 0) {
    console.log(`\n  Run \`jin watch\` to start ingesting and syncing.`);
  } else {
    console.log(`\n  Run \`jin watch\` to start ingesting conversations.`);
    console.log(`  Run \`jin init --team=<code>\` to connect to your team's shared infra.`);
  }

  // Machine-readable JSON
  const summary = {
    configPath: configPath(),
    storePath: config.store.dbPath,
    detected: detected.map((d) => ({ id: d.id, name: d.name, watchPaths: d.paths })),
    notFound,
    sinks: config.sinks.map((s) => ({ type: s.type, teamId: s.teamId })),
    team: config.team,
  };
  console.log(`\n--- JSON ---\n${JSON.stringify(summary, null, 2)}`);
}
