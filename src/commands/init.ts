import {
  loadConfig,
  saveConfig,
  configPath,
  ensureConfigDir,
  resolveAdapterConfig,
} from "../config";
import { LegacyStore } from "../store";
import {
  allAdapters,
  protectedSourceStartupNotices,
  startupProbeBlocked,
} from "../adapters/registry";
import { decodeTeamConfig } from "../sinks/types";
import { createSink } from "../sinks/registry";
import { ingestCommand } from "./ingest";
import { ensureSinkConfigured, type SinkCandidateInput } from "./sink";
import { getRuntimePaths, getRuntimeStatus, runModeLabel } from "../daemon/runtime-state";

export async function initCommand(opts?: { team?: string; json?: boolean; skills?: boolean }): Promise<void> {
  ensureConfigDir();
  const config = await loadConfig();

  // Handle --team flag: decode base64 team config
  if (opts?.team) {
    try {
      const sinkCandidate = toTeamSinkCandidate(decodeTeamConfig(opts.team));
      const existingSinkCount = config.sinks.length;
      const result = await ensureSinkConfigured(config, sinkCandidate);

      if (!result.created) {
        console.log(`  sink: already configured (${result.sinkId}), skipping`);
      } else if (existingSinkCount > 0) {
        console.log(
          `  \x1b[33mNote:\x1b[0m Adding workspace sink alongside ${existingSinkCount} existing sink(s).`,
        );
      }

      const sink = createSink(result.sink, config.sinks.findIndex((entry) => entry.id === result.sinkId));
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
  const adapters = allAdapters(config.adapters);
  const detected: { id: string; name: string; sessionCount: number }[] = [];
  const notFound: string[] = [];
  const protectedSourceNotices = protectedSourceStartupNotices(config.adapters);

  for (const adapter of adapters) {
    if (resolveAdapterConfig(config.adapters, adapter.id).enabled === false) {
      continue;
    }

    if (startupProbeBlocked(adapter.id, config.adapters)) {
      continue;
    }

    try {
      if (await adapter.detect()) {
        const sessions = await adapter.sessions();
        detected.push({ id: adapter.id, name: adapter.name, sessionCount: sessions.length });
      } else {
        notFound.push(adapter.name);
      }
    } catch {
      notFound.push(adapter.name);
    }
  }

  await saveConfig(config);

  const runtime = getRuntimeStatus();
  const canRunCompatibilityIngest =
    !runtime.owner || runtime.state === "stopped";

  // Compatibility ingest only runs when no long-lived runtime owns the store.
  if (detected.length > 0 && canRunCompatibilityIngest) {
    if (opts?.json) {
      // Suppress ingest console output in JSON mode
      const origLog = console.log;
      console.log = () => {};
      try { await ingestCommand(); } finally { console.log = origLog; }
    } else {
      await ingestCommand();
    }
  } else if (detected.length > 0 && !opts?.json) {
    console.log(
      `  Compatibility note: skipping one-shot ingest because jin is already running under ${runModeLabel(runtime.owner!.mode)}.`,
    );
    console.log("  Use `jin status` to inspect the active daemon, or restart it if you need new config applied.");
  }

  // JSON mode for scripting
  if (opts?.json) {
    // Include projects from store after ingest
    let projects: string[] = [];
    try {
      const store = new LegacyStore(getRuntimePaths().storePath);
      projects = store.listProjects().map((p: any) => p.name);
      store.close();
    } catch { /* store may not exist */ }

    console.log(JSON.stringify({
      detected: detected.map((d) => ({
        id: d.id,
        name: d.name,
        sessions: d.sessionCount,
        conversations: d.sessionCount,
      })),
      notFound,
      protectedSources: protectedSourceNotices.map((notice) => ({
        id: notice.adapterId,
        name: notice.adapterName,
        mode: notice.mode,
        summary: notice.summary,
      })),
      sinks: config.sinks.map(s => ({ id: s.id, type: s.type, enabled: s.enabled !== false })),
      projects,
      config: configPath(),
    }, null, 2));
    return;
  }

  // Clean human output
  console.log("");
  for (const d of detected) {
    console.log(`  \x1b[32m+\x1b[0m ${d.name}  \x1b[2m${d.sessionCount} conversations\x1b[0m`);
  }
  if (notFound.length > 0) {
    console.log(`  \x1b[2m- ${notFound.join(", ")}\x1b[0m`);
  }

  if (protectedSourceNotices.length > 0) {
    console.log("");
    console.log("  Protected/app-private startup sources were not probed by default:");
    for (const notice of protectedSourceNotices) {
      console.log(`  \x1b[2m- ${notice.summary}\x1b[0m`);
    }
    console.log(
      `  \x1b[2mOpt in via ${configPath()}: set adapters.<id>.allowProtectedSource = true or adapters.<id>.dataDir to a user-provided path.\x1b[0m`,
    );
  }

  if (config.sinks.length > 0) {
    console.log("");
    for (const s of config.sinks) {
      console.log(`  \x1b[33m>\x1b[0m ${s.id} (${s.type})`);
    }
  }

  console.log(`\n  \x1b[2m${configPath()}\x1b[0m`);
  console.log("  Note: `jin start` is the primary local-first bootstrap path.");

  // If we have sinks but no routes, guide user to connect projects
  const hasRoutes = (config.routes || []).length > 0;
  if (config.sinks.length > 0 && !hasRoutes) {
    if (opts?.team) {
      console.log(`\n  Next: \x1b[1mjin connect\x1b[0m  (route local repos to this workspace)`);
    } else {
      console.log(`\n  Next: \x1b[1mjin route add\x1b[0m  (or \x1b[1mjin connect\x1b[0m for guided repo routing)`);
    }

    // If --team was used and stdin is a TTY, auto-launch interactive connect
    if (opts?.team && process.stdin.isTTY) {
      console.log("");
      const { interactiveConnect } = await import("./connect");
      await interactiveConnect({});
    }
  } else {
    console.log(`\n  Next: \x1b[1mjin start\x1b[0m`);
  }

  // Register /jin in coding tools (idempotent)
  if (opts?.skills) {
    const { setupSkillsCommand } = await import("./setup-skills");
    await setupSkillsCommand();
  }
}

function toTeamSinkCandidate(decoded: ReturnType<typeof decodeTeamConfig>): SinkCandidateInput {
  switch (decoded.type) {
    case "postgres":
      return {
        type: "postgres",
        id: decoded.id,
        connectionString: decoded.connectionString,
      };
    case "webhook":
      return {
        type: "webhook",
        id: decoded.id,
        url: decoded.url,
        headers: decoded.headers,
      };
    case "s3":
      return {
        type: "s3",
        id: decoded.id,
        bucket: decoded.bucket,
        region: decoded.region,
        endpoint: decoded.endpoint,
        accessKeyId: decoded.accessKeyId,
        secretAccessKey: decoded.secretAccessKey,
        prefix: decoded.prefix,
      };
  }
}
