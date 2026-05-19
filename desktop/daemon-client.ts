import { request as createRequest, type IncomingHttpHeaders } from "node:http";
import {
  DESKTOP_AUTH_HEADER,
  getDesktopApiToken,
} from "../src/api/auth";
import { getRuntimePaths } from "../src/daemon/runtime-state";
import type {
  DesktopCompatibilityInfo,
  DesktopConversationDetailView,
  DesktopConversationListRequest,
  DesktopConversationListView,
  DesktopHomeData,
  DesktopHomeRequest,
  DesktopLogsRequest,
  DesktopLogsView,
  DesktopRoutingView,
  DesktopTraceView,
  DesktopTreeView,
} from "../src/contracts/desktop";
import { DESKTOP_HOME_TOKEN_USAGE_DEFAULT_DAYS } from "../src/contracts/desktop";

export interface DesktopDaemonClient {
  getCompatibility(): Promise<DesktopCompatibilityInfo>;
  getHomeData(request?: DesktopHomeRequest): Promise<DesktopHomeData>;
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

export interface DesktopUnixRequestResult {
  statusCode: number;
  body: string;
  headers: IncomingHttpHeaders;
}

export interface DesktopUnixRequestOptions {
  method: "GET" | "POST";
  path: string;
  headers?: Record<string, string>;
}

export type DesktopUnixRequest = (
  request: DesktopUnixRequestOptions,
) => Promise<DesktopUnixRequestResult>;

export interface DesktopDaemonClientOptions {
  authToken?: string;
  socketPath?: string;
  request?: DesktopUnixRequest;
}

export function createDesktopDaemonClient(
  options: DesktopDaemonClientOptions = {},
): DesktopDaemonClient {
  const socketPath = options.socketPath ?? getRuntimePaths().socketPath;
  const authToken = options.authToken ?? getDesktopApiToken();
  const request =
    options.request ??
    ((requestOptions) => requestOverLocalTransport(socketPath, requestOptions));

  return {
    async getCompatibility() {
      return requestJson<DesktopCompatibilityInfo>(
        request,
        "/api/desktop/compatibility",
        authToken,
      );
    },
    async getHomeData(filters = {}) {
      const tokenUsageDays =
        filters.tokenUsageDays ?? DESKTOP_HOME_TOKEN_USAGE_DEFAULT_DAYS;
      const search = new URLSearchParams();
      if (Number.isFinite(tokenUsageDays) && tokenUsageDays > 0) {
        search.set("tokenUsageDays", String(Math.floor(tokenUsageDays)));
      }
      const pathname = `/api/desktop/home${
        search.size > 0 ? `?${search.toString()}` : ""
      }`;
      return requestJson<DesktopHomeData>(
        request,
        pathname,
        authToken,
      );
    },
    async getLogs(filters = {}) {
      const search = new URLSearchParams();
      if (typeof filters.limit === "number") {
        search.set("limit", String(filters.limit));
      }

      const pathname = `/api/desktop/logs${search.size > 0 ? `?${search.toString()}` : ""}`;
      return requestJson<DesktopLogsView>(
        request,
        pathname,
        authToken,
      );
    },
    async getRouting() {
      return requestJson<DesktopRoutingView>(
        request,
        "/api/desktop/routing",
        authToken,
      );
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
      return requestJson<DesktopConversationListView>(
        request,
        pathname,
        authToken,
      );
    },
    async getConversationDetail(conversationId) {
      return requestJson<DesktopConversationDetailView>(
        request,
        `/api/desktop/conversations/${encodeURIComponent(conversationId)}`,
        authToken,
      );
    },
    async getTraceView(conversationId) {
      return requestJson<DesktopTraceView>(
        request,
        `/api/desktop/conversations/${encodeURIComponent(conversationId)}/trace`,
        authToken,
      );
    },
    async getTreeView(conversationId) {
      return requestJson<DesktopTreeView>(
        request,
        `/api/desktop/conversations/${encodeURIComponent(conversationId)}/tree`,
        authToken,
      );
    },
  };
}

async function requestOverLocalTransport(
  endpoint: string,
  options: DesktopUnixRequestOptions,
): Promise<DesktopUnixRequestResult> {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return requestOverHttpEndpoint(endpoint, options);
  }

  return requestOverUnixSocket(endpoint, options);
}

async function requestOverHttpEndpoint(
  endpoint: string,
  options: DesktopUnixRequestOptions,
): Promise<DesktopUnixRequestResult> {
  const url = new URL(options.path, endpoint);
  return new Promise((resolve, reject) => {
    const request = createRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers: { Accept: "application/json", ...options.headers },
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
        headers: { Accept: "application/json", ...options.headers },
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
  authToken: string,
): Promise<T> {
  const response = await request({
    method: "GET",
    path,
    headers: { [DESKTOP_AUTH_HEADER]: authToken },
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
