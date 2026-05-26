import {
  createLocalControlBoundary,
  type LocalControlAction,
  type LocalControlBoundary,
} from "../src/api/control";
import type {
  DesktopConversationDetailView,
  DesktopConversationListRequest,
  DesktopConversationListView,
  DesktopControlActionResult,
  DesktopCompatibilityStatus,
  DesktopHomeSnapshot,
  DesktopLogsRequest,
  DesktopLogsView,
  DesktopRoutingView,
  DesktopTraceView,
  DesktopTreeView,
} from "../src/contracts/desktop";
import { evaluateDesktopCompatibility } from "../src/contracts/desktop";
import type { RuntimeState } from "../src/contracts/lifecycle";
import { CONVERSATION_RELATIONSHIPS } from "../src/contracts/conversations";
import {
  createDesktopDaemonClient,
  DesktopDaemonRequestError,
  type DesktopDaemonClient,
} from "./daemon-client";
import { DESKTOP_IPC_CHANNELS } from "./bridge";

export interface DesktopIpcMain {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler?(channel: string): void;
}

export interface DesktopShellService {
  getHomeSnapshot(): Promise<DesktopHomeSnapshot>;
  runControlAction(action: LocalControlAction): Promise<DesktopControlActionResult>;
  getLogs(request?: DesktopLogsRequest): Promise<DesktopLogsView>;
  getRouting(): Promise<DesktopRoutingView>;
  listConversations(
    request?: DesktopConversationListRequest,
  ): Promise<DesktopConversationListView>;
  getConversationDetail(
    conversationId: string,
  ): Promise<DesktopConversationDetailView>;
  getTraceView(conversationId: string): Promise<DesktopTraceView>;
  getTreeView(conversationId: string): Promise<DesktopTreeView>;
}

export interface DesktopShellServiceOptions {
  controlBoundary?: LocalControlBoundary;
  daemonClient?: DesktopDaemonClient;
}

export function createDesktopShellService(
  options: DesktopShellServiceOptions = {},
): DesktopShellService {
  const controlBoundary =
    options.controlBoundary ?? createLocalControlBoundary();
  const daemonClient = options.daemonClient ?? createDesktopDaemonClient();

  return {
    async getHomeSnapshot() {
      const status = controlBoundary.getStatus();

      if (!shouldReadHomeData(status.runtime.state)) {
        return {
          status,
          compatibility: null,
          data: null,
          transportError: null,
        };
      }

      const compatibility = await readCompatibilityStatus(daemonClient);
      if (compatibility.kind === "unavailable") {
        return {
          status,
          compatibility: null,
          data: null,
          transportError: compatibility.message,
        };
      }

      if (!compatibility.status.compatible) {
        return {
          status,
          compatibility: compatibility.status,
          data: null,
          transportError: compatibility.status.message,
        };
      }

      try {
        return {
          status,
          compatibility: compatibility.status,
          data: await daemonClient.getHomeData(),
          transportError: null,
        };
      } catch (error) {
        return {
          status,
          compatibility: compatibility.status,
          data: null,
          transportError: formatError(error),
        };
      }
    },
    async runControlAction(action) {
      return controlBoundary.runAction(action);
    },
    async getLogs(request) {
      return daemonClient.getLogs(request);
    },
    async getRouting() {
      return daemonClient.getRouting();
    },
    async listConversations(request) {
      return daemonClient.listConversations(request);
    },
    async getConversationDetail(conversationId) {
      return daemonClient.getConversationDetail(conversationId);
    },
    async getTraceView(conversationId) {
      return daemonClient.getTraceView(conversationId);
    },
    async getTreeView(conversationId) {
      return daemonClient.getTreeView(conversationId);
    },
  };
}

export function registerDesktopIpcHandlers(
  ipcMain: DesktopIpcMain,
  service: DesktopShellService,
): void {
  replaceHandler(ipcMain, DESKTOP_IPC_CHANNELS.homeSnapshot, () => {
    return service.getHomeSnapshot();
  });
  replaceHandler(
    ipcMain,
    DESKTOP_IPC_CHANNELS.controlAction,
    (_event, action) => {
      return service.runControlAction(parseControlAction(action));
    },
  );
  replaceHandler(
    ipcMain,
    DESKTOP_IPC_CHANNELS.logs,
    (_event, request) => {
      return service.getLogs(parseLogsRequest(request));
    },
  );
  replaceHandler(ipcMain, DESKTOP_IPC_CHANNELS.routing, () => {
    return service.getRouting();
  });
  replaceHandler(
    ipcMain,
    DESKTOP_IPC_CHANNELS.conversationList,
    (_event, request) => {
      return service.listConversations(parseConversationListRequest(request));
    },
  );
  replaceHandler(
    ipcMain,
    DESKTOP_IPC_CHANNELS.conversationDetail,
    (_event, conversationId) => {
      return service.getConversationDetail(parseConversationId(conversationId));
    },
  );
  replaceHandler(
    ipcMain,
    DESKTOP_IPC_CHANNELS.traceView,
    (_event, conversationId) => {
      return service.getTraceView(parseConversationId(conversationId));
    },
  );
  replaceHandler(
    ipcMain,
    DESKTOP_IPC_CHANNELS.treeView,
    (_event, conversationId) => {
      return service.getTreeView(parseConversationId(conversationId));
    },
  );
}

