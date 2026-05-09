import { existsSync, unlinkSync } from "fs";
import { getRuntimePaths } from "../daemon/runtime-state";
import {
  createRoutes,
  matchRoute,
  type CreateRoutesOptions,
} from "./routes";

export interface LocalApiServer {
  readonly socketPath: string;
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
  if ((options.platform ?? process.platform) === "win32") {
    return null;
  }

  const socketPath = options.socketPath ?? getRuntimePaths().socketPath;
  const serve = options.serve ?? ((serveOptions) => Bun.serve(serveOptions));
  removeSocketFile(socketPath);

  const fetch = createApiFetchHandler(options);
  const server = serve({
    unix: socketPath,
    fetch,
    error(error) {
      return json({ error: formatError(error) }, 500);
    },
  });

  return {
    socketPath,
    stop() {
      server.stop(true);
      removeSocketFile(socketPath);
    },
  };
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
