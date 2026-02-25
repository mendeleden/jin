import { loadConfig, saveConfig } from "../config";
import type { JinConfig, RouteConfig } from "../config";
import type { SinkConfig } from "../sinks/types";
import { decodeTeamConfig } from "../sinks/types";
import { createSink } from "../sinks/registry";
import { Store } from "../store";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Resolve the effective ID for a sink config (mirrors createSink logic) */
function sinkId(config: SinkConfig, index: number): string {
  return config.id || `${config.type}-${index}`;
}

/**
 * Find an existing sink with matching connection details, or create a new one.
 * Returns the sink ID and whether it was newly created.
 */
function findOrCreateSink(
  config: JinConfig,
  opts: {
    type: "postgres" | "webhook" | "s3";
    connectionString?: string;
    url?: string;
    bucket?: string;
    region?: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    prefix?: string;
    id?: string;
    teamId?: string;
  },
): { sinkId: string; isNew: boolean } {
  if (!config.sinks) config.sinks = [];

  // Check for existing sink with same connection details
  for (let i = 0; i < config.sinks.length; i++) {
    const s = config.sinks[i];
    if (s.type !== opts.type) continue;

    if (opts.type === "postgres" && s.connectionString === opts.connectionString) {
      return { sinkId: sinkId(s, i), isNew: false };
    }
    if (opts.type === "webhook" && s.url === opts.url) {
      return { sinkId: sinkId(s, i), isNew: false };
    }
    if (opts.type === "s3" && s.bucket === opts.bucket && s.region === opts.region) {
      return { sinkId: sinkId(s, i), isNew: false };
    }
  }

  // Create new sink
  const newSink: SinkConfig = { type: opts.type };

  if (opts.id) {
    newSink.id = opts.id;
  } else {
    // Auto-generate: type-N where N is count of that type
    const count = config.sinks.filter((s) => s.type === opts.type).length;
    newSink.id = `${opts.type}-${count}`;
  }

  if (opts.type === "postgres") {
    newSink.connectionString = opts.connectionString;
  } else if (opts.type === "webhook") {
    newSink.url = opts.url;
  } else if (opts.type === "s3") {
    newSink.bucket = opts.bucket;
    newSink.region = opts.region;
    if (opts.endpoint) newSink.endpoint = opts.endpoint;
    if (opts.accessKeyId) newSink.accessKeyId = opts.accessKeyId;
    if (opts.secretAccessKey) newSink.secretAccessKey = opts.secretAccessKey;
    if (opts.prefix) newSink.prefix = opts.prefix;
  }

  if (opts.teamId) newSink.teamId = opts.teamId;

  config.sinks.push(newSink);
  return { sinkId: newSink.id!, isNew: true };
}

/**
 * Find or update a project's route. Returns whether a route already existed.
 */
function setProjectRoute(
  config: JinConfig,
  project: string,
  sinkIds: string[],
): { existed: boolean } {
  if (!config.routes) config.routes = [];

  // Check for existing route matching this project
  for (const route of config.routes) {
    if (route.match.project?.toLowerCase() === project.toLowerCase()) {
      route.sinks = sinkIds;
      return { existed: true };
    }
  }

  // Add new route
  config.routes.push({
    match: { project },
    sinks: sinkIds,
  });
  return { existed: false };
}

// ── Connect Command ─────────────────────────────────────────────────────

