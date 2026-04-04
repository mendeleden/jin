import { configDir } from "../config";
import type { Conversation, Message } from "../contracts/conversations";
import {
  analyzeByAdapter,
  analyzeByModel,
  analyzeToolUsage,
  buildConversationTree,
  findConversationMatches,
  getOverviewSummary,
  getTraceConversations,
  listConversations,
  listProjectsByRemote,
  parseSinceInput,
  timelineByDay,
  type ConversationTreeNode,
} from "../db/query-surface";
import { getStore } from "../db/store";
import {
  createLocalControlBoundary,
  type LocalControlBoundary,
} from "./control";

type Handler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;
type QueryStore = ReturnType<typeof getStore>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export interface CreateRoutesOptions {
  queryStore?: QueryStore;
  controlBoundary?: LocalControlBoundary;
}

export function createRoutes(
  store: unknown,
  options: CreateRoutesOptions = {},
): Map<string, Handler> {
  void store;
  const routes = new Map<string, Handler>();
  const queryStore = options.queryStore ?? getStore(configDir());
  const controlBoundary =
    options.controlBoundary ?? createLocalControlBoundary();

  // --- Local control boundary ---
  routes.set("GET /api/control/status", () => {
    return json(controlBoundary.getStatus());
  });

  routes.set("POST /api/control/start", async () => {
    const result = await controlBoundary.runAction("start");
    return json(result, result.ok ? 200 : 409);
  });

  routes.set("POST /api/control/stop", async () => {
    const result = await controlBoundary.runAction("stop");
    return json(result, result.ok ? 200 : 409);
  });

  routes.set("POST /api/control/restart", async () => {
    const result = await controlBoundary.runAction("restart");
    return json(result, result.ok ? 200 : 409);
  });

  // --- Overview ---
  routes.set("GET /api/overview", () => {
    const overview = getOverviewSummary(queryStore.database);
    return json({
      sessions: overview.conversations,
      conversations: overview.conversations,
      messages: overview.messages,
      tokens: overview.tokens,
      cost: overview.cost,
      artifacts: 0,
      projects: overview.remotes,
      traces: overview.traces,
    });
  });

  // --- Sessions ---
  routes.set("GET /api/sessions", (req) => {
    const url = new URL(req.url);
    const adapter = url.searchParams.get("adapter") || undefined;
    const since = url.searchParams.get("since")
      ? parseSinceInput(url.searchParams.get("since")!)
      : undefined;
    const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined;
    const project = url.searchParams.get("project") || undefined;
    const tag = url.searchParams.get("tag") || undefined;
    const search = url.searchParams.get("search") || undefined;

    const remote = decodeProjectParam(project);
    const conversations = listConversations(queryStore.database, {
      adapterId: adapter,
      since,
      remote,
      search: search || undefined,
      limit,
    });

    if (tag) {
      return json([]);
    }

    return json(conversations.map(toSessionLike));
  });

  routes.set("GET /api/sessions/:id", (req, params) => {
    const url = new URL(req.url);
    const matches = findConversationMatches(queryStore.database, params.id, 10);
    const conversation =
      matches.find((match) => match.id === params.id) ??
      (matches.length === 1 ? matches[0] : null);
    if (!conversation) {
      return json({ error: "Session not found" }, 404);
    }

    const view = url.searchParams.get("view");
    const wantsTrace = view === "trace" || url.searchParams.get("trace") === "1";
    const wantsTree = view === "tree" || url.searchParams.get("tree") === "1";
    const traceConversations = getTraceConversations(
      queryStore.database,
      conversation.traceId,
    );
    const tree = buildConversationTree(traceConversations);

    if (wantsTrace) {
      return json({
        view: "trace",
        traceId: conversation.traceId,
        rootId: tree?.conversation.id ?? conversation.traceId,
        conversations: traceConversations.map((entry) => ({
          session: toSessionLike(entry),
          conversation: entry,
          messages: queryStore.getMessages(entry.id).map(toMessageLike),
        })),
        tree,
      });
    }

    if (wantsTree) {
      return json({
        view: "tree",
        traceId: conversation.traceId,
        tree,
      });
    }

    const node = findTreeNode(tree, conversation.id);
    const parent =
      conversation.parentId
        ? traceConversations.find((candidate) => candidate.id === conversation.parentId) ?? null
        : null;
    const children = node?.children.map((child) => toSessionLike(child.conversation)) ?? [];

    return json({
      session: toSessionLike(conversation),
      conversation,
      messages: queryStore.getMessages(conversation.id).map(toMessageLike),
      tags: [],
      parent: parent ? toSessionLike(parent) : null,
      children,
    });
  });

  // --- Analytics ---
  routes.set("GET /api/analytics/timeline", (req) => {
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") || "30");
    return json(timelineByDay(queryStore.database, days));
  });

  routes.set("GET /api/analytics/adapters", () => {
    return json(analyzeByAdapter(queryStore.database));
  });

  routes.set("GET /api/analytics/models", () => {
    return json(analyzeByModel(queryStore.database));
  });

  routes.set("GET /api/analytics/tools", () => {
    return json(analyzeToolUsage(queryStore.database));
  });

  routes.set("GET /api/analytics/projects", () => {
    return json(listProjectsByRemote(queryStore.database));
  });

  // --- Projects ---
  routes.set("GET /api/projects", () => {
    return json(listProjectsByRemote(queryStore.database));
  });

  routes.set("GET /api/projects/:id/sessions", (_req, params) => {
    const remote = decodeProjectParam(params.id);
    return json(
      listConversations(queryStore.database, { remote }).map(toSessionLike),
    );
  });

  // --- Tags ---
  routes.set("GET /api/tags", () => {
    return json([]);
  });

  // --- Artifacts ---
  routes.set("GET /api/artifacts", (req) => {
    void req;
    return json([]);
  });

  routes.set("GET /api/artifacts/:id", () => {
    return json({ error: "Artifact not found" }, 404);
  });

  return routes;
}

