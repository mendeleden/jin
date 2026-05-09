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
  DesktopTraceView,
  DesktopTreeView,
} from "../src/contracts/desktop";
import {
  DESKTOP_API_VERSION,
  evaluateDesktopCompatibility,
} from "../src/contracts/desktop";
import type { RuntimeState } from "../src/contracts/lifecycle";
import {
  createDesktopDaemonClient,
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
      if (!compatibility.compatible) {
        return {
          status,
          compatibility,
          data: null,
          transportError: compatibility.message,
        };
      }

      try {
        return {
          status,
          compatibility,
          data: await daemonClient.getHomeData(),
          transportError: null,
        };
      } catch (error) {
        return {
          status,
          compatibility,
          data: null,
          transportError: formatError(error),
        };
      }
    },
    async runControlAction(action) {
      return controlBoundary.runAction(action);
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
      return service.runControlAction(action as LocalControlAction);
    },
  );
  replaceHandler(
    ipcMain,
    DESKTOP_IPC_CHANNELS.conversationList,
    (_event, request) => {
      return service.listConversations(request as DesktopConversationListRequest);
    },
  );
  replaceHandler(
    ipcMain,
    DESKTOP_IPC_CHANNELS.conversationDetail,
    (_event, conversationId) => {
      return service.getConversationDetail(String(conversationId));
    },
  );
  replaceHandler(
    ipcMain,
    DESKTOP_IPC_CHANNELS.traceView,
    (_event, conversationId) => {
      return service.getTraceView(String(conversationId));
    },
  );
  replaceHandler(
    ipcMain,
    DESKTOP_IPC_CHANNELS.treeView,
    (_event, conversationId) => {
      return service.getTreeView(String(conversationId));
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

async function readCompatibilityStatus(
  daemonClient: DesktopDaemonClient,
): Promise<DesktopCompatibilityStatus> {
  try {
    return evaluateDesktopCompatibility(await daemonClient.getCompatibility());
  } catch {
    return {
      jinVersion: "unknown",
      desktopApiVersion: 0,
      minimumDesktopApiVersion: 1,
      updateCommand: "jin desktop --update",
      cliUpdateCommand: "jin update",
      clientDesktopApiVersion: DESKTOP_API_VERSION,
      compatible: false,
      reason: "daemon_too_old",
      message:
        "Jin Desktop could not verify compatibility with the running daemon. Run `jin update`, restart Jin, then reopen Desktop.",
    };
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