export async function connectCommand(
  project: string,
  opts: {
    postgres?: string;
    s3?: string;
    webhook?: string;
    sink?: string;
    team?: string;
    id?: string;
    "team-id"?: string;
    teamId?: string;
    region?: string;
    endpoint?: string;
    "access-key-id"?: string;
    accessKeyId?: string;
    "secret-access-key"?: string;
    secretAccessKey?: string;
    prefix?: string;
  },
): Promise<void> {
  if (!project) {
    console.error("  Usage: jin connect <project> --postgres=\"...\" [--id=<sink-id>]");
    console.error("         jin connect <project> --sink=<existing-sink-id>");
    console.error("         jin connect <project> --team=<base64-code>");
    process.exit(1);
  }

  const config = await loadConfig();
  const teamId = (opts["team-id"] || opts.teamId) as string | undefined;
  let resultSinkId: string;
  let isNew = false;
  let sinkLabel = "";

  if (opts.team) {
    // Decode team config → add sink + route
    const decoded = decodeTeamConfig(opts.team);
    const result = findOrCreateSink(config, {
      type: decoded.type,
      connectionString: decoded.connectionString,
      url: decoded.url,
      bucket: decoded.bucket,
      region: decoded.region,
      endpoint: decoded.endpoint,
      accessKeyId: decoded.accessKeyId,
      secretAccessKey: decoded.secretAccessKey,
      prefix: decoded.prefix,
      id: opts.id,
      teamId: decoded.teamId || teamId,
    });
    resultSinkId = result.sinkId;
    isNew = result.isNew;
    sinkLabel = `${decoded.type} (${resultSinkId})`;
  } else if (opts.sink) {
    // Route to existing sink
    const allSinkIds = (config.sinks || []).map((s, i) => sinkId(s, i));
    if (!allSinkIds.includes(opts.sink)) {
      console.error(`  Error: Sink "${opts.sink}" not found.`);
      console.error(`  Available sinks: ${allSinkIds.join(", ") || "(none configured)"}`);
      process.exit(1);
    }
    resultSinkId = opts.sink;
    const sinkConfig = config.sinks.find((s, i) => sinkId(s, i) === opts.sink);
    sinkLabel = `${sinkConfig?.type || "unknown"} (${resultSinkId})`;
  } else if (opts.postgres) {
    const result = findOrCreateSink(config, {
      type: "postgres",
      connectionString: opts.postgres,
      id: opts.id,
      teamId,
    });
    resultSinkId = result.sinkId;
    isNew = result.isNew;
    sinkLabel = `postgres (${resultSinkId})`;
  } else if (opts.webhook) {
    const result = findOrCreateSink(config, {
      type: "webhook",
      url: opts.webhook,
      id: opts.id,
      teamId,
    });
    resultSinkId = result.sinkId;
    isNew = result.isNew;
    sinkLabel = `webhook (${resultSinkId})`;
  } else if (opts.s3) {
    const result = findOrCreateSink(config, {
      type: "s3",
      bucket: opts.s3,
      region: (opts.region as string) || "us-east-1",
      endpoint: opts.endpoint as string | undefined,
      accessKeyId: (opts["access-key-id"] || opts.accessKeyId) as string | undefined,
      secretAccessKey: (opts["secret-access-key"] || opts.secretAccessKey) as string | undefined,
      prefix: opts.prefix as string | undefined,
      id: opts.id,
      teamId,
    });
    resultSinkId = result.sinkId;
    isNew = result.isNew;
    sinkLabel = `s3 (${resultSinkId})`;
  } else {
    console.error("  Error: Specify a sink type or existing sink:");
    console.error('    --postgres="postgresql://..."');
    console.error('    --webhook="https://..."');
    console.error('    --s3="my-bucket" --region=us-east-1');
    console.error("    --sink=<existing-sink-id>");
    console.error("    --team=<base64-code>");
    process.exit(1);
  }

  // Set the route
  const { existed } = setProjectRoute(config, project, [resultSinkId]);

  // Health check the sink
  const sinkConfig = config.sinks.find((s, i) => sinkId(s, i) === resultSinkId);
  let healthOk = false;
  if (sinkConfig) {
    try {
      const sink = createSink(sinkConfig, config.sinks.indexOf(sinkConfig));
      const health = await sink.healthCheck();
      healthOk = health.ok;
      if (health.ok) {
        console.log(`  Testing connection... \u25cf connected`);
      } else {
        console.log(`  Testing connection... \u25cb failed: ${health.error}`);
      }
      await sink.close();
    } catch (err: any) {
      console.log(`  Testing connection... \u25cb error: ${err.message}`);
    }
  }

  await saveConfig(config);

  if (existed) {
    console.log(`  Updated ${project} \u2192 ${sinkLabel}`);
  } else {
    console.log(`  Connected ${project} \u2192 ${sinkLabel}`);
  }
}

// ── Connections Command ────────────────────────────────────────────────

