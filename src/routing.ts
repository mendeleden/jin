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
  // Explicit company opt-in: push everything everywhere
  if (config.routeUnmatchedToAll) return allSinks;

  // No routes configured = nothing gets pushed (opt-in only)
  if (!config.routes?.length) return [];

  // Check routes — first match wins
  const projects = store.getSessionProjects(session.id);
  for (const route of config.routes) {
    for (const project of projects) {
      if (matchesRoute(route.match, project)) {
        return allSinks.filter((s) => route.sinks.includes(s.id));
      }
    }
  }

  // No route matched — use defaultSinks or don't push
  const defaults = config.defaultSinks || [];
  if (defaults.length === 0) return [];
  return allSinks.filter((s) => defaults.includes(s.id));
}

export function matchesRoute(match: RouteMatch, project: ProjectInfo): boolean {
  if (match.project) {
    if (project.name.toLowerCase() === match.project.toLowerCase()) return true;
  }
  if (match.remote && project.gitRemote) {
    if (normalizeRemote(match.remote) === normalizeRemote(project.gitRemote)) return true;
  }
  if (match.directory && project.directory) {
    if (project.directory.toLowerCase() === match.directory.toLowerCase()) return true;
  }
  return false;
}

/** Normalize a git remote URL for comparison: lowercase, strip .git suffix and trailing slashes */
function normalizeRemote(remote: string): string {
  return remote
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}
