import * as readline from "readline";
import { loadConfig } from "../config";
import type { JinConfig } from "../config";
import type { SinkConfig } from "../sinks/types";
import { Store } from "../store";
import { connectCommand } from "./connect";

/** Resolve the effective ID for a sink config */
function sinkId(config: SinkConfig, index: number): string {
  return config.id || `${config.type}-${index}`;
}

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

export async function setupCommand(opts: { json?: boolean }): Promise<void> {
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

  console.log("\n  jin setup \u2014 configure project connections\n");

  if (projects.length === 0) {
    console.log("  No projects found. Run 'jin ingest' first to discover projects.\n");
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
      const label = s ? `${s.type} (${sid})` : sid;
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
    const input = await ask(rl, "  Connect a project (number, name, or 'done'): ");

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

    // Choose sink type
    console.log(`\n  Sink for ${projectName}:`);
    console.log("    1. postgres");
    console.log("    2. s3");
    console.log("    3. webhook");
    if (existingSinks.length > 0) {
      for (let i = 0; i < existingSinks.length; i++) {
        const es = existingSinks[i];
        console.log(`    ${4 + i}. Use existing: ${es.config.type} (${es.id})`);
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
