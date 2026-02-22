import type { Store } from "../store";

type Handler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export function createRoutes(store: Store): Map<string, Handler> {
  const routes = new Map<string, Handler>();

  // --- Overview ---
  routes.set("GET /api/overview", () => {
    const sessions = store.sessionCount();
    const messages = store.messageCount();
    const artifacts = store.artifactCount();
    const byAdapter = store.analyzeByAdapter();
    let tokens = 0, cost = 0;
    for (const a of Object.values(byAdapter)) {
      tokens += a.tokens;
      cost += a.cost;
    }
    const projects = store.listProjects().length;
    return json({ sessions, messages, tokens, cost, artifacts, projects });
  });

  // --- Sessions ---
  routes.set("GET /api/sessions", (req) => {
    const url = new URL(req.url);
    const adapter = url.searchParams.get("adapter") || undefined;
    const since = url.searchParams.get("since") || undefined;
    const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined;
    const project = url.searchParams.get("project") || undefined;
    const tag = url.searchParams.get("tag") || undefined;
    const search = url.searchParams.get("search") || undefined;

    if (project || tag || search) {
      let results = store.enrichedSessions({ limit, projectId: project, tagName: tag });
      if (search) {
        const q = search.toLowerCase();
        results = results.filter((r: any) =>
          (r.name || "").toLowerCase().includes(q) ||
          (r.adapter_name || "").toLowerCase().includes(q) ||
          (r.tag_names || "").toLowerCase().includes(q) ||
          (r.project_names || "").toLowerCase().includes(q)
        );
      }
      return json(results);
    }

    const sessions = store.enrichedSessions({ limit });
    if (adapter) {
      return json(sessions.filter((s: any) => s.adapter_id === adapter));
    }
    return json(sessions);
  });

  routes.set("GET /api/sessions/:id", (_req, params) => {
    const session = store.getSession(params.id);
    if (!session) return json({ error: "Session not found" }, 404);
    const messages = store.getMessages(params.id);
    const tags = store.getSessionTags(params.id);
    return json({ session, messages, tags });
  });

  // --- Analytics ---
  routes.set("GET /api/analytics/timeline", (req) => {
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") || "30");
    return json(store.timelineByDay(days));
  });

  routes.set("GET /api/analytics/adapters", () => {
    return json(store.analyzeByAdapter());
  });

  routes.set("GET /api/analytics/models", () => {
    return json(store.analyzeByModel());
  });

  routes.set("GET /api/analytics/tools", () => {
    return json(store.analyzeToolUsage());
  });

  routes.set("GET /api/analytics/projects", () => {
    return json(store.costByProjectAndTool());
  });

  // --- Projects ---
  routes.set("GET /api/projects", () => {
    return json(store.listProjects());
  });

  routes.set("GET /api/projects/:id/sessions", (_req, params) => {
    return json(store.enrichedSessions({ projectId: params.id }));
  });

  // --- Tags ---
  routes.set("GET /api/tags", () => {
    return json(store.listTags());
  });

  // --- Artifacts ---
  routes.set("GET /api/artifacts", (req) => {
    const url = new URL(req.url);
    const adapter = url.searchParams.get("adapter") || undefined;
    const kind = url.searchParams.get("kind") || undefined;
    return json(store.listArtifacts({ adapterId: adapter, kind }));
  });

  routes.set("GET /api/artifacts/:id", (_req, params) => {
    const all = store.listArtifacts();
    const artifact = all.find((a) => a.id === params.id);
    if (!artifact) return json({ error: "Artifact not found" }, 404);
    return json(artifact);
  });

  return routes;
}

/** Match a route pattern like "GET /api/sessions/:id" against a request */
export function matchRoute(
  routes: Map<string, Handler>,
  method: string,
  pathname: string
): { handler: Handler; params: Record<string, string> } | null {
  for (const [pattern, handler] of routes) {
    const [routeMethod, routePath] = pattern.split(" ");
    if (routeMethod !== method) continue;

    const routeParts = routePath.split("/");
    const pathParts = pathname.split("/");
    if (routeParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let match = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(":")) {
        params[routeParts[i].slice(1)] = pathParts[i];
      } else if (routeParts[i] !== pathParts[i]) {
        match = false;
        break;
      }
    }
    if (match) return { handler, params };
  }
  return null;
}
