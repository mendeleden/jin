import { existsSync, unlinkSync } from "fs";
import {
  getDesktopApiToken,
  isAuthorizedDesktopRequest,
} from "./auth";
import { getRuntimePaths } from "../daemon/runtime-state";
import {
  createRoutes,
  matchRoute,
  type CreateRoutesOptions,
} from "./routes";

export interface LocalApiServer {
  readonly socketPath: string;
  readonly localEndpoint: string;
  stop(): void;
}

interface LocalApiServerHandle {
  stop(closeActiveConnections?: boolean): void;
}

interface LocalApiServeOptions {
  unix: string;
  fetch: (request: Request) => Promise<Response>;
  error(error: unknown): Response;
}

type LocalApiServe = (
  options: LocalApiServeOptions,
) => LocalApiServerHandle;

export interface StartLocalApiServerOptions extends CreateRoutesOptions {
  authToken?: string;
  localEndpoint?: string;
  platform?: NodeJS.Platform;
  socketPath?: string;
  serve?: LocalApiServe;
}

export function createApiFetchHandler(
  options: CreateRoutesOptions = {},
): (request: Request) => Promise<Response> {
  const routes = createRoutes(options);

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const match = matchRoute(routes, request.method, url.pathname);
    if (!match) {
      return json({ error: "Not found" }, 404);
    }

    try {
      return await match.handler(request, match.params);
    } catch (error) {
      return json({ error: formatError(error) }, 500);
    }
  };
}

export function startLocalApiServer(
  options: StartLocalApiServerOptions = {},
): LocalApiServer | null {
  const socketPath =
    options.localEndpoint ?? options.socketPath ?? getRuntimePaths().socketPath;
  const fetch = createAuthenticatedApiFetchHandler(
    createApiFetchHandler(options),
    options.authToken ?? getDesktopApiToken(),
  );
  if ((options.platform ?? process.platform) === "win32") {
    return startWindowsHttpApiServer(socketPath, fetch, options);
  }

  const serve = options.serve ?? ((serveOptions) => Bun.serve(serveOptions));
  removeSocketFile(socketPath);

  const server = serve({
    unix: socketPath,
    fetch,
    error(error) {
      return json({ error: formatError(error) }, 500);
    },
  });

  return {
    socketPath,
    localEndpoint: socketPath,
    stop() {
      server.stop(true);
      removeSocketFile(socketPath);
    },
  };
}

function startWindowsHttpApiServer(
  endpoint: string,
  fetch: (request: Request) => Promise<Response>,
  options: StartLocalApiServerOptions,
): LocalApiServer {
  assertWindowsLoopbackEndpoint(endpoint);
  if (options.serve) {
    const server = options.serve({
      unix: endpoint,
      fetch,
      error(error) {
        return json({ error: formatError(error) }, 500);
      },
    });

    return {
      socketPath: endpoint,
      localEndpoint: endpoint,
      stop() {
        server.stop(true);
      },
    };
  }

  const url = new URL(endpoint);
  const server = Bun.serve({
    hostname: url.hostname,
    port: Number(url.port),
    fetch,
    error(error) {
      return json({ error: formatError(error) }, 500);
    },
  });

  return {
    socketPath: endpoint,
    localEndpoint: endpoint,
    stop() {
      server.stop(true);
    },
  };
}

function createAuthenticatedApiFetchHandler(
  fetch: (request: Request) => Promise<Response>,
  authToken: string,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (!isAuthorizedDesktopRequest(request, authToken)) {
      return json({ error: "Unauthorized" }, 401);
    }

    return fetch(request);
  };
}

function assertWindowsLoopbackEndpoint(endpoint: string): void {
  const url = new URL(endpoint);
  if (url.protocol !== "http:") {
    throw new Error("Windows local API endpoint must use http.");
  }
  if (url.hostname !== "127.0.0.1") {
    throw new Error("Windows local API endpoint must bind to 127.0.0.1.");
  }
  if (!url.port || !Number.isInteger(Number(url.port))) {
    throw new Error("Windows local API endpoint must include a numeric port.");
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function removeSocketFile(socketPath: string): void {
  if (!existsSync(socketPath)) {
    return;
  }

  try {
    unlinkSync(socketPath);
  } catch {}
}