function replaceHandler(
  ipcMain: DesktopIpcMain,
  channel: string,
  listener: (event: unknown, ...args: unknown[]) => unknown,
): void {
  ipcMain.removeHandler?.(channel);
  ipcMain.handle(channel, listener);
}

function shouldReadHomeData(state: RuntimeState): boolean {
  return state === "running" || state === "degraded";
}

function parseControlAction(value: unknown): LocalControlAction {
  if (value === "start" || value === "stop" || value === "restart") {
    return value;
  }

  throw new Error("Invalid Desktop control action.");
}

function parseLogsRequest(value: unknown): DesktopLogsRequest | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isPlainRecord(value)) {
    throw new Error("Invalid Desktop logs request.");
  }

  const request: DesktopLogsRequest = {};
  const limit = value.limit;
  if (limit !== undefined) {
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
      throw new Error("Invalid Desktop logs limit.");
    }
    request.limit = limit;
  }

  return request;
}

function parseConversationListRequest(
  value: unknown,
): DesktopConversationListRequest | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isPlainRecord(value)) {
    throw new Error("Invalid Desktop conversation list request.");
  }

  const request: DesktopConversationListRequest = {};
  if (value.adapterId !== undefined) {
    request.adapterId = parseOptionalString(value.adapterId, "adapterId");
  }
  if (value.since !== undefined) {
    request.since = parseOptionalString(value.since, "since");
  }
  if (value.repository !== undefined) {
    request.repository = parseOptionalString(value.repository, "repository");
  }
  if (value.search !== undefined) {
    request.search = parseOptionalString(value.search, "search");
  }
  if (value.relationship !== undefined) {
    request.relationship = parseConversationRelationship(value.relationship);
  }
  const limit = value.limit;
  if (limit !== undefined) {
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
      throw new Error("Invalid Desktop conversation list limit.");
    }
    request.limit = limit;
  }
  const offset = value.offset;
  if (offset !== undefined) {
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
      throw new Error("Invalid Desktop conversation list offset.");
    }
    request.offset = offset;
  }

  return request;
}

function parseOptionalString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid Desktop conversation list ${field}.`);
  }

  return value;
}

function parseConversationRelationship(
  value: unknown,
): DesktopConversationListRequest["relationship"] {
  if (
    typeof value !== "string" ||
    !CONVERSATION_RELATIONSHIPS.includes(
      value as (typeof CONVERSATION_RELATIONSHIPS)[number],
    )
  ) {
    throw new Error("Invalid Desktop conversation list relationship.");
  }

  return value as DesktopConversationListRequest["relationship"];
}

function parseConversationId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Invalid Desktop conversation id.");
  }

  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type CompatibilityReadResult =
  | {
      kind: "available";
      status: DesktopCompatibilityStatus;
    }
  | {
      kind: "unavailable";
      message: string;
    };

async function readCompatibilityStatus(
  daemonClient: DesktopDaemonClient,
): Promise<CompatibilityReadResult> {
  try {
    return {
      kind: "available",
      status: evaluateDesktopCompatibility(await daemonClient.getCompatibility()),
    };
  } catch (error) {
    if (error instanceof DesktopDaemonRequestError) {
      return {
        kind: "unavailable",
        message: formatDaemonClientError(error),
      };
    }

    return {
      kind: "unavailable",
      message: `Jin Desktop could not verify daemon compatibility: ${formatError(error)}`,
    };
  }
}

function formatDaemonClientError(error: DesktopDaemonRequestError): string {
  if (error.kind === "socket_missing" || error.kind === "connection_refused") {
    return "Jin daemon is not reachable yet. It may be starting, stopping, or cleaning up; Desktop will retry automatically.";
  }

  if (error.kind === "http_status" && error.statusCode === 401) {
    return "Jin daemon rejected the Desktop API token. Restart Desktop after restarting Jin.";
  }

  if (error.kind === "invalid_json") {
    return "Jin daemon returned an invalid Desktop API response. Desktop will retry automatically.";
  }

  return error.message;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
