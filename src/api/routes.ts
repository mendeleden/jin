import { configDir, loadConfig, type JinConfig, type SinkConfig } from "../config";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import type { Conversation, Message } from "../contracts/conversations";
import type {
  DesktopAdapterSummary,
  DesktopCompatibilityInfo,
  DesktopConversationDetailView,
  DesktopConversationListRequest,
  DesktopConversationListView,
  DesktopHomeData,
  DesktopHomeRequest,
  DesktopLogsRequest,
  DesktopLogsView,
  DesktopModelSummary,
  DesktopProjectHarnessSummary,
  DesktopProjectSummary,
  DesktopRoutingProjectFlow,
  DesktopRoutingSinkSummary,
  DesktopRoutingView,
  DesktopTokenUsageDay,
  DesktopTokenUsageWeek,
  DesktopTraceView,
  DesktopTreeView,
  DesktopToolSummary,
} from "../contracts/desktop";
import {
  CLI_UPDATE_COMMAND,
  DESKTOP_API_VERSION,
  DESKTOP_HOME_TOKEN_USAGE_DEFAULT_DAYS,
  DESKTOP_HOME_TOKEN_USAGE_MAX_DAYS,
  DESKTOP_MINIMUM_API_VERSION,
  DESKTOP_UPDATE_COMMAND,
} from "../contracts/desktop";
import {
  analyzeByAdapter,
  analyzeByModel,
  analyzeToolUsage,
  buildConversationTree,
  findConversationMatches,
  getOverviewSummary,
  getTraceConversations,
  listAvailableAdapters,
  listConversations,
  listProjectUsageByHarness,
  listProjectsByRemote,
  parseSinceInput,
  summarizeRelationships,
  timelineByDay,
  timelineByWeek,
  type ConversationTreeNode,
} from "../db/query-surface";
import { getStore } from "../db/store";
import { sinkIdsForConversation } from "../routing";
import { VERSION } from "../updater";
import {
  createLocalControlBoundary,
  type LocalControlBoundary,
} from "./control";

type Handler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;
type QueryStore = ReturnType<typeof getStore>;

