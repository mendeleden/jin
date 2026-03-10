import * as readline from "readline";
import { loadConfig, saveConfig, ensureConfigDir } from "../config";
import type { JinConfig, RouteConfig } from "../config";
import type { SinkConfig } from "../sinks/types";
import { decodeTeamConfig } from "../sinks/types";
import { createSink } from "../sinks/registry";
import { Store } from "../store";
import { homedir } from "os";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Resolve the effective ID for a sink config (mirrors createSink logic) */
function sinkId(config: SinkConfig, index: number): string {
  return config.id || `${config.type}-${index}`;
}

/** Human-readable display label: "my-name (postgres)" or "postgres-0 (postgres)" */
function sinkDisplayLabel(config: SinkConfig, index: number): string {
  const label = config.name || config.id || `${config.type}-${index}`;
  return `${label} (${config.type})`;
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
    name?: string;
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

  if (opts.name) newSink.name = opts.name;

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
function setRoute(
  config: JinConfig,
  match: { project?: string; remote?: string; directory?: string },
  sinkIds: string[],
): { existed: boolean } {
  if (!config.routes) config.routes = [];

  // Check for existing route with same match — merge sinks instead of replacing
  for (const route of config.routes) {
    if (match.project && route.match.project?.toLowerCase() === match.project.toLowerCase()) {
      route.sinks = [...new Set([...route.sinks, ...sinkIds])];
      return { existed: true };
    }
    if (match.remote && route.match.remote === match.remote) {
      route.sinks = [...new Set([...route.sinks, ...sinkIds])];
      return { existed: true };
    }
    if (match.directory && route.match.directory === match.directory) {
      route.sinks = [...new Set([...route.sinks, ...sinkIds])];
      return { existed: true };
    }
  }

  // Add new route
  config.routes.push({ match, sinks: sinkIds });
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
    name?: string;
    "team-id"?: string;
    teamId?: string;
    region?: string;
    endpoint?: string;
    "access-key-id"?: string;
    accessKeyId?: string;
    "secret-access-key"?: string;
    secretAccessKey?: string;
    prefix?: string;
    remote?: string;
    directory?: string;
    json?: boolean;
  },
): Promise<void> {
  if (!project && !opts.remote && !opts.directory) {
    // --team with no project: add the team sink, then launch interactive connect
    if (opts.team) {
      ensureConfigDir();
      const config = await loadConfig();
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
        name: opts.name,
        teamId: decoded.teamId || (opts["team-id"] || opts.teamId) as string | undefined,
      });
      if (result.isNew) {
        const sinkConfig = config.sinks[config.sinks.length - 1];
        try {
          const sink = createSink(sinkConfig, config.sinks.length - 1);
          const health = await sink.healthCheck();
          if (health.ok) {
            console.log(`  Testing connection... \u25cf connected`);
          } else {
            console.log(`  Testing connection... \u25cb failed: ${health.error}`);
          }
          await sink.close();
        } catch (err: any) {
          console.log(`  Testing connection... \u25cb error: ${err.message}`);
        }
        await saveConfig(config);
        const addedLabel = sinkDisplayLabel(sinkConfig, config.sinks.length - 1);
        console.log(`  Added sink: ${addedLabel}`);
      } else {
        console.log(`  Sink already configured (${result.sinkId})`);
      }
      return interactiveConnect({ json: opts.json, sinkId: result.sinkId });
    }

    // No match target — check if any sink opts were given
    const hasSinkOpts = !!(opts.postgres || opts.s3 || opts.webhook || opts.sink);
    if (!hasSinkOpts) {
      return interactiveConnect({ json: opts.json });
    }
    console.error("  Error: specify a project, --remote, or --directory");
    console.error("  Usage: jin connect <project> --postgres=\"...\" [--id=<sink-id>]");
    console.error("         jin connect <project> --sink=<existing-sink-id>");
    console.error("         jin connect <project> --team=<base64-code>");
    console.error('         jin connect --remote="github.com/org/repo" --team=<code>');
    console.error('         jin connect --directory="/path/to/project" --sink=<id>');
    process.exit(1);
  }

  // Auto-bootstrap config if it doesn't exist (so connect works as first command)
  ensureConfigDir();
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
      name: opts.name,
      teamId: decoded.teamId || teamId,
    });
    resultSinkId = result.sinkId;
    isNew = result.isNew;
    const teamSinkConfig = config.sinks.find((s, i) => sinkId(s, i) === resultSinkId);
    sinkLabel = teamSinkConfig ? sinkDisplayLabel(teamSinkConfig, config.sinks.indexOf(teamSinkConfig)) : `${decoded.type} (${resultSinkId})`;
  } else if (opts.sink) {
    // Route to existing sink
    const allSinkIds = (config.sinks || []).map((s, i) => sinkId(s, i));
    if (!allSinkIds.includes(opts.sink)) {
      console.error(`  Error: Sink "${opts.sink}" not found.`);
      console.error(`  Available sinks: ${allSinkIds.join(", ") || "(none configured)"}`);
      process.exit(1);
    }
    resultSinkId = opts.sink;
    const existSinkConfig = config.sinks.find((s, i) => sinkId(s, i) === opts.sink);
    sinkLabel = existSinkConfig ? sinkDisplayLabel(existSinkConfig, config.sinks.indexOf(existSinkConfig)) : resultSinkId;
  } else if (opts.postgres) {
    const result = findOrCreateSink(config, {
      type: "postgres",
      connectionString: opts.postgres,
      id: opts.id,
      name: opts.name,
      teamId,
    });
    resultSinkId = result.sinkId;
    isNew = result.isNew;
    const pgSinkConfig = config.sinks.find((s, i) => sinkId(s, i) === resultSinkId);
    sinkLabel = pgSinkConfig ? sinkDisplayLabel(pgSinkConfig, config.sinks.indexOf(pgSinkConfig)) : `postgres (${resultSinkId})`;
  } else if (opts.webhook) {
    const result = findOrCreateSink(config, {
      type: "webhook",
      url: opts.webhook,
      id: opts.id,
      name: opts.name,
      teamId,
    });
    resultSinkId = result.sinkId;
    isNew = result.isNew;
    const whSinkConfig = config.sinks.find((s, i) => sinkId(s, i) === resultSinkId);
    sinkLabel = whSinkConfig ? sinkDisplayLabel(whSinkConfig, config.sinks.indexOf(whSinkConfig)) : `webhook (${resultSinkId})`;
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
      name: opts.name,
      teamId,
    });
    resultSinkId = result.sinkId;
    isNew = result.isNew;
    const s3SinkConfig = config.sinks.find((s, i) => sinkId(s, i) === resultSinkId);
    sinkLabel = s3SinkConfig ? sinkDisplayLabel(s3SinkConfig, config.sinks.indexOf(s3SinkConfig)) : `s3 (${resultSinkId})`;
  } else {
    console.error("  Error: Specify a sink type or existing sink:");
    console.error('    --postgres="postgresql://..."');
    console.error('    --webhook="https://..."');
    console.error('    --s3="my-bucket" --region=us-east-1');
    console.error("    --sink=<existing-sink-id>");
    console.error("    --team=<base64-code>");
    process.exit(1);
  }

  // Set the route (by project name, remote glob, or directory)
  const match: { project?: string; remote?: string; directory?: string } = {};
  if (project) match.project = project;
  if (opts.remote) match.remote = opts.remote;
  if (opts.directory) match.directory = opts.directory;
  const { existed } = setRoute(config, match, [resultSinkId]);

  // Health check the sink
  const sinkConfig = config.sinks.find((s, i) => sinkId(s, i) === resultSinkId);
  if (sinkConfig) {
    try {
      const sink = createSink(sinkConfig, config.sinks.indexOf(sinkConfig));
      const health = await sink.healthCheck();
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

  const matchLabel = project || (opts.remote ? `remote:${opts.remote}` : `dir:${opts.directory}`);
  if (existed) {
    console.log(`  Updated ${matchLabel} \u2192 ${sinkLabel}`);
  } else {
    console.log(`  Connected ${matchLabel} \u2192 ${sinkLabel}`);
  }
}

// ── Interactive Connect ───────────────────────────────────────────────

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

interface ProjectRow {
  name: string;
  session_count: number;
  tools: string;
  directory: string;
}

export async function interactiveConnect(opts: { json?: boolean; sinkId?: string }): Promise<void> {
  const config = await loadConfig();

  // Load projects from store
  let projects: ProjectRow[] = [];
  try {
    const store = new Store(config.store.dbPath);
    projects = store.listProjects() as ProjectRow[];
    store.close();
  } catch {
    // Store may not exist yet
  }

  // JSON mode: output state and exit
  if (opts.json) {
    const routes = config.routes || [];
    const connected = routes
      .filter((r) => r.match.project)
      .map((r) => ({
        project: r.match.project,
        sinks: r.sinks,
      }));
    const connectedNames = new Set(connected.map((c) => c.project!.toLowerCase()));
    const unrouted = projects
      .filter((p) => !connectedNames.has(p.name.toLowerCase()))
      .map((p) => p.name);

    console.log(JSON.stringify({ projects: projects.map((p) => p.name), connected, unrouted }, null, 2));
    return;
  }

  // Interactive mode
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n  jin connect \u2014 configure project connections\n");

  if (projects.length === 0) {
    console.log("  No projects found. Run 'jin init' first to discover projects.\n");
    rl.close();
    return;
  }

  // Display projects
  console.log(`  Found ${projects.length} project${projects.length === 1 ? "" : "s"}:\n`);
  const maxNameLen = Math.max(...projects.map((p) => p.name.length));
  const maxSessionLen = Math.max(...projects.map((p) => String(p.session_count || 0).length));

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const num = String(i + 1).padStart(3);
    const name = p.name.padEnd(maxNameLen);
    const sessions = String(p.session_count || 0).padStart(maxSessionLen);
    const sessionWord = (p.session_count || 0) === 1 ? "session " : "sessions";
    const tool = (p.tools || "unknown").split(",")[0];
    const dir = p.directory || "";
    console.log(`  ${num}. ${name}  ${sessions} ${sessionWord}  ${tool.padEnd(14)}  ${dir}`);
  }

  // Show current connections
  const routes = config.routes || [];
  const connectedRoutes = routes.filter((r) => r.match.project);
  if (connectedRoutes.length > 0) {
    console.log("\n  Currently connected:");
    for (const r of connectedRoutes) {
      const sid = r.sinks[0];
      const s = config.sinks.find((s, i) => sinkId(s, i) === sid);
      const label = s ? sinkDisplayLabel(s, config.sinks.indexOf(s)) : sid;
      console.log(`    ${r.match.project} \u2192 ${label}`);
    }
  }

  // Existing sinks for reuse
  const existingSinks = (config.sinks || []).map((s, i) => ({
    id: sinkId(s, i),
    config: s,
  }));

  let connectCount = 0;

  // Interactive loop
  while (true) {
    console.log("");
    const prompt = connectCount === 0
      ? "  Connect a project (number, name, or 'done'): "
      : "  Connect another project? (number, name, or 'done'): ";
    const input = await ask(rl, prompt);

    if (input.toLowerCase() === "done" || input === "") break;

    // Resolve project
    let projectName: string;
    const num = parseInt(input);
    if (!isNaN(num) && num >= 1 && num <= projects.length) {
      projectName = projects[num - 1].name;
    } else {
      const match = projects.find((p) => p.name.toLowerCase() === input.toLowerCase());
      if (match) {
        projectName = match.name;
      } else {
        // Allow connecting to a project name not in the store
        projectName = input;
        console.log(`  Note: "${input}" not found in store. Route will be created anyway.`);
      }
    }

    // If a sink was pre-selected (e.g. from --team), skip the sink menu
    if (opts.sinkId) {
      await connectCommand(projectName, { sink: opts.sinkId });
      connectCount++;
      continue;
    }

    // Choose sink type
    console.log(`\n  Sink for ${projectName}:`);
    console.log("    1. postgres");
    console.log("    2. s3");
    console.log("    3. webhook");
    if (existingSinks.length > 0) {
      for (let i = 0; i < existingSinks.length; i++) {
        const es = existingSinks[i];
        console.log(`    ${4 + i}. Use existing: ${sinkDisplayLabel(es.config, i)}`);
      }
    }

    const sinkChoice = await ask(rl, "  > ");
    const sinkNum = parseInt(sinkChoice);

    // Using existing sink
    if (sinkNum >= 4 && sinkNum < 4 + existingSinks.length) {
      const chosen = existingSinks[sinkNum - 4];
      await connectCommand(projectName, { sink: chosen.id });
      connectCount++;
      continue;
    }

    let connectOpts: Record<string, string> = {};

    if (sinkNum === 1 || sinkChoice.toLowerCase() === "postgres") {
      const connStr = await ask(rl, "  Connection string: ");
      if (!connStr) {
        console.log("  Skipped.");
        continue;
      }
      const sinkTeamId = await ask(rl, "  Team ID (optional, press Enter to skip): ");
      connectOpts.postgres = connStr;
      if (sinkTeamId) connectOpts["team-id"] = sinkTeamId;
    } else if (sinkNum === 2 || sinkChoice.toLowerCase() === "s3") {
      const bucket = await ask(rl, "  Bucket: ");
      if (!bucket) {
        console.log("  Skipped.");
        continue;
      }
      const region = await ask(rl, "  Region [us-east-1]: ");
      const accessKey = await ask(rl, "  Access Key ID: ");
      const secretKey = await ask(rl, "  Secret Access Key: ");
      connectOpts.s3 = bucket;
      connectOpts.region = region || "us-east-1";
      if (accessKey) connectOpts["access-key-id"] = accessKey;
      if (secretKey) connectOpts["secret-access-key"] = secretKey;
    } else if (sinkNum === 3 || sinkChoice.toLowerCase() === "webhook") {
      const url = await ask(rl, "  Webhook URL: ");
      if (!url) {
        console.log("  Skipped.");
        continue;
      }
      connectOpts.webhook = url;
    } else {
      console.log("  Invalid choice, skipped.");
      continue;
    }

    await connectCommand(projectName, connectOpts);
    connectCount++;

    // Refresh existing sinks list after connecting
    const refreshedConfig = await loadConfig();
    existingSinks.length = 0;
    for (let i = 0; i < (refreshedConfig.sinks || []).length; i++) {
      const s = refreshedConfig.sinks[i];
      existingSinks.push({ id: sinkId(s, i), config: s });
    }
  }

  // Summary
  const finalConfig = await loadConfig();
  const finalConnected = (finalConfig.routes || []).filter((r) => r.match.project).length;
  const totalProjects = projects.length;
  const localOnly = totalProjects - finalConnected;

  console.log(
    `\n  Setup complete. ${finalConnected} project${finalConnected === 1 ? "" : "s"} connected, ${localOnly} local only.`,
  );
  console.log("  Run 'jin start' to begin watching.\n");

  rl.close();
}

