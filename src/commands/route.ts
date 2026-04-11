import { loadConfig, type JinConfig, type RouteMatch } from "../config";
import { normalizeAdapterId, normalizeRemote } from "../routing";
import { persistConfigChange } from "./config-control";
import { findSinkIndexById } from "./sink";

export interface RouteCommandOptions {
  sink?: string;
  remote?: string;
  adapter?: string;
  branch?: string;
  name?: string;
  yes?: boolean;
}

export async function routeAddCommand(
  opts: RouteCommandOptions,
): Promise<void> {
  if (!opts.sink) {
    fail("route add requires --sink");
  }

  const config = await loadConfig();
  if (findSinkIndexById(config, opts.sink) === -1) {
    fail(`sink "${opts.sink}" not found`);
  }

  const result = upsertRoute(config, opts, [opts.sink]);
  if (!result.changed) {
    console.log(
      `  Route ${formatRouteMatch(result.match)} already includes ${opts.sink}.`,
    );
    return;
  }

  await persistConfigChange(config, {
    yes: opts.yes,
    changeSummary: `${result.created ? "Added" : "Updated"} route ${formatRouteMatch(result.match)}`,
  });
}

export async function routeRemoveCommand(
  opts: RouteCommandOptions,
): Promise<void> {
  const config = await loadConfig();
  const result = removeRoute(config, opts, opts.sink);
  if (!result.changed) {
    fail(`route ${formatRouteMatch(result.match)} not found`);
  }

  await persistConfigChange(config, {
    yes: opts.yes,
    changeSummary: `Removed route target from ${formatRouteMatch(result.match)}`,
  });
}

export function upsertRoute(
  config: Pick<JinConfig, "routes">,
  matchInput: RouteMatch,
  sinkIds: string[],
): { created: boolean; changed: boolean; match: RouteMatch } {
  const match = normalizeRouteMatchInput(matchInput);
  const uniqueSinkIds = [...new Set(sinkIds)];

  const route = config.routes.find((candidate) =>
    sameRouteMatch(candidate.match, match),
  );
  if (!route) {
    config.routes.push({ match, sinks: uniqueSinkIds });
    return { created: true, changed: true, match };
  }

  const nextSinks = [...new Set([...route.sinks, ...uniqueSinkIds])];
  const changed = nextSinks.length !== route.sinks.length;
  route.sinks = nextSinks;
  return { created: false, changed, match };
}

export function removeRoute(
  config: Pick<JinConfig, "routes">,
  matchInput: RouteMatch,
  sinkId?: string,
): { changed: boolean; match: RouteMatch } {
  const match = normalizeRouteMatchInput(matchInput);
  const index = config.routes.findIndex((candidate) =>
    sameRouteMatch(candidate.match, match),
  );
  if (index === -1) {
    return { changed: false, match };
  }

  if (!sinkId) {
    config.routes.splice(index, 1);
    return { changed: true, match };
  }

  const route = config.routes[index];
  if (!route.sinks.includes(sinkId)) {
    return { changed: false, match };
  }

  route.sinks = route.sinks.filter((id) => id !== sinkId);
  if (route.sinks.length === 0) {
    config.routes.splice(index, 1);
  }
  return { changed: true, match };
}

export function normalizeRouteMatchInput(input: RouteMatch): RouteMatch {
  const match: RouteMatch = {};

  if (input.remote && input.remote.trim().length > 0) {
    match.remote = normalizeRemote(input.remote);
  }
  if (input.adapter && input.adapter.trim().length > 0) {
    match.adapter = normalizeAdapterId(input.adapter);
  }
  if (input.branch && input.branch.trim().length > 0) {
    match.branch = input.branch;
  }
  if (input.name && input.name.trim().length > 0) {
    match.name = input.name;
  }

  return match;
}

export function formatRouteMatch(match: RouteMatch): string {
  const parts = [
    match.remote ? `remote=${match.remote}` : "",
    match.adapter ? `adapter=${match.adapter}` : "",
    match.branch ? `branch=${match.branch}` : "",
    match.name ? `name=${match.name}` : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "all conversations";
}

function sameRouteMatch(left: RouteMatch, right: RouteMatch): boolean {
  return (
    left.remote === right.remote &&
    left.adapter === right.adapter &&
    left.branch === right.branch &&
    left.name === right.name
  );
}

function fail(message: string): never {
  console.error(`  Error: ${message}`);
  process.exit(1);
}
