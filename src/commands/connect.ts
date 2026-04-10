import * as readline from "readline";
import { homedir } from "os";
import {
  ensureConfigDir,
  loadConfig,
  saveConfig,
  type JinConfig,
  type SinkConfig,
} from "../config";
import {
  formatRouteMatch,
  normalizeRouteMatchInput,
  removeRoute,
  upsertRoute,
} from "./route";
import {
  ensureSinkConfigured,
  findSinkIndexById,
  type SinkCandidateInput,
} from "./sink";
import { persistConfigChange } from "./config-control";
import { normalizeRemote, sinkIdsForConversation } from "../routing";
import { decodeTeamConfig, type SinkConfig as TeamSinkConfig } from "../sinks/types";
import { getRuntimePaths } from "../daemon/runtime-state";
import { openStoreAtPath } from "../db/store";
import { listProjectsByRemote } from "../db/query-surface";

interface ConnectOptions {
  sink?: string;
  team?: string;
  id?: string;
  teamId?: string;
  remote?: string;
  json?: boolean;
  yes?: boolean;
}

interface ProjectRow {
  name: string;
  session_count: number;
  tools: string;
  directory?: string;
  git_remote?: string;
  git_branch?: string;
}

interface RoutedProject {
  project: string;
  sinks: string[];
  directory?: string;
}

// Legacy compatibility bridge: BP-08's low-level v2 mutation surface now lives
// in `jin sink ...` and `jin route ...`, but the existing `connect` UX still
// maps project selection onto repo-based route rules for onboarding flows.
export async function connectCommand(
  project: string,
  opts: ConnectOptions,
): Promise<void> {
  if (usesLegacySinkShortcut(opts)) {
    fail("`jin connect` no longer creates sinks directly", [
      "  Removed flags: --postgres, --s3, --webhook",
      "  Use `jin sink add ...` to configure a destination first.",
      "  Then run `jin connect <repo> --sink=<id>` or `jin route add ...`.",
    ]);
  }

  if (!project && !opts.remote) {
    if (opts.team) {
      ensureConfigDir();
      const config = await loadConfig();
      const sinkResult = await resolveOrCreateSink(config, opts);
      if (sinkResult.created) {
        await saveConfig(config);
        console.log(`  Added sink: ${sinkDisplayLabel(sinkResult.sink)}`);
      } else {
        console.log(`  Sink already configured (${sinkResult.sinkId})`);
      }
      return interactiveConnect({ json: opts.json, sinkId: sinkResult.sinkId });
    }

    const hasSinkOpts = !!(opts.team || opts.sink);
    if (!hasSinkOpts) {
      return interactiveConnect({ json: opts.json });
    }

    fail(
      "specify a local repo or --remote",
      [
        "  Workspace onboarding:",
        "    jin connect --team=<workspace-code>",
        "    jin connect <repo> --sink=<existing-sink-id>",
        '    jin connect --remote="github.com/org/repo" --sink=<id>',
        "",
        "  Low-level integration wiring:",
        "    jin sink add <type> ...",
        '    jin route add --remote="github.com/org/repo" --sink=<id>',
      ],
    );
  }

  ensureConfigDir();
  const config = await loadConfig();
  const sinkResult = await resolveOrCreateSink(config, opts);
  const routeTarget = resolveConnectTarget(project, opts);
  const routeResult = upsertRoute(config, routeTarget.match, [sinkResult.sinkId]);

  if (!sinkResult.created && !routeResult.changed) {
    console.log(
      `  ${routeTarget.label} is already routed to ${sinkDisplayLabel(sinkResult.sink)}.`,
    );
    return;
  }

  await persistConfigChange(config, {
    yes: opts.yes,
    changeSummary: `${
      routeResult.created ? "Connected" : "Updated"
    } ${routeTarget.label} -> ${sinkDisplayLabel(sinkResult.sink)}`,
  });
}