export async function connectionsCommand(): Promise<void> {
  const config = await loadConfig();
  const routes = config.routes || [];
  const sinks = config.sinks || [];

  // Build a map of sink IDs to their config for display
  const sinkMap = new Map<string, SinkConfig>();
  for (let i = 0; i < sinks.length; i++) {
    const s = sinks[i];
    sinkMap.set(sinkId(s, i), s);
  }

  // Get all known projects from store
  let allProjects: any[] = [];
  try {
    const store = new Store(config.store.dbPath);
    allProjects = store.listProjects();
    store.close();
  } catch {
    // Store may not exist yet
  }

  // Build connected list from routes
  const connected: Array<{ project: string; sinkIds: string[] }> = [];
  const connectedProjects = new Set<string>();
  for (const route of routes) {
    if (route.match.project) {
      connected.push({ project: route.match.project, sinkIds: route.sinks });
      connectedProjects.add(route.match.project.toLowerCase());
    }
  }

  if (connected.length === 0 && allProjects.length === 0) {
    console.log("\n  No connections configured. No projects found.\n");
    console.log('  Connect a project:  jin connect <project> --postgres="..."');
    console.log("  Run guided setup:   jin setup\n");
    return;
  }

  if (connected.length > 0) {
    console.log("");
    const maxNameLen = Math.max(...connected.map((c) => c.project.length));

    for (const conn of connected) {
      const s = sinkMap.get(conn.sinkIds[0]);
      const sType = s?.type || "unknown";
      const sId = conn.sinkIds[0];
      // Extract a short host label for postgres
      let hostLabel = "";
      if (s?.type === "postgres" && s.connectionString) {
        try {
          const url = new URL(s.connectionString);
          hostLabel = url.hostname;
        } catch {
          hostLabel = "";
        }
      } else if (s?.type === "webhook" && s.url) {
        try {
          const url = new URL(s.url);
          hostLabel = url.hostname;
        } catch {
          hostLabel = "";
        }
      } else if (s?.type === "s3") {
        hostLabel = s.bucket || "";
      }

      const name = conn.project.padEnd(maxNameLen);
      const sinkDesc = `${sType} (${sId})`;
      const host = hostLabel ? `  ${hostLabel}` : "";
      console.log(`  ${name}  \u2192 ${sinkDesc}${host}  \u25cf connected`);
    }
  }

  // Unrouted projects
  const unrouted = allProjects
    .filter((p: any) => !connectedProjects.has(p.name.toLowerCase()))
    .map((p: any) => p.name);

  if (unrouted.length > 0) {
    console.log(`\n  unrouted: ${unrouted.join(", ")} (local only)`);
  }

  console.log("");
}

// ── Disconnect Command ──────────────────────────────────────────────────

export async function disconnectCommand(
  project: string,
  opts: { "remove-sink"?: boolean; removeSink?: boolean },
): Promise<void> {
  if (!project) {
    console.error("  Usage: jin disconnect <project> [--remove-sink]");
    process.exit(1);
  }

  const config = await loadConfig();
  if (!config.routes) config.routes = [];

  // Find and remove the route for this project
  const idx = config.routes.findIndex(
    (r) => r.match.project?.toLowerCase() === project.toLowerCase(),
  );

  if (idx === -1) {
    console.error(`  No connection found for "${project}".`);
    console.error("  Run 'jin connections' to see current connections.");
    process.exit(1);
  }

  const removed = config.routes.splice(idx, 1)[0];
  const removedSinkIds = removed.sinks;

  // Optionally remove the sink if --remove-sink and no other routes use it
  if (opts["remove-sink"] || opts.removeSink) {
    for (const sid of removedSinkIds) {
      const stillUsed = config.routes.some((r) => r.sinks.includes(sid));
      if (!stillUsed) {
        const sinkIdx = config.sinks.findIndex((s, i) => sinkId(s, i) === sid);
        if (sinkIdx >= 0) {
          config.sinks.splice(sinkIdx, 1);
          console.log(`  Removed sink: ${sid}`);
        }
      } else {
        console.log(`  Sink ${sid} still used by other routes, kept.`);
      }
    }
  }

  await saveConfig(config);
  console.log(`  ${project} disconnected. Sessions stay local only.`);
}
