import type { Database } from "bun:sqlite";
import type { Conversation } from "../contracts/conversations";

interface ConversationRow {
  id: string;
  trace_id: string;
  parent_id: string;
  relationship: Conversation["relationship"];
  fork_point: number;
  adapter_id: string;
  name: string;
  cwd: string;
  git_remote: string;
  branch: string;
  model: string;
  started_at: string;
  ended_at: string;
  source_path: string;
  source_format: Conversation["sourceFormat"];
  duration_ms: number;
  message_count: number;
  tool_count: number;
  turn_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  est_cost: number;
}

export interface ListConversationsOptions {
  adapterId?: string;
  since?: string;
  limit?: number;
  remote?: string;
  search?: string;
}

export interface ConversationTreeNode {
  conversation: Conversation;
  children: ConversationTreeNode[];
}

export interface OverviewSummary {
  conversations: number;
  messages: number;
  toolCalls: number;
  traces: number;
  tokens: number;
  displayTokens: number;
  cacheTokens: number;
  cost: number;
  remotes: number;
}

export interface AdapterAnalysisSummary {
  conversations: number;
  messages: number;
  tokens: number;
  displayTokens: number;
  cacheTokens: number;
  cost: number;
}

export function parseSinceInput(input: string): string {
  const match = input.match(/^(\d+)(h|d|m|w)$/);
  if (!match) {
    return input;
  }

  const [, count, unit] = match;
  const milliseconds = {
    h: 3_600_000,
    d: 86_400_000,
    m: 60_000,
    w: 604_800_000,
  }[unit]!;

  return new Date(Date.now() - Number.parseInt(count, 10) * milliseconds)
    .toISOString();
}

