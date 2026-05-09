import type {
  Conversation,
  ConversationRelationship,
  Message,
  ToolCall,
} from "./conversations";
import type {
  RuntimeIssue,
  RuntimeOwnershipRecord,
  RuntimeState,
} from "./lifecycle";

export const DESKTOP_API_VERSION = 1;
export const DESKTOP_MINIMUM_API_VERSION = 1;
export const DESKTOP_UPDATE_COMMAND = "jin desktop --update";
export const CLI_UPDATE_COMMAND = "jin update";

export type DesktopControlAction = "start" | "stop" | "restart";
export type DesktopCompatibilityReason =
  | "compatible"
  | "desktop_too_old"
  | "daemon_too_old";
export type DesktopSubsystemHealth =
  | "inactive"
  | "healthy"
  | "degraded"
  | "paused";
export type DesktopHealthStatus =
  | "stopped"
  | "starting"
  | "healthy"
  | "degraded"
  | "stopping";

export interface DesktopControlComponent {
  name: "watcher";
  status: "running" | "stopped";
  pid?: number;
  mode?: RuntimeOwnershipRecord["mode"];
  uptime?: string;
  lifecycleState?: RuntimeState;
  issues?: RuntimeIssue[];
}

export interface DesktopControlStatus {
  runtime: {
    state: RuntimeState;
    owner: RuntimeOwnershipRecord | null;
    issues: RuntimeIssue[];
  };
  health: {
    status: DesktopHealthStatus;
    issueCount: number;
    issueSubsystems: string[];
    paused: boolean;
    ingest: DesktopSubsystemHealth;
    push: DesktopSubsystemHealth;
    components: {
      running: number;
      stopped: number;
    };
  };
  components: DesktopControlComponent[];
  paths: {
    configDir: string;
    config: string;
    store: string;
    log: string;
    socket: string;
  };
}

export interface DesktopControlActionResult {
  action: DesktopControlAction;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  status: DesktopControlStatus;
}

export interface DesktopCompatibilityInfo {
  jinVersion: string;
  desktopApiVersion: number;
  minimumDesktopApiVersion: number;
  updateCommand: string;
  cliUpdateCommand: string;
}

export interface DesktopCompatibilityStatus extends DesktopCompatibilityInfo {
  clientDesktopApiVersion: number;
  compatible: boolean;
  reason: DesktopCompatibilityReason;
  message: string;
}

export interface DesktopOverviewSummary {
  conversations: number;
  messages: number;
  toolCalls: number;
  traces: number;
  tokens: number;
  displayTokens: number;
  cacheTokens: number;
  cost: number;
  projects: number;
}

export interface DesktopAdapterSummary {
  adapterId: string;
  conversations: number;
  messages: number;
  tokens: number;
  displayTokens: number;
  cacheTokens: number;
  cost: number;
}

export interface DesktopModelSummary {
  model: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
}

export interface DesktopToolSummary {
  name: string;
  calls: number;
  conversationCount: number;
}

export interface DesktopProjectSummary {
  id: string;
  name: string;
  gitRemote: string;
  conversationCount: number;
  totalTokens: number;
  totalCost: number;
  lastSeen: string;
  adapters: string[];
}

export interface DesktopRelationshipSummary {
  relationship: ConversationRelationship;
  conversations: number;
}

export interface DesktopTokenUsageDay {
  day: string;
  adapterId: string;
  sessions: number;
  tokens: number;
  cost: number;
}

export interface DesktopConversationListRequest {
  adapterId?: string;
  since?: string;
  limit?: number;
}

export interface DesktopConversationListFilters {
  adapterId: string | null;
  since: string | null;
  limit: number;
}

export interface DesktopConversationListView {
  generatedAt: string;
  filters: DesktopConversationListFilters;
  availableAdapters: string[];
  relationshipMix: DesktopRelationshipSummary[];
  conversations: Conversation[];
}

export interface DesktopHomeData {
  generatedAt: string;
  overview: DesktopOverviewSummary;
  recentConversations: Conversation[];
  topAdapters: DesktopAdapterSummary[];
  topModels: DesktopModelSummary[];
  topTools: DesktopToolSummary[];
  topProjects: DesktopProjectSummary[];
  relationshipMix: DesktopRelationshipSummary[];
  tokenUsageByDay: DesktopTokenUsageDay[];
}

export interface DesktopHomeSnapshot {
  status: DesktopControlStatus;
  compatibility: DesktopCompatibilityStatus | null;
  data: DesktopHomeData | null;
  transportError: string | null;
}

export interface DesktopConversationDetailView {
  conversation: Conversation;
  messages: Message[];
  toolCalls: ToolCall[];
  parent: Conversation | null;
  children: Conversation[];
  trace: {
    traceId: string;
    rootId: string;
    conversationCount: number;
  };
}

export interface DesktopTraceConversation {
  conversation: Conversation;
  messages: Message[];
  toolCalls: ToolCall[];
}

export interface DesktopConversationTreeNode {
  conversation: Conversation;
  children: DesktopConversationTreeNode[];
}

export interface DesktopTraceView {
  traceId: string;
  rootId: string;
  selectedConversationId: string;
  conversations: DesktopTraceConversation[];
  tree: DesktopConversationTreeNode | null;
}

export interface DesktopTreeView {
  traceId: string;
  selectedConversationId: string;
  tree: DesktopConversationTreeNode | null;
}

export function evaluateDesktopCompatibility(
  info: DesktopCompatibilityInfo,
  clientDesktopApiVersion = DESKTOP_API_VERSION,
): DesktopCompatibilityStatus {
  if (clientDesktopApiVersion < info.minimumDesktopApiVersion) {
    return {
      ...info,
      clientDesktopApiVersion,
      compatible: false,
      reason: "desktop_too_old",
      message: `This Jin Desktop build is no longer compatible with jin ${info.jinVersion}. Update Desktop with \`${info.updateCommand}\`, then reopen it.`,
    };
  }

  if (clientDesktopApiVersion > info.desktopApiVersion) {
    return {
      ...info,
      clientDesktopApiVersion,
      compatible: false,
      reason: "daemon_too_old",
      message: `This Jin Desktop build needs a newer jin CLI/daemon. Run \`${info.cliUpdateCommand}\`, restart Jin, then reopen Desktop.`,
    };
  }

  return {
    ...info,
    clientDesktopApiVersion,
    compatible: true,
    reason: "compatible",
    message: "Jin Desktop and the local daemon are compatible.",
  };
}
