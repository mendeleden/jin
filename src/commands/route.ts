import { loadConfig, saveConfig } from "../config";
import type { RouteConfig } from "../config";

export async function routeCommand(
  subcommand: string | undefined,
  opts: {
    project?: string;
    remote?: string;
    directory?: string;
    sink?: string;
    index?: number;
  },
): Promise<void> {
  switch (subcommand) {
    case "add":
      return routeAdd(opts);
    case "list":
    case "ls":
    case undefined:
      return routeList();
    case "remove":
    case "rm":
      return routeRemove(opts.index);
    default:
      console.log("  Usage:");
      console.log("    jin route list                              Show routing rules");
      console.log("    jin route add --project=X --sink=Y          Route by project name");
      console.log('    jin route add --remote="github.com/org/*" --sink=Y');
      console.log("    jin route add --directory=/path/* --sink=Y");
      console.log("    jin route remove <index>                    Remove a rule");
  }
}

async function routeAdd(opts: {
  project?: string;
  remote?: string;
  directory?: string;
  sink?: string;
}): Promise<void> {
  if (!opts.sink) {
    console.error("  Error: --sink is required. Specify the sink ID to route to.");
    console.error("  Example: jin route add --project=myapp --sink=team-postgres");
    process.exit(1);
  }

  if (!opts.project && !opts.remote && !opts.directory) {
    console.error("  Error: Specify at least one match condition:");
    console.error("    --project=<name>     Match by project name");
    console.error('    --remote=<glob>      Match by git remote (e.g. "github.com/acme/*")');
    console.error("    --directory=<glob>   Match by directory path");
    process.exit(1);
  }

  const config = await loadConfig();

  // Validate sink ID exists
  const sinkIds = (config.sinks || []).map((s, i) => s.id || `${s.type}-${i}`);
  if (!sinkIds.includes(opts.sink)) {
    console.error(`  Error: Sink "${opts.sink}" not found.`);
    console.error(`  Available sinks: ${sinkIds.join(", ") || "(none configured)"}`);
    process.exit(1);
  }

  const route: RouteConfig = {
    match: {},
    sinks: [opts.sink],
  };

  if (opts.project) route.match.project = opts.project;
  if (opts.remote) route.match.remote = opts.remote;
  if (opts.directory) route.match.directory = opts.directory;

  if (!config.routes) config.routes = [];
  config.routes.push(route);
  await saveConfig(config);

  const matchDesc = opts.project
    ? `project "${opts.project}"`
    : opts.remote
      ? `remote "${opts.remote}"`
      : `directory "${opts.directory}"`;

  console.log(`  Route added: ${matchDesc} \u2192 ${opts.sink}`);
}

async function routeList(): Promise<void> {
  const config = await loadConfig();
  const routes = config.routes || [];

  if (routes.length === 0) {
    console.log("  No routing rules configured.");
    console.log("  All sessions push to all sinks (default behavior).");
    console.log("");
    console.log("  Add a route:");
    console.log("    jin route add --project=myapp --sink=team-postgres");
    return;
  }

  console.log("\n  Routing rules:\n");
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const match = r.match.project
      ? `project: ${r.match.project}`
      : r.match.remote
        ? `remote: ${r.match.remote}`
        : r.match.directory
          ? `dir: ${r.match.directory}`
          : "?";
    console.log(`  ${i}  ${match}  \u2192  ${r.sinks.join(", ")}`);
  }

  if (config.routeUnmatchedToAll) {
    console.log(`\n  default: ALL sinks (routeUnmatchedToAll is enabled)`);
  } else {
    const defaultLabel = config.defaultSinks?.length
      ? config.defaultSinks.join(", ")
      : "(not pushed \u2014 opt-in only)";
    console.log(`\n  default: ${defaultLabel}`);

    if (!config.defaultSinks?.length) {
      console.log("  Sessions not matching any route stay local only.");
    }
  }
  console.log("");
}

async function routeRemove(index: number | undefined): Promise<void> {
  if (index === undefined || isNaN(index)) {
    console.error("  Usage: jin route remove <index>");
    console.error("  Run `jin route list` to see indices.");
    process.exit(1);
  }

  const config = await loadConfig();
  const routes = config.routes || [];

  if (index < 0 || index >= routes.length) {
    console.error(`  Error: Index ${index} out of range (0-${routes.length - 1}).`);
    process.exit(1);
  }

  const removed = routes.splice(index, 1)[0];
  config.routes = routes;
  await saveConfig(config);

  const match = removed.match.project || removed.match.remote || removed.match.directory || "?";
  console.log(`  Removed route: ${match} \u2192 ${removed.sinks.join(", ")}`);
}
