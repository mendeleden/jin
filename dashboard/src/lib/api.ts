const BASE_URL = import.meta.env.VITE_API_URL || "";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --- Overview ---
export interface Overview {
  sessions: number;
  messages: number;
  tokens: number;
  cost: number;
  artifacts: number;
  projects: number;
}

export const fetchOverview = () => request<Overview>("/api/overview");

// --- Sessions ---
export interface EnrichedSession {
  id: string;
  adapter_id: string;
  adapter_name: string;
  name: string;
  created_at: string;
  updated_at: string;
  duration_ms: number;
  is_active: number;
  total_tokens: number;
  est_cost: number;
  message_count: number;
  source_path: string;
  is_sub_agent: number;
  tag_names: string | null;
  project_names: string | null;
}

export const fetchSessions = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<EnrichedSession[]>(`/api/sessions${qs}`);
};

export interface SessionDetail {
  session: {
    id: string;
    name: string;
    adapterId: string;
    adapterName: string;
    createdAt: string;
    updatedAt: string;
    durationMs: number;
    isActive: boolean;
    totalTokens: number;
    estCost: number;
    messageCount: number;
    sourcePath: string;
    isSubAgent: boolean;
    parentSessionId: string;
    metadata: Record<string, unknown>;
  };
  messages: MessageItem[];
  tags: Array<{ name: string; category: string; color: string }>;
  parent: SessionSummary | null;
  children: SessionSummary[];
}

export interface SessionSummary {
  id: string;
  name: string;
  adapterId: string;
  adapterName: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  isActive: boolean;
  totalTokens: number;
  estCost: number;
  messageCount: number;
  isSubAgent: boolean;
  parentSessionId: string;
}

export interface MessageItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  toolUses: Array<{ id: string; name: string; input: string; output: string }>;
  thinkingBlocks: Array<{ content: string; tokenCount: number }>;
}

export const fetchSession = (id: string) =>
  request<SessionDetail>(`/api/sessions/${id}`);

// --- Analytics ---
export interface TimelineEntry {
  day: string;
  adapter_id: string;
  sessions: number;
  tokens: number;
  cost: number;
}

export const fetchTimeline = (days = 30) =>
  request<TimelineEntry[]>(`/api/analytics/timeline?days=${days}`);

export const fetchAdapterStats = () =>
  request<Record<string, { sessions: number; messages: number; tokens: number; cost: number }>>(
    "/api/analytics/adapters"
  );

export const fetchModelStats = () =>
  request<Record<string, { messages: number; inputTokens: number; outputTokens: number }>>(
    "/api/analytics/models"
  );

export interface ToolUsageEntry {
  tool_name: string;
  total_calls: number;
  session_count: number;
}

export const fetchToolUsage = () =>
  request<ToolUsageEntry[]>("/api/analytics/tools");

export const fetchProjectCosts = () =>
  request<Array<{ project_name: string; adapter_id: string; sessions: number; tokens: number; cost: number }>>(
    "/api/analytics/projects"
  );

// --- Projects ---
export interface Project {
  id: string;
  name: string;
  directory: string;
  git_remote: string;
  git_branch: string;
  language: string;
  first_seen: string;
  last_seen: string;
  session_count: number;
  total_tokens: number;
  total_cost: number;
  tools: string;
}

export const fetchProjects = () => request<Project[]>("/api/projects");

export const fetchProjectSessions = (id: string) =>
  request<EnrichedSession[]>(`/api/projects/${id}/sessions`);

// --- Tags ---
export interface Tag {
  id: number;
  name: string;
  category: string;
  color: string;
  count: number;
}

export const fetchTags = () => request<Tag[]>("/api/tags");

// --- Artifacts ---
export interface Artifact {
  id: string;
  adapterId: string;
  kind: string;
  name: string;
  path: string;
  scope: string;
  content: string;
  contentHash: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export const fetchArtifacts = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<Artifact[]>(`/api/artifacts${qs}`);
};

export const fetchArtifact = (id: string) =>
  request<Artifact>(`/api/artifacts/${id}`);