export async function interactiveConnect(opts: {
  json?: boolean;
  sinkId?: string;
}): Promise<void> {
  const config = await loadConfig();
  const projects = loadProjects();
  const summary = summarizeProjects(projects, config);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          projects: projects.map((project) => project.name),
          connected: summary.connected,
          unrouted: summary.unrouted.map((project) => project.name),
        },
        null,
        2,
      ),
    );
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n  jin connect — workspace / repo routing\n");

  if (projects.length === 0) {
    console.log(
      "  No indexed repos found in the local store. Run 'jin start' first.\n",
    );
    rl.close();
    return;
  }

  console.log(`  Found ${projects.length} project${projects.length === 1 ? "" : "s"}:\n`);
  const maxNameLen = Math.max(...projects.map((project) => project.name.length));
  const maxSessionLen = Math.max(
    ...projects.map((project) => String(project.session_count || 0).length),
  );

  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    const num = String(index + 1).padStart(3);
    const name = project.name.padEnd(maxNameLen);
    const sessions = String(project.session_count || 0).padStart(maxSessionLen);
    const sessionWord = (project.session_count || 0) === 1 ? "session " : "sessions";
    const tool = (project.tools || "unknown").split(",")[0];
    const dir = project.directory || "";
    console.log(`  ${num}. ${name}  ${sessions} ${sessionWord}  ${tool.padEnd(14)}  ${dir}`);
  }

  if (summary.connected.length > 0) {
    console.log("\n  Currently routed:");
    for (const entry of summary.connected) {
      console.log(`    ${entry.project} → ${entry.sinks.join(", ")}`);
    }
  }

  const existingSinks = (config.sinks || []).map((sink) => ({
    id: sink.id,
    config: sink,
  }));

  if (!opts.sinkId && existingSinks.length === 0) {
    console.log("\n  No workspace or integration destinations are configured yet.");
    console.log("  Workspace onboarding: jin connect --team=<workspace-code>");
    console.log("  Generic integration:  jin sink add <type> ...");
    console.log("  Then route repos with `jin connect <repo> --sink=<id>` or `jin route add ...`.\n");
    rl.close();
    return;
  }

  let connectCount = 0;

  while (true) {
    console.log("");
    const prompt =
      connectCount === 0
        ? "  Connect a repo (number, name, or 'done'): "
        : "  Connect another repo? (number, name, or 'done'): ";
    const input = await ask(rl, prompt);

    if (input.toLowerCase() === "done" || input === "") {
      break;
    }

    const projectName = resolveProjectSelection(projects, input);
    if (!projectName) {
      console.log("  Project not found in the local store. Try a listed number or name.");
      continue;
    }

    if (opts.sinkId) {
      await connectCommand(projectName, { sink: opts.sinkId });
      connectCount += 1;
      continue;
    }

    console.log(`\n  Destination for ${projectName}:`);
    for (let index = 0; index < existingSinks.length; index += 1) {
      const existing = existingSinks[index];
      console.log(`    ${index + 1}. ${sinkDisplayLabel(existing.config)}`);
    }

    const sinkChoice = await ask(rl, "  > ");
    const sinkNum = Number.parseInt(sinkChoice, 10);

    if (Number.isNaN(sinkNum) || sinkNum < 1 || sinkNum > existingSinks.length) {
      console.log("  Invalid choice, skipped.");
      continue;
    }

    await connectCommand(projectName, { sink: existingSinks[sinkNum - 1].id });
    connectCount += 1;

    const refreshedConfig = await loadConfig();
    existingSinks.length = 0;
    for (const sink of refreshedConfig.sinks || []) {
      existingSinks.push({ id: sink.id, config: sink });
    }
  }

  const finalConfig = await loadConfig();
  const finalSummary = summarizeProjects(projects, finalConfig);
  console.log(
    `\n  Setup complete. ${finalSummary.connected.length} repo${
      finalSummary.connected.length === 1 ? "" : "s"
    } routed, ${finalSummary.unrouted.length} local only.`,
  );
  console.log("  Run 'jin start' if the local daemon is not already running.\n");

  rl.close();
}

