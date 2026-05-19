import type {
  DesktopConversationDetailView,
  DesktopConversationListRequest,
  DesktopConversationListView,
  DesktopControlAction,
  DesktopControlActionResult,
  DesktopHomeSnapshot,
  DesktopLogsRequest,
  DesktopLogsView,
  DesktopRoutingView,
  DesktopTraceView,
  DesktopTreeView,
} from "../src/contracts/desktop";

export const DESKTOP_IPC_CHANNELS = {
  homeSnapshot: "jin-desktop:home-snapshot",
  controlAction: "jin-desktop:control-action",
  logs: "jin-desktop:logs",
  routing: "jin-desktop:routing",
  conversationList: "jin-desktop:conversation-list",
  conversationDetail: "jin-desktop:conversation-detail",
  traceView: "jin-desktop:trace-view",
  treeView: "jin-desktop:tree-view",
} as const;

export interface DesktopIpcInvoker {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export interface JinDesktopBridge {
  getHomeSnapshot(): Promise<DesktopHomeSnapshot>;
  runControlAction(
    action: DesktopControlAction,
  ): Promise<DesktopControlActionResult>;
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

export function createDesktopBridge(ipc: DesktopIpcInvoker): JinDesktopBridge {
  return {
    async getHomeSnapshot() {
      return ipc.invoke(
        DESKTOP_IPC_CHANNELS.homeSnapshot,
      ) as Promise<DesktopHomeSnapshot>;
    },
    async runControlAction(action) {
      return ipc.invoke(
        DESKTOP_IPC_CHANNELS.controlAction,
        action,
      ) as Promise<DesktopControlActionResult>;
    },
    async getLogs(request) {
      return ipc.invoke(
        DESKTOP_IPC_CHANNELS.logs,
        request,
      ) as Promise<DesktopLogsView>;
    },
    async getRouting() {
      return ipc.invoke(
        DESKTOP_IPC_CHANNELS.routing,
      ) as Promise<DesktopRoutingView>;
    },
    async listConversations(request) {
      return ipc.invoke(
        DESKTOP_IPC_CHANNELS.conversationList,
        request,
      ) as Promise<DesktopConversationListView>;
    },
    async getConversationDetail(conversationId) {
      return ipc.invoke(
        DESKTOP_IPC_CHANNELS.conversationDetail,
        conversationId,
      ) as Promise<DesktopConversationDetailView>;
    },
    async getTraceView(conversationId) {
      return ipc.invoke(
        DESKTOP_IPC_CHANNELS.traceView,
        conversationId,
      ) as Promise<DesktopTraceView>;
    },
    async getTreeView(conversationId) {
      return ipc.invoke(
        DESKTOP_IPC_CHANNELS.treeView,
        conversationId,
      ) as Promise<DesktopTreeView>;
    },
  };
}