function decodeProjectParam(project: string | undefined): string | undefined {
  if (!project) {
    return undefined;
  }

  try {
    return decodeURIComponent(project);
  } catch {
    return project;
  }
}

function toSessionLike(conversation: Conversation) {
  const totalTokens = conversation.inputTokens + conversation.outputTokens;
  return {
    id: conversation.id,
    traceId: conversation.traceId,
    trace_id: conversation.traceId,
    parentId: conversation.parentId,
    parent_id: conversation.parentId,
    relationship: conversation.relationship,
    forkPoint: conversation.forkPoint,
    fork_point: conversation.forkPoint,
    adapterId: conversation.adapterId,
    adapter_id: conversation.adapterId,
    adapterName: conversation.adapterId,
    adapter_name: conversation.adapterId,
    name: conversation.name,
    createdAt: conversation.startedAt,
    created_at: conversation.startedAt,
    updatedAt: conversation.endedAt,
    updated_at: conversation.endedAt,
    durationMs: conversation.durationMs,
    duration_ms: conversation.durationMs,
    messageCount: conversation.messageCount,
    message_count: conversation.messageCount,
    toolCount: conversation.toolCount,
    tool_count: conversation.toolCount,
    totalTokens,
    total_tokens: totalTokens,
    inputTokens: conversation.inputTokens,
    input_tokens: conversation.inputTokens,
    outputTokens: conversation.outputTokens,
    output_tokens: conversation.outputTokens,
    cacheRead: conversation.cacheRead,
    cache_read: conversation.cacheRead,
    cacheWrite: conversation.cacheWrite,
    cache_write: conversation.cacheWrite,
    estCost: conversation.estCost,
    est_cost: conversation.estCost,
    sourcePath: conversation.sourcePath,
    source_path: conversation.sourcePath,
    sourceFormat: conversation.sourceFormat,
    source_format: conversation.sourceFormat,
    gitRemote: conversation.gitRemote,
    git_remote: conversation.gitRemote,
    branch: conversation.branch,
    model: conversation.model,
    cwd: conversation.cwd,
    isSubAgent:
      conversation.relationship === "spawned" ||
      conversation.relationship === "forked",
    parentSessionId: conversation.parentId,
    isCompacted: conversation.relationship === "compacted",
  };
}

function toMessageLike(message: Message) {
  return {
    ...message,
    sessionId: message.conversationId,
    session_id: message.conversationId,
    thinkingBlocks: message.thinkingContent
      ? [{ content: message.thinkingContent, tokenCount: message.thinkingTokens }]
      : [],
  };
}

function findTreeNode(
  node: ConversationTreeNode | null,
  conversationId: string,
): ConversationTreeNode | null {
  if (!node) {
    return null;
  }

  if (node.conversation.id === conversationId) {
    return node;
  }

  for (const child of node.children) {
    const match = findTreeNode(child, conversationId);
    if (match) {
      return match;
    }
  }

  return null;
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