export function listConversations(
  db: Database,
  options: ListConversationsOptions = {},
): Conversation[] {
  let query = `
    SELECT *
    FROM conversations
    WHERE 1 = 1
  `;
  const params: Array<string | number> = [];

  if (options.adapterId) {
    query += " AND adapter_id = ?";
    params.push(options.adapterId);
  }

  if (options.since) {
    query += " AND COALESCE(NULLIF(ended_at, ''), started_at) >= ?";
    params.push(options.since);
  }

  if (options.remote) {
    query += " AND git_remote = ?";
    params.push(options.remote);
  }

  if (options.search) {
    query += " AND LOWER(name) LIKE ?";
    params.push(`%${options.search.toLowerCase()}%`);
  }

  query += `
    ORDER BY
      COALESCE(NULLIF(ended_at, ''), started_at) DESC,
      started_at DESC,
      id ASC
  `;

  if (options.limit && options.limit > 0) {
    query += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(query).all(...params) as ConversationRow[];
  return rows.map(rowToConversation);
}

export function findConversationMatches(
  db: Database,
  idOrPrefix: string,
  limit = 10,
): Conversation[] {
  const trimmed = idOrPrefix.trim();
  if (!trimmed) {
    return [];
  }

  const rows = db.prepare(
    `SELECT *
     FROM conversations
     WHERE id = ?
        OR id LIKE ?
     ORDER BY
       CASE WHEN id = ? THEN 0 ELSE 1 END,
       COALESCE(NULLIF(ended_at, ''), started_at) DESC,
       id ASC
     LIMIT ?`,
  ).all(trimmed, `${trimmed}%`, trimmed, limit) as ConversationRow[];

  return rows.map(rowToConversation);
}

export function getTraceConversations(
  db: Database,
  traceId: string,
): Conversation[] {
  const rows = db.prepare(
    `SELECT *
     FROM conversations
     WHERE trace_id = ?
     ORDER BY started_at ASC, ended_at ASC, id ASC`,
  ).all(traceId) as ConversationRow[];

  return rows.map(rowToConversation);
}

export function buildConversationTree(
  conversations: Conversation[],
): ConversationTreeNode | null {
  if (conversations.length === 0) {
    return null;
  }

  const childrenByParent = new Map<string, Conversation[]>();
  for (const conversation of conversations) {
    if (!conversation.parentId) {
      continue;
    }

    const siblings = childrenByParent.get(conversation.parentId) ?? [];
    siblings.push(conversation);
    childrenByParent.set(conversation.parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareConversations);
  }

  const root = pickRootConversation(conversations);
  if (!root) {
    return null;
  }

  return buildConversationTreeNode(root, childrenByParent, new Set<string>());
}

export function getOverviewSummary(db: Database): OverviewSummary {
  const row = db.prepare(
    `SELECT
       COUNT(*) AS conversations,
       COALESCE(SUM(message_count), 0) AS messages,
       COALESCE(SUM(tool_count), 0) AS tool_calls,
       COUNT(DISTINCT trace_id) AS traces,
       COALESCE(SUM(input_tokens + output_tokens + cache_read + cache_write), 0) AS tokens,
       COALESCE(SUM(input_tokens + output_tokens), 0) AS display_tokens,
       COALESCE(SUM(cache_read + cache_write), 0) AS cache_tokens,
       COALESCE(SUM(est_cost), 0) AS cost,
       COUNT(DISTINCT CASE WHEN git_remote != '' THEN git_remote END) AS remotes
     FROM conversations`,
  ).get() as {
    conversations: number;
    messages: number;
    tool_calls: number;
    traces: number;
    tokens: number;
    display_tokens: number;
    cache_tokens: number;
    cost: number;
    remotes: number;
  };

  return {
    conversations: row.conversations ?? 0,
    messages: row.messages ?? 0,
    toolCalls: row.tool_calls ?? 0,
    traces: row.traces ?? 0,
    tokens: row.tokens ?? 0,
    displayTokens: row.display_tokens ?? 0,
    cacheTokens: row.cache_tokens ?? 0,
    cost: row.cost ?? 0,
    remotes: row.remotes ?? 0,
  };
}

export function analyzeByAdapter(
  db: Database,
): Record<string, AdapterAnalysisSummary> {
  const rows = db.prepare(
    `SELECT
       adapter_id,
       COUNT(*) AS conversations,
       COALESCE(SUM(message_count), 0) AS messages,
       COALESCE(SUM(input_tokens + output_tokens + cache_read + cache_write), 0) AS tokens,
       COALESCE(SUM(input_tokens + output_tokens), 0) AS display_tokens,
       COALESCE(SUM(cache_read + cache_write), 0) AS cache_tokens,
       COALESCE(SUM(est_cost), 0) AS cost
     FROM conversations
     GROUP BY adapter_id
     ORDER BY conversations DESC, adapter_id ASC`,
  ).all() as Array<{
    adapter_id: string;
    conversations: number;
    messages: number;
    tokens: number;
    display_tokens: number;
    cache_tokens: number;
    cost: number;
  }>;

  return Object.fromEntries(
    rows.map((row) => [
      row.adapter_id,
      {
        conversations: row.conversations ?? 0,
        messages: row.messages ?? 0,
        tokens: row.tokens ?? 0,
        displayTokens: row.display_tokens ?? 0,
        cacheTokens: row.cache_tokens ?? 0,
        cost: row.cost ?? 0,
      },
    ]),
  );
}

export function analyzeByModel(
  db: Database,
): Record<string, { messages: number; inputTokens: number; outputTokens: number }> {
  const rows = db.prepare(
    `SELECT
       model,
       COUNT(*) AS messages,
       COALESCE(SUM(input_tokens), 0) AS input_tokens,
       COALESCE(SUM(output_tokens), 0) AS output_tokens
     FROM messages
     WHERE model != ''
     GROUP BY model
     ORDER BY messages DESC, model ASC`,
  ).all() as Array<{
    model: string;
    messages: number;
    input_tokens: number;
    output_tokens: number;
  }>;

  return Object.fromEntries(
    rows.map((row) => [
      row.model || "unknown",
      {
        messages: row.messages ?? 0,
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
      },
    ]),
  );
}

export function analyzeToolUsage(
  db: Database,
): Array<{ tool_name: string; total_calls: number; conversation_count: number }> {
  return db.prepare(
    `SELECT
       name AS tool_name,
       COUNT(*) AS total_calls,
       COUNT(DISTINCT conversation_id) AS conversation_count
     FROM tool_calls
     GROUP BY name
     ORDER BY total_calls DESC, tool_name ASC`,
  ).all() as Array<{
    tool_name: string;
    total_calls: number;
    conversation_count: number;
  }>;
}

export function timelineByDay(
  db: Database,
  days = 30,
): Array<{ day: string; adapter_id: string; sessions: number; tokens: number; cost: number }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return db.prepare(
    `SELECT
       substr(COALESCE(NULLIF(ended_at, ''), started_at), 1, 10) AS day,
       adapter_id,
       COUNT(*) AS sessions,
       COALESCE(SUM(input_tokens + output_tokens + cache_read + cache_write), 0) AS tokens,
       COALESCE(SUM(est_cost), 0) AS cost
     FROM conversations
     WHERE COALESCE(NULLIF(ended_at, ''), started_at) >= ?
     GROUP BY day, adapter_id
     ORDER BY day ASC, adapter_id ASC`,
  ).all(since) as Array<{
    day: string;
    adapter_id: string;
    sessions: number;
    tokens: number;
    cost: number;
  }>;
}

