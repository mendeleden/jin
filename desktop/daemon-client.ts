import { request as createRequest, type IncomingHttpHeaders } from "node:http";
import { getRuntimePaths } from "../src/daemon/runtime-state";
import type {
  DesktopCompatibilityInfo,
  DesktopConversationDetailView,
  DesktopConversationListRequest,
  DesktopConversationListView,
  DesktopHomeData,
  DesktopTraceView,
  DesktopTreeView,
} from "../src/contracts/desktop";

export interface DesktopDaemonClient {
  getCompatibility(): Promise<DesktopCompatibilityInfo>;
  getHomeData(): Promise<DesktopHomeData>;
  listConversations(
    request?: DesktopConversationListRequest,
  ): Promise<DesktopConversationListView>;
  getConversationDetail(
    conversationId: string,
  ): Promise<DesktopConversationDetailView>;
  getTraceView(conversationId: string): Promise<DesktopTraceView>;
  getTreeView(conversationId: string): Promise<DesktopTreeView>;
}

export interface DesktopUnixRequestResult {
  statusCode: number;
  body: string;
  headers: IncomingHttpHeaders;
}

export interface DesktopUnixRequestOptions {
  method: "GET" | "POST";
  path: string;
}

export type DesktopUnixRequest = (
  request: DesktopUnixRequestOptions,
) => Promise<DesktopUnixRequestResult>;

export interface DesktopDaemonClientOptions {
  socketPath?: string;
  request?: DesktopUnixRequest;
}

export function createDesktopDaemonClient(
  options: DesktopDaemonClientOptions = {},
): DesktopDaemonClient {
  const socketPath = options.socketPath ?? getRuntimePaths().socketPath;
  const request =
    options.request ??
    ((requestOptions) => requestOverUnixSocket(socketPath, requestOptions));

  return {
    async getCompatibility() {
      return requestJson<DesktopCompatibilityInfo>(
        request,
        "/api/desktop/compatibility",
      );
    },
    async getHomeData() {
      return requestJson<DesktopHomeData>(request, "/api/desktop/home");
    },
    async listConversations(filters = {}) {
      const search = new URLSearchParams();
      if (filters.adapterId) {
        search.set("adapter", filters.adapterId);
      }
      if (filters.since) {
        search.set("since", filters.since);
      }
      if (typeof filters.limit === "number") {
        search.set("limit", String(filters.limit));
      }

      const pathname = `/api/desktop/conversations${search.size > 0 ? `?${search.toString()}` : ""}`;
      return requestJson<DesktopConversationListView>(request, pathname);
    },
    async getConversationDetail(conversationId) {
      return requestJson<DesktopConversationDetailView>(
        request,
        `/api/desktop/conversations/${encodeURIComponent(conversationId)}`,
      );
    },
    async getTraceView(conversationId) {
      return requestJson<DesktopTraceView>(
        request,
        `/api/desktop/conversations/${encodeURIComponent(conversationId)}/trace`,
      );
    },
    async getTreeView(conversationId) {
      return requestJson<DesktopTreeView>(
        request,
        `/api/desktop/conversations/${encodeURIComponent(conversationId)}/tree`,
      );
    },
  };
}

async function requestOverUnixSocket(
  socketPath: string,
  options: DesktopUnixRequestOptions,
): Promise<DesktopUnixRequestResult> {
  return new Promise((resolve, reject) => {
    const request = createRequest(
      {
        socketPath,
        path: options.path,
        method: options.method,
        headers: { Accept: "application/json" },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body,
            headers: response.headers,
          });
        });
      },
    );

    request.on("error", reject);
    request.end();
  });
}

function parseJsonResponse<T>(response: DesktopUnixRequestResult): T {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Desktop daemon request failed (${response.statusCode}): ${extractErrorMessage(response.body)}`,
    );
  }

  return JSON.parse(response.body) as T;
}

async function requestJson<T>(
  request: DesktopUnixRequest,
  path: string,
): Promise<T> {
  const response = await request({
    method: "GET",
    path,
  });
  return parseJsonResponse<T>(response);
}

function extractErrorMessage(body: string): string {
  if (!body.trim()) {
    return "empty response body";
  }

  try {
    const parsed = JSON.parse(body);
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      return parsed.error;
    }
  } catch {}

  return body.trim();
}