export async function connectionsCommand(): Promise<void> {
  const config = await loadConfig();
  const projects = loadProjects();
  const summary = summarizeProjects(projects, config);

  if (
    config.routes.length === 0 &&
    projects.length === 0 &&
    config.sinks.length === 0
  ) {
    console.log("\n  No workspace or integration routing configured. No indexed repos found.\n");
    console.log("  Workspace setup:    jin connect --team=<workspace-code>");
    console.log("  Add integration:    jin sink add <type> ...");
    console.log("  Guided repo route:  jin connect\n");
    return;
  }

  if (config.routes.length > 0) {
    console.log("\n  Routes:\n");
    for (const route of config.routes) {
      const sinkLabels = route.sinks.map((sinkId) => sinkLabelForId(config, sinkId));
      console.log(`    ${formatRouteMatch(route.match)}  → ${sinkLabels.join(", ")}`);
    }
  }

  if (summary.connected.length > 0) {
    console.log("\n  Routed Repos:\n");
    const maxName = Math.max(...summary.connected.map((entry) => entry.project.length));
    for (const entry of summary.connected) {
      const name = entry.project.padEnd(maxName);
      console.log(`    ${name}  → ${entry.sinks.join(", ")}`);
    }
  }

  if (summary.unrouted.length > 0) {
    console.log("\n  Local-only Repos:\n");
    const home = homedir();
    const maxName = Math.max(...summary.unrouted.map((project) => project.name.length));
    for (const project of summary.unrouted) {
      const name = project.name.padEnd(maxName);
      const shortDir = project.directory ? project.directory.replace(home, "~") : "";
      const dir = shortDir ? `  \x1b[2m${shortDir}\x1b[0m` : "";
      console.log(`    ${name}${dir}`);
    }
  }

  if (config.sinks.length > 0) {
    console.log("\n  Destinations:\n");
    for (const sink of config.sinks) {
      const routeCount = config.routes.filter((route) => route.sinks.includes(sink.id)).length;
      const usage =
        routeCount > 0
          ? `${routeCount} route${routeCount === 1 ? "" : "s"}`
          : "\x1b[2munused\x1b[0m";
      const state = sink.enabled === false ? "  \x1b[33mdisabled\x1b[0m" : "";
      console.log(
        `    ${sinkDisplayLabel(sink).padEnd(24)}  ${sink.type}${state}  (${usage})`,
      );
    }
  }

  console.log("");
}

export async function disconnectCommand(
  project: string,
  opts: { "remove-sink"?: boolean; removeSink?: boolean; yes?: boolean },
): Promise<void> {
  if (!project) {
    fail("specify a project to disconnect", [
      "  Usage: jin disconnect <project> [--remove-sink]",
    ]);
  }

  const config = await loadConfig();
  const target = resolveProjectTarget(project);
  const match = normalizeRouteMatchInput(target.match);
  const route = config.routes.find((candidate) => matchesExactRoute(candidate.match, match));
  if (!route) {
    fail(`no connection found for "${project}"`, [
      "  Run 'jin connections' to see current connections.",
    ]);
  }

  const removedSinkIds = [...route.sinks];
  removeRoute(config, match);

  if (opts["remove-sink"] || opts.removeSink) {
    for (const sinkId of removedSinkIds) {
      const stillUsed = config.routes.some((candidate) => candidate.sinks.includes(sinkId));
      if (stillUsed) {
        console.log(`  Sink ${sinkId} is still used by other routes, kept.`);
        continue;
      }

      const sinkIndex = findSinkIndexById(config, sinkId);
      if (sinkIndex >= 0) {
        config.sinks.splice(sinkIndex, 1);
        console.log(`  Removed sink: ${sinkId}`);
      }
    }
  }

  await persistConfigChange(config, {
    yes: opts.yes,
    changeSummary: `Disconnected ${project} (${formatRouteMatch(match)})`,
  });
}

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

function resolveProjectSelection(
  projects: ProjectRow[],
  input: string,
): string | null {
  const num = Number.parseInt(input, 10);
  if (!Number.isNaN(num) && num >= 1 && num <= projects.length) {
    return projects[num - 1].name;
  }

  const match = projects.find(
    (project) => project.name.toLowerCase() === input.toLowerCase(),
  );
  return match?.name ?? null;
}

function loadProjects(): ProjectRow[] {
  const storePath = getRuntimePaths().storePath;
  let store: ReturnType<typeof openStoreAtPath> | null = null;

  try {
    store = openStoreAtPath(storePath);
    return listProjectsByRemote(store.database).map((project) => ({
      name: remoteRepoName(project.gitRemote),
      session_count: project.conversationCount,
      tools: project.tools,
      git_remote: project.gitRemote,
    }));
  } catch {
    return [];
  } finally {
    store?.close();
  }
}

function summarizeProjects(
  projects: ProjectRow[],
  config: Pick<JinConfig, "routes" | "sinks">,
): {
  connected: RoutedProject[];
  unrouted: ProjectRow[];
} {
  const connected: RoutedProject[] = [];
  const unrouted: ProjectRow[] = [];

  for (const project of projects) {
    const sinkIds = sinkIdsForConversation(projectConversation(project), config.routes);
    if (sinkIds.length === 0) {
      unrouted.push(project);
      continue;
    }

    connected.push({
      project: project.name,
      sinks: sinkIds.map((sinkId) => sinkLabelForId(config, sinkId)),
      ...(project.directory ? { directory: project.directory } : {}),
    });
  }

  return { connected, unrouted };
}

function projectConversation(project: ProjectRow) {
  return {
    gitRemote: project.git_remote,
    branch: project.git_branch,
  };
}