export function listProjectsByRemote(
  db: Database,
): Array<{
  id: string;
  name: string;
  gitRemote: string;
  conversationCount: number;
  totalTokens: number;
  totalCost: number;
  lastSeen: string;
  tools: string;
}> {
  const rows = db.prepare(
    `SELECT
       git_remote,
       COUNT(*) AS conversation_count,
       COALESCE(SUM(input_tokens + output_tokens + cache_read + cache_write), 0) AS total_tokens,
       COALESCE(SUM(est_cost), 0) AS total_cost,
       MAX(COALESCE(NULLIF(ended_at, ''), started_at)) AS last_seen,
       GROUP_CONCAT(DISTINCT adapter_id) AS tools
     FROM conversations
     WHERE git_remote != ''
     GROUP BY git_remote
     ORDER BY last_seen DESC, git_remote ASC`,
  ).all() as Array<{
    git_remote: string;
    conversation_count: number;
    total_tokens: number;
    total_cost: number;
    last_seen: string;
    tools: string;
  }>;

  return rows.map((row) => ({
    id: encodeURIComponent(row.git_remote),
    name: row.git_remote,
    gitRemote: row.git_remote,
    conversationCount: row.conversation_count ?? 0,
    totalTokens: row.total_tokens ?? 0,
    totalCost: row.total_cost ?? 0,
    lastSeen: row.last_seen ?? "",
    tools: row.tools ?? "",
  }));
}

function buildConversationTreeNode(
  conversation: Conversation,
  childrenByParent: Map<string, Conversation[]>,
  visited: Set<string>,
): ConversationTreeNode {
  if (visited.has(conversation.id)) {
    return { conversation, children: [] };
  }

  visited.add(conversation.id);
  const children = (childrenByParent.get(conversation.id) ?? []).map((child) =>
    buildConversationTreeNode(child, childrenByParent, visited),
  );

  return { conversation, children };
}

function pickRootConversation(
  conversations: Conversation[],
): Conversation | null {
  if (conversations.length === 0) {
    return null;
  }

  return (
    conversations.find((conversation) => conversation.relationship === "root") ??
    conversations.find((conversation) => conversation.parentId === "") ??
    conversations.find((conversation) => conversation.id === conversation.traceId) ??
    conversations.find((conversation) =>
      !conversations.some((candidate) => candidate.id === conversation.parentId),
    ) ??
    [...conversations].sort(compareConversations)[0]
  );
}

function compareConversations(a: Conversation, b: Conversation): number {
  const startedAtDelta = compareDateStrings(a.startedAt, b.startedAt);
  if (startedAtDelta !== 0) {
    return startedAtDelta;
  }

  const endedAtDelta = compareDateStrings(a.endedAt, b.endedAt);
  if (endedAtDelta !== 0) {
    return endedAtDelta;
  }

  return a.id.localeCompare(b.id);
}

function compareDateStrings(left: string, right: string): number {
  const leftMillis = Date.parse(left || "");
  const rightMillis = Date.parse(right || "");

  const leftValid = Number.isFinite(leftMillis);
  const rightValid = Number.isFinite(rightMillis);

  if (leftValid && rightValid) {
    return leftMillis - rightMillis;
  }

  if (leftValid) {
    return -1;
  }

  if (rightValid) {
    return 1;
  }

  return (left || "").localeCompare(right || "");
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    traceId: row.trace_id,
    parentId: row.parent_id,
    relationship: row.relationship,
    forkPoint: row.fork_point,
    adapterId: row.adapter_id,
    name: row.name,
    cwd: row.cwd,
    gitRemote: row.git_remote,
    branch: row.branch,
    model: row.model,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    sourcePath: row.source_path,
    sourceFormat: row.source_format,
    durationMs: row.duration_ms,
    messageCount: row.message_count,
    toolCount: row.tool_count,
    turnCount: row.turn_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheRead: row.cache_read,
    cacheWrite: row.cache_write,
    estCost: row.est_cost,
  };
}
