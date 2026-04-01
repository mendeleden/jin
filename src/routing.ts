import type { JinConfig, RouteConfig, RouteMatch } from "./config";
import type { Sink } from "./sinks/types";

export interface RoutableConversation {
  gitRemote?: string;
  adapterId?: string;
  branch?: string;
  name?: string;
}

export function sinkIdsForConversation(
  conversation: RoutableConversation,
  routes: ReadonlyArray<RouteConfig>,
): string[] {
  if (routes.length === 0) {
    return [];
  }

  const sinkIds: string[] = [];
  const seen = new Set<string>();

  for (const route of routes) {
    if (!matchesRoute(route.match, conversation)) {
      continue;
    }

    for (const sinkId of route.sinks) {
      if (seen.has(sinkId)) {
        continue;
      }

      seen.add(sinkId);
      sinkIds.push(sinkId);
    }
  }

  return sinkIds;
}

export function sinksForConversation(
  conversation: RoutableConversation,
  routes: ReadonlyArray<RouteConfig>,
  allSinks: ReadonlyArray<Sink>,
): Sink[] {
  const sinkIds = new Set(sinkIdsForConversation(conversation, routes));
  if (sinkIds.size === 0) {
    return [];
  }

  return allSinks.filter((sink) => sinkIds.has(sink.id));
}

// Legacy wrapper retained as a narrow bridge while callers migrate to the
// pure conversation-based API.
export function sinksForSession(
  conversationOrSession: unknown,
  routesOrStore: unknown,
  configOrSinks: Pick<JinConfig, "routes"> | ReadonlyArray<RouteConfig> | unknown,
  maybeAllSinks?: ReadonlyArray<Sink>,
): Sink[] {
  const conversation = toRoutableConversation(conversationOrSession);
  const routes =
    maybeAllSinks === undefined
      ? extractRoutes(routesOrStore)
      : extractRoutes(configOrSinks);
  const allSinks =
    maybeAllSinks === undefined
      ? extractSinks(configOrSinks)
      : [...maybeAllSinks];

  return sinksForConversation(conversation, routes, allSinks);
}

export function matchesRoute(
  match: RouteMatch,
  conversation: RoutableConversation,
): boolean {
  return (
    matchesGlob(match.remote, conversation.gitRemote, normalizeRemote) &&
    matchesGlob(match.adapter, conversation.adapterId, normalizeAdapterId) &&
    matchesGlob(match.branch, conversation.branch) &&
    matchesGlob(match.name, conversation.name)
  );
}

export function normalizeRemote(remote: string): string {
  return remote
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "")
    .replace(/^[^@]+@([^:]+):/u, "$1/")
    .replace(/^[^/]+@(?=[^/]+\/)/u, "")
    .toLowerCase()
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");
}

export function normalizeAdapterId(adapterId: string): string {
  return adapterId.trim().toLowerCase();
}

function matchesGlob(
  pattern: string | undefined,
  value: string | undefined,
  normalize: (value: string) => string = identity,
): boolean {
  if (pattern === undefined) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }

  const expression = globToRegExp(normalize(pattern));
  return expression.test(normalize(value));
}

function globToRegExp(pattern: string): RegExp {
  const source = [...pattern]
    .map((character) => {
      if (character === "*") {
        return ".*";
      }
      if (character === "?") {
        return ".";
      }
      return character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    })
    .join("");

  return new RegExp(`^${source}$`, "u");
}

function extractRoutes(
  value: Pick<JinConfig, "routes"> | ReadonlyArray<RouteConfig> | unknown,
): RouteConfig[] {
  if (Array.isArray(value)) {
    return [...value];
  }
  if (isRecord(value) && Array.isArray(value.routes)) {
    return [...value.routes];
  }
  return [];
}

function extractSinks(value: unknown): Sink[] {
  return Array.isArray(value) ? [...(value as Sink[])] : [];
}

function toRoutableConversation(value: unknown): RoutableConversation {
  if (!isRecord(value)) {
    return {
      gitRemote: "",
      adapterId: "",
      branch: "",
      name: "",
    };
  }

  return {
    gitRemote: asString(value.gitRemote) ?? "",
    adapterId: asString(value.adapterId) ?? "",
    branch: asString(value.branch) ?? "",
    name: asString(value.name) ?? "",
  };
}

function identity(value: string): string {
  return value;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