export const DESKTOP_CONVERSATION_LIST_DEFAULT_LIMIT = 48;
export const DESKTOP_CONVERSATION_LIST_MAX_LIMIT = 200;
export const DESKTOP_LOGS_DEFAULT_LIMIT = 240;
export const DESKTOP_LOGS_MAX_LIMIT = 2_000;
const DESKTOP_LOGS_READ_CHUNK_BYTES = 64 * 1024;

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
  options: CreateRoutesOptions = {},
): Map<string, Handler> {
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

  routes.set("POST /api/control/config/reload", async () => {
    if (!controlBoundary.reloadConfig) {
      return json(
        { error: "Config reload is not available for this runtime." },
        409,
      );
    }

    const result = await controlBoundary.reloadConfig("command");
    return json(result, result.accepted ? 202 : 409);
  });

  routes.set("GET /api/desktop/compatibility", () => {
    return json(buildDesktopCompatibilityInfo());
  });

  routes.set("GET /api/desktop/home", (req) => {
    return json(buildDesktopHomeData(queryStore, req));
  });

  routes.set("GET /api/desktop/conversations", (req) => {
    return json(buildDesktopConversationListView(queryStore, req));
  });

  routes.set("GET /api/desktop/logs", (req) => {
    return json(buildDesktopLogsView(controlBoundary.getStatus().paths.log, req));
  });

  routes.set("GET /api/desktop/routing", async () => {
    return json(await buildDesktopRoutingView(queryStore));
  });

  routes.set("GET /api/desktop/conversations/:id", (_req, params) => {
    const conversation = resolveConversation(queryStore, params.id);
    if (!conversation) {
      return json({ error: "Conversation not found" }, 404);
    }

    return json(buildDesktopConversationDetailView(queryStore, conversation));
  });

  routes.set("GET /api/desktop/conversations/:id/trace", (_req, params) => {
    const conversation = resolveConversation(queryStore, params.id);
    if (!conversation) {
      return json({ error: "Conversation not found" }, 404);
    }

    return json(buildDesktopTraceView(queryStore, conversation));
  });

  routes.set("GET /api/desktop/conversations/:id/tree", (_req, params) => {
    const conversation = resolveConversation(queryStore, params.id);
    if (!conversation) {
      return json({ error: "Conversation not found" }, 404);
    }

    return json(buildDesktopTreeView(queryStore, conversation));
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

  // --- Conversations (legacy /api/sessions aliases kept for existing clients) ---
  const listConversationsHandler: Handler = (req) => {
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
  };

  routes.set("GET /api/conversations", listConversationsHandler);
  routes.set("GET /api/sessions", listConversationsHandler);

  routes.set("GET /api/search", (req) => {
    const url = new URL(req.url);
    const query =
      url.searchParams.get("q") ||
      url.searchParams.get("query") ||
      "";
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return json({ error: "Missing required search query" }, 400);
    }

    const adapter = url.searchParams.get("adapter") || undefined;
    const since = url.searchParams.get("since")
      ? parseSinceInput(url.searchParams.get("since")!)
      : undefined;
    const limit = url.searchParams.get("limit")
      ? parseInt(url.searchParams.get("limit")!, 10)
      : undefined;

    return json(
      queryStore.searchMessages({
        query: trimmedQuery,
        adapterId: adapter,
        since,
        limit,
      }),
    );
  });

  const getConversationHandler: Handler = (req, params) => {
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
  };

  routes.set("GET /api/conversations/:id", getConversationHandler);
  routes.set("GET /api/sessions/:id", getConversationHandler);

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

  const listProjectConversationsHandler: Handler = (_req, params) => {
    const remote = decodeProjectParam(params.id);
    return json(
      listConversations(queryStore.database, { remote }).map(toSessionLike),
    );
  };

  routes.set("GET /api/projects/:id/conversations", listProjectConversationsHandler);
  routes.set("GET /api/projects/:id/sessions", listProjectConversationsHandler);

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

function buildDesktopCompatibilityInfo(): DesktopCompatibilityInfo {
  return {
    jinVersion: VERSION,
    desktopApiVersion: DESKTOP_API_VERSION,
    minimumDesktopApiVersion: DESKTOP_MINIMUM_API_VERSION,
    updateCommand: DESKTOP_UPDATE_COMMAND,
    cliUpdateCommand: CLI_UPDATE_COMMAND,
  };
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

export function buildDesktopHomeData(
  queryStore: QueryStore,
  request: Request | DesktopHomeRequest = {},
): DesktopHomeData {
  const overview = getOverviewSummary(queryStore.database);
  const tokenUsageDays = normalizeDesktopHomeTokenUsageDays(request);

  return {
    generatedAt: new Date().toISOString(),
    overview: {
      conversations: overview.conversations,
      messages: overview.messages,
      toolCalls: overview.toolCalls,
      traces: overview.traces,
      tokens: overview.tokens,
      displayTokens: overview.displayTokens,
      cacheTokens: overview.cacheTokens,
      cost: overview.cost,
      projects: overview.remotes,
    },
    recentConversations: listConversations(queryStore.database, { limit: 6 }),
    topAdapters: summarizeAdapters(queryStore.database),
    topModels: summarizeModels(queryStore.database),
    topTools: summarizeTools(queryStore.database),
    topProjects: summarizeProjects(queryStore.database),
    projectUsageByHarness: summarizeProjectUsageByHarness(queryStore.database),
    relationshipMix: summarizeRelationships(queryStore.database),
    tokenUsageByDay: summarizeTokenUsageByDay(
      queryStore.database,
      tokenUsageDays,
    ),
    tokenUsageByWeek: summarizeTokenUsageByWeek(
      queryStore.database,
      tokenUsageDays,
    ),
  };
}

export function buildDesktopConversationListView(
  queryStore: QueryStore,
  request: Request | DesktopConversationListRequest,
): DesktopConversationListView {
  const filters = normalizeDesktopConversationListRequest(request);
  const since = filters.since ? parseSinceInput(filters.since) : undefined;
  const conversations = listConversations(queryStore.database, {
    adapterId: filters.adapterId ?? undefined,
    since,
    limit: filters.limit,
  });

  return {
    generatedAt: new Date().toISOString(),
    filters,
    availableAdapters: listAvailableAdapters(queryStore.database),
    relationshipMix: summarizeRelationships(queryStore.database, {
      adapterId: filters.adapterId ?? undefined,
      since,
    }),
    conversations,
  };
}

export function buildDesktopLogsView(
  logPath: string,
  request: Request | DesktopLogsRequest,
): DesktopLogsView {
  const limit = normalizeDesktopLogsLimit(request);
  const logs = readLogLines(logPath, limit);

  return {
    generatedAt: new Date().toISOString(),
    path: logPath,
    limit,
    totalLines: logs.totalLines,
    returnedLines: logs.lines.length,
    truncated: logs.totalLines > logs.lines.length,
    lines: logs.lines,
  };
}

export async function buildDesktopRoutingView(
  queryStore: QueryStore,
  config?: JinConfig,
): Promise<DesktopRoutingView> {
  const effectiveConfig = config ?? await loadConfig();
  const sinks = effectiveConfig.sinks.map(toDesktopRoutingSinkSummary);
  const activeSinkIds = new Set(
    sinks.filter((sink) => sink.enabled).map((sink) => sink.id),
  );

  return {
    generatedAt: new Date().toISOString(),
    sinks,
    routes: effectiveConfig.routes.map((route, index) => ({
      index,
      match: route.match,
      sinkIds: [...route.sinks],
    })),
    projects: listProjectsByRemote(queryStore.database).map((project) =>
      buildDesktopRoutingProjectFlow(
        queryStore,
        effectiveConfig,
        activeSinkIds,
        project,
      ),
    ),
  };
}

export function buildDesktopConversationDetailView(
  queryStore: QueryStore,
  conversation: Conversation,
): DesktopConversationDetailView {
  const traceConversations = getTraceConversations(
    queryStore.database,
    conversation.traceId,
  );
  const tree = buildConversationTree(traceConversations);
  const node = findTreeNode(tree, conversation.id);
  const parent =
    conversation.parentId
      ? traceConversations.find(
          (entry) => entry.id === conversation.parentId,
        ) ?? null
      : null;

  return {
    conversation,
    messages: queryStore.getMessages(conversation.id),
    toolCalls: queryStore.getToolCalls(conversation.id),
    parent,
    children: node?.children.map((child) => child.conversation) ?? [],
    trace: {
      traceId: conversation.traceId,
      rootId: tree?.conversation.id ?? conversation.traceId,
      conversationCount: traceConversations.length,
    },
  };
}

function toDesktopRoutingSinkSummary(sink: SinkConfig): DesktopRoutingSinkSummary {
  return {
    id: sink.id,
    type: sink.type,
    enabled: sink.enabled !== false,
    name: sink.name ?? "",
    teamId: sink.teamId ?? "",
    userId: sink.userId ?? "",
  };
}

function buildDesktopRoutingProjectFlow(
  queryStore: QueryStore,
  config: JinConfig,
  activeSinkIds: Set<string>,
  project: ReturnType<typeof listProjectsByRemote>[number],
): DesktopRoutingProjectFlow {
  const conversations = listConversations(queryStore.database, {
    remote: project.gitRemote,
  });
  const routedBySink = new Map<string, number>();
  let routedConversations = 0;
  let unroutedConversations = 0;

  for (const conversation of conversations) {
    const sinkIds = sinkIdsForConversation(conversation, config.routes);
    const activeIds = sinkIds.filter((sinkId) => activeSinkIds.has(sinkId));
    if (activeIds.length === 0) {
      unroutedConversations += 1;
      continue;
    }

    routedConversations += 1;
    for (const sinkId of activeIds) {
      routedBySink.set(sinkId, (routedBySink.get(sinkId) ?? 0) + 1);
    }
  }

  return {
    id: project.id,
    name: project.name,
    gitRemote: project.gitRemote,
    conversationCount: project.conversationCount,
    routedConversations,
    unroutedConversations,
    totalTokens: project.totalTokens,
    totalCost: project.totalCost,
    lastSeen: project.lastSeen,
    adapters: project.tools
      .split(",")
      .map((adapter) => adapter.trim())
      .filter((adapter) => adapter.length > 0)
      .sort((left, right) => left.localeCompare(right)),
    sinks: Array.from(routedBySink.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([sinkId, count]) => ({
        sinkId,
        routedConversations: count,
        active: true,
      })),
  };
}

export function buildDesktopTraceView(
  queryStore: QueryStore,
  conversation: Conversation,
): DesktopTraceView {
  const conversations = getTraceConversations(
    queryStore.database,
    conversation.traceId,
  );
  const tree = buildConversationTree(conversations);

  return {
    traceId: conversation.traceId,
    rootId: tree?.conversation.id ?? conversation.traceId,
    selectedConversationId: conversation.id,
    conversations: conversations.map((entry) => ({
      conversation: entry,
      messages: [],
      toolCalls: [],
    })),
    tree,
  };
}

export function buildDesktopTreeView(
  queryStore: QueryStore,
  conversation: Conversation,
): DesktopTreeView {
  const traceView = buildDesktopTraceView(queryStore, conversation);
  return {
    traceId: traceView.traceId,
    selectedConversationId: conversation.id,
    tree: traceView.tree,
  };
}

function summarizeAdapters(database: QueryStore["database"]): DesktopAdapterSummary[] {
  return Object.entries(analyzeByAdapter(database))
    .map(([adapterId, summary]) => ({
      adapterId,
      conversations: summary.conversations,
      messages: summary.messages,
      tokens: summary.tokens,
      displayTokens: summary.displayTokens,
      cacheTokens: summary.cacheTokens,
      cost: summary.cost,
    }))
    .sort((left, right) => {
      return (
        right.conversations - left.conversations ||
        right.tokens - left.tokens ||
        right.cost - left.cost
      );
    })
    .slice(0, 5);
}

function summarizeTools(database: QueryStore["database"]): DesktopToolSummary[] {
  return analyzeToolUsage(database).slice(0, 5).map((entry) => ({
    name: entry.tool_name,
    calls: entry.total_calls,
    conversationCount: entry.conversation_count,
  }));
}

function summarizeModels(database: QueryStore["database"]): DesktopModelSummary[] {
  return Object.entries(analyzeByModel(database))
    .map(([model, summary]) => ({
      model,
      messages: summary.messages,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
    }))
    .sort((left, right) => {
      return (
        right.messages - left.messages ||
        right.inputTokens + right.outputTokens -
          (left.inputTokens + left.outputTokens) ||
        left.model.localeCompare(right.model)
      );
    })
    .slice(0, 8);
}

function summarizeProjects(database: QueryStore["database"]): DesktopProjectSummary[] {
  return listProjectsByRemote(database).slice(0, 5).map((project) => ({
    id: project.id,
    name: project.name,
    gitRemote: project.gitRemote,
    conversationCount: project.conversationCount,
    totalTokens: project.totalTokens,
    totalCost: project.totalCost,
    lastSeen: project.lastSeen,
    adapters: splitProjectAdapters(project.tools),
  }));
}

function summarizeProjectUsageByHarness(
  database: QueryStore["database"],
): DesktopProjectHarnessSummary[] {
  return listProjectUsageByHarness(database, 7);
}

function summarizeTokenUsageByDay(
  database: QueryStore["database"],
  days: number,
): DesktopTokenUsageDay[] {
  return timelineByDay(database, days).map((entry) => ({
    day: entry.day,
    adapterId: entry.adapter_id,
    sessions: entry.sessions,
    tokens: entry.tokens,
    cost: entry.cost,
  }));
}

function summarizeTokenUsageByWeek(
  database: QueryStore["database"],
  days: number,
): DesktopTokenUsageWeek[] {
  return timelineByWeek(database, days).map((entry) => ({
    weekStart: entry.week_start,
    weekEnd: entry.week_end,
    adapterId: entry.adapter_id,
    sessions: entry.sessions,
    tokens: entry.tokens,
    cost: entry.cost,
  }));
}

function normalizeDesktopHomeTokenUsageDays(
  request: Request | DesktopHomeRequest,
): number {
  let value: number | string | null | undefined;
  if (request instanceof Request) {
    const searchParams = new URL(request.url).searchParams;
    value = searchParams.get("tokenUsageDays") ?? searchParams.get("days");
  } else {
    value = request.tokenUsageDays;
  }

  const days =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : DESKTOP_HOME_TOKEN_USAGE_DEFAULT_DAYS;

  if (!Number.isFinite(days) || days <= 0) {
    return DESKTOP_HOME_TOKEN_USAGE_DEFAULT_DAYS;
  }

  return Math.min(Math.floor(days), DESKTOP_HOME_TOKEN_USAGE_MAX_DAYS);
}

function splitProjectAdapters(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeDesktopConversationListRequest(
  request: Request | DesktopConversationListRequest,
): DesktopConversationListView["filters"] {
  if (request instanceof Request) {
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");

    return {
      adapterId: url.searchParams.get("adapter") || null,
      since: url.searchParams.get("since") || null,
      limit: normalizeDesktopConversationLimit(limit),
    };
  }

  return {
    adapterId: request.adapterId ?? null,
    since: request.since ?? null,
    limit: normalizeDesktopConversationLimit(request.limit),
  };
}

function normalizeDesktopConversationLimit(value: unknown): number {
  const limit =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : DESKTOP_CONVERSATION_LIST_DEFAULT_LIMIT;

  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    return DESKTOP_CONVERSATION_LIST_DEFAULT_LIMIT;
  }

  return Math.min(limit, DESKTOP_CONVERSATION_LIST_MAX_LIMIT);
}

function normalizeDesktopLogsLimit(request: Request | DesktopLogsRequest): number {
  const value =
    request instanceof Request
      ? new URL(request.url).searchParams.get("limit")
      : request.limit;

  const limit =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : DESKTOP_LOGS_DEFAULT_LIMIT;

  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    return DESKTOP_LOGS_DEFAULT_LIMIT;
  }

  return Math.min(limit, DESKTOP_LOGS_MAX_LIMIT);
}

function readLogLines(logPath: string, limit: number): { lines: string[]; totalLines: number } {
  if (!existsSync(logPath)) {
    return { lines: [], totalLines: 0 };
  }

  const stat = statSync(logPath);
  if (!stat.isFile() || stat.size === 0) {
    return { lines: [], totalLines: 0 };
  }

  const fd = openSync(logPath, "r");
  const buffer = Buffer.allocUnsafe(DESKTOP_LOGS_READ_CHUNK_BYTES);
  const lines: string[] = [];
  let totalLines = 0;
  let pending = "";

  const appendLine = (line: string) => {
    totalLines += 1;
    lines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
    if (lines.length > limit) {
      lines.shift();
    }
  };

  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }

      const chunk = pending + buffer.subarray(0, bytesRead).toString("utf8");
      const chunkLines = chunk.split("\n");
      pending = chunkLines.pop() ?? "";
      for (const line of chunkLines) {
        appendLine(line);
      }
    } while (bytesRead > 0);
  } finally {
    closeSync(fd);
  }

  if (pending.length > 0) {
    appendLine(pending);
  }

  return { lines, totalLines };
}

function resolveConversation(
  queryStore: QueryStore,
  conversationId: string,
): Conversation | null {
  const matches = findConversationMatches(queryStore.database, conversationId, 10);
  return (
    matches.find((candidate) => candidate.id === conversationId) ??
    (matches.length === 1 ? matches[0] : null)
  );
}