function sinkLabelForId(
  config: Pick<JinConfig, "sinks">,
  sinkId: string,
): string {
  const sink = config.sinks.find((candidate) => candidate.id === sinkId);
  return sink ? sinkDisplayLabel(sink) : sinkId;
}

function sinkDisplayLabel(sink: SinkConfig): string {
  return `${sink.id} (${sink.type})`;
}

async function resolveOrCreateSink(
  config: JinConfig,
  opts: ConnectOptions,
): Promise<{ sinkId: string; created: boolean; sink: SinkConfig }> {
  if (opts.sink) {
    const sinkIndex = findSinkIndexById(config, opts.sink);
    if (sinkIndex === -1) {
      fail(`sink "${opts.sink}" not found`, [
        `  Available sinks: ${config.sinks.map((sink) => sink.id).join(", ") || "(none configured)"}`,
      ]);
    }

    return {
      sinkId: opts.sink,
      created: false,
      sink: config.sinks[sinkIndex],
    };
  }

  if (opts.team) {
    const decoded = decodeTeamConfig(opts.team);
    return ensureSinkConfigured(config, toSinkCandidate(decoded, opts));
  }

  fail("specify a sink type or existing sink", [
    "    --sink=<existing-sink-id>",
    "    --team=<workspace-code>",
    "",
    "  Low-level BYO integration:",
    "    jin sink add <type> ...",
    '    jin route add --remote="github.com/org/repo" --sink=<id>',
  ]);
}

function toSinkCandidate(
  decoded: TeamSinkConfig,
  opts: ConnectOptions,
): SinkCandidateInput {
  switch (decoded.type) {
    case "postgres":
      return {
        type: "postgres",
        id: opts.id || decoded.id,
        connectionString: decoded.connectionString,
      };
    case "webhook":
      return {
        type: "webhook",
        id: opts.id || decoded.id,
        url: decoded.url,
        headers: decoded.headers,
      };
    case "s3":
      return {
        type: "s3",
        id: opts.id || decoded.id,
        bucket: decoded.bucket,
        region: decoded.region,
        endpoint: decoded.endpoint,
        accessKeyId: decoded.accessKeyId,
        secretAccessKey: decoded.secretAccessKey,
        prefix: decoded.prefix,
      };
  }
}

function resolveConnectTarget(
  project: string,
  opts: ConnectOptions,
): { match: { remote?: string }; label: string } {
  if (opts.remote) {
    const remote = normalizeRemote(opts.remote);
    return {
      match: { remote },
      label: `remote:${remote}`,
    };
  }

  return resolveProjectTarget(project);
}

function resolveProjectTarget(
  projectName: string,
): { match: { remote?: string }; label: string } {
  const project = loadProjects().find(
    (candidate) => candidate.name.toLowerCase() === projectName.toLowerCase(),
  );
  if (!project) {
    fail(`repo "${projectName}" was not found in the local store`, [
      "  Run `jin connect --remote=...` if you want to route an unindexed repo.",
    ]);
  }

  return {
    match: { remote: requireProjectRemote(project) },
    label: project.name,
  };
}

function requireProjectRemote(project: ProjectRow): string {
  if (!project.git_remote) {
    fail(`repo "${project.name}" does not have a git remote`, [
      "  BP-08 routes repos by remote identity, not by cwd.",
      "  Use `jin connect --remote=...` if you need an explicit rule.",
    ]);
  }

  return normalizeRemote(project.git_remote);
}

function matchesExactRoute(
  left: { remote?: string; adapter?: string; branch?: string; name?: string },
  right: { remote?: string; adapter?: string; branch?: string; name?: string },
): boolean {
  return (
    left.remote === right.remote &&
    left.adapter === right.adapter &&
    left.branch === right.branch &&
    left.name === right.name
  );
}

function fail(message: string, details: string[] = []): never {
  console.error(`  Error: ${message}`);
  for (const detail of details) {
    console.error(detail);
  }
  process.exit(1);
}

function usesLegacySinkShortcut(opts: ConnectOptions): boolean {
  const legacy = opts as ConnectOptions & {
    postgres?: string;
    s3?: string;
    webhook?: string;
  };
  return !!(legacy.postgres || legacy.s3 || legacy.webhook);
}

function remoteRepoName(remote: string): string {
  const trimmed = remote.replace(/\/+$/, "");
  const lastPathSegment = trimmed.split(/[/:]/).pop() || trimmed;
  return lastPathSegment.replace(/\.git$/, "") || trimmed;
}
