import type { JinConfig, RouteMatch } from "./config";
import type { Sink } from "./sinks/types";
import type { Session } from "./adapters/types";
import type { Store } from "./store";

export interface ProjectInfo {
  id: string;
  name: string;
  directory?: string;
  gitRemote?: string;
}

export function sinksForSession(
  session: Session,
  store: Store,
  config: JinConfig,
  allSinks: Sink[],
): Sink[] {
  if (!config.routes?.length) return allSinks; // no routing = push everywhere

  const projects = store.getSessionProjects(session.id);
  for (const route of config.routes) {
    for (const project of projects) {
      if (matchesRoute(route.match, project)) {
        return allSinks.filter((s) => route.sinks.includes(s.id));
      }
    }
  }

  // No route matched — check policy
  if (config.routeUnmatchedToAll) return allSinks; // company opt-in: push everywhere
  const defaults = config.defaultSinks || [];
  if (defaults.length === 0) return []; // no default = local only, don't push
  return allSinks.filter((s) => defaults.includes(s.id));
}

export function matchesRoute(match: RouteMatch, project: ProjectInfo): boolean {
  if (match.project) {
    if (project.name.toLowerCase() === match.project.toLowerCase()) return true;
  }
  if (match.remote && project.gitRemote) {
    if (globMatch(match.remote, project.gitRemote)) return true;
  }
  if (match.directory && project.directory) {
    if (globMatch(match.directory, project.directory)) return true;
  }
  return false;
}

/** Simple glob matching supporting * as wildcard */
function globMatch(pattern: string, value: string): boolean {
  // Escape regex special chars except *
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(value);
}