// ── Connections Command ────────────────────────────────────────────────

/** Extract a short host/endpoint label from a sink config */
function sinkHostLabel(s: SinkConfig): string {
  if (s.type === "postgres" && s.connectionString) {
    try { return new URL(s.connectionString).hostname; } catch { return ""; }
  }
  if (s.type === "webhook" && s.url) {
    try { return new URL(s.url).hostname; } catch { return ""; }
  }
  if (s.type === "s3") return s.bucket || "";
  return "";
}

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

  // Build project lookup by name (lowercase) for directory/remote display
  const projectByName = new Map<string, any>();
  for (const p of allProjects) {
    projectByName.set(p.name.toLowerCase(), p);
  }

  // Connected routes (project-based and remote-based)
  const connectedProjects = new Set<string>();
  const routeLines: Array<{ label: string; sinkDesc: string; host: string; detail: string }> = [];

  for (const route of routes) {
    const sid = route.sinks[0];
    const s = sinkMap.get(sid);
    const sinkDesc = s ? sinkDisplayLabel(s, sinks.indexOf(s)) : sid;
    const host = s ? sinkHostLabel(s) : "";

    if (route.match.project) {
      connectedProjects.add(route.match.project.toLowerCase());
      const proj = projectByName.get(route.match.project.toLowerCase());
      const detail = proj?.directory || "";
      routeLines.push({ label: route.match.project, sinkDesc, host, detail });
    } else if (route.match.remote) {
      routeLines.push({ label: `remote:${route.match.remote}`, sinkDesc, host, detail: "" });
    } else if (route.match.directory) {
      routeLines.push({ label: `dir:${route.match.directory}`, sinkDesc, host, detail: "" });
    }
  }

  if (routeLines.length === 0 && allProjects.length === 0 && sinks.length === 0) {
    console.log("\n  No connections configured. No projects found.\n");
    console.log('  Connect a project:  jin connect <project> --postgres="..."');
    console.log("  Run guided setup:   jin connect\n");
    return;
  }

  // Show connected routes
  if (routeLines.length > 0) {
    console.log("\n  Connected:\n");
    const maxLabel = Math.max(...routeLines.map((r) => r.label.length));
    for (const r of routeLines) {
      const name = r.label.padEnd(maxLabel);
      console.log(`    ${name}  \u2192 ${r.sinkDesc}`);
    }
  }

  // Unrouted projects
  const unrouted = allProjects.filter((p: any) => !connectedProjects.has(p.name.toLowerCase()));
  if (unrouted.length > 0) {
    console.log("\n  Unrouted (local only):\n");
    const home = homedir();
    const maxName = Math.max(...unrouted.map((p: any) => p.name.length));
    for (const p of unrouted) {
      const name = p.name.padEnd(maxName);
      const shortDir = p.directory ? p.directory.replace(home, "~") : "";
      const dir = shortDir ? `  \x1b[2m${shortDir}\x1b[0m` : "";
      console.log(`    ${name}${dir}`);
    }
  }

  // Show configured sinks
  if (sinks.length > 0) {
    console.log("\n  Sinks:\n");
    for (let i = 0; i < sinks.length; i++) {
      const s = sinks[i];
      const id = sinkId(s, i);
      let host = sinkHostLabel(s);
      if (host.length > 30) host = host.slice(0, 27) + "...";
      const hostStr = host ? `  ${host}` : "";
      // Check how many routes use this sink
      const routeCount = routes.filter((r) => r.sinks.includes(id)).length;
      const usage = routeCount > 0
        ? `${routeCount} route${routeCount === 1 ? "" : "s"}`
        : "\x1b[2munused\x1b[0m";
      const displayId = s.name || id;
      console.log(`    ${displayId.padEnd(20)}  ${s.type}${hostStr}  (${usage})`);
    }
  }

  // Show default routing behavior
  if (config.routeUnmatchedToAll) {
    console.log(`\n  Default routing: ALL sinks (routeUnmatchedToAll is enabled)`);
  } else if (config.defaultSinks?.length) {
    console.log(`\n  Default routing: ${config.defaultSinks.join(", ")}`);
  } else if (sinks.length > 0) {
    console.log(`\n  Default routing: \x1b[2mnone (unmatched sessions stay local)\x1b[0m`);
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
