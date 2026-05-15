import { getRuntimePaths } from "../daemon/runtime-state";
import { DESKTOP_AUTH_HEADER, getDesktopApiToken } from "./auth";

export type ConfigReloadNotificationResult =
  | {
      status: "accepted";
      statusCode: number;
      message: string;
    }
  | {
      status: "rejected";
      statusCode: number;
      message: string;
    }
  | {
      status: "failed";
      message: string;
    };

export interface RequestConfigReloadOptions {
  endpoint?: string;
  fetch?: typeof fetch;
  token?: string;
  timeoutMs?: number;
}

interface BunUnixRequestInit extends RequestInit {
  unix?: string;
}

const DEFAULT_RELOAD_REQUEST_TIMEOUT_MS = 2_000;

export async function requestDaemonConfigReload(
  options: RequestConfigReloadOptions = {},
): Promise<ConfigReloadNotificationResult> {
  const endpoint = options.endpoint ?? getRuntimePaths().localEndpoint;
  const token = options.token ?? getDesktopApiToken();
  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("local daemon API request timed out"));
  }, options.timeoutMs ?? DEFAULT_RELOAD_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(
      buildLocalApiUrl(endpoint, "/api/control/config/reload"),
      buildRequestInit(endpoint, token, controller.signal),
    );
    const payload = await readJsonObject(response);
    const message = readPayloadMessage(payload) ?? response.statusText;

    if (response.ok && payload?.accepted === true) {
      return {
        status: "accepted",
        statusCode: response.status,
        message: message || "Config reload accepted.",
      };
    }

    return {
      status: "rejected",
      statusCode: response.status,
      message:
        message ||
        `Config reload request was rejected with HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      status: "failed",
      message: formatError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildRequestInit(
  endpoint: string,
  token: string,
  signal: AbortSignal,
): BunUnixRequestInit {
  const init: BunUnixRequestInit = {
    method: "POST",
    signal,
    headers: {
      [DESKTOP_AUTH_HEADER]: token,
    },
  };

  if (!isHttpEndpoint(endpoint)) {
    init.unix = endpoint;
  }

  return init;
}

function buildLocalApiUrl(endpoint: string, path: string): string {
  if (isHttpEndpoint(endpoint)) {
    return new URL(path, endpoint).toString();
  }

  return `http://localhost${path}`;
}

function isHttpEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("http://") || endpoint.startsWith("https://");
}

async function readJsonObject(
  response: Response,
): Promise<Record<string, any> | null> {
  try {
    const payload = await response.json();
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function readPayloadMessage(payload: Record<string, any> | null): string | null {
  const message = payload?.message ?? payload?.error;
  return typeof message === "string" && message.length > 0 ? message : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
