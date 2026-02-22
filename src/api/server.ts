import { Store } from "../store";
import { loadConfig } from "../config";
import { createRoutes, matchRoute } from "./routes";

// SSE clients for live feed
const sseClients = new Set<ReadableStreamDefaultController>();

export function broadcastEvent(event: { type: string; data: unknown }) {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const controller of sseClients) {
    try {
      controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(controller);
    }
  }
}

export async function startServer(opts: {
  port?: number;
  dev?: boolean;
  open?: boolean;
}) {
  const port = opts.port || 4000;
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);
  const routes = createRoutes(store);

  // Try to load embedded SPA HTML (available after dashboard build)
  let spaHtml = "<!DOCTYPE html><html><body><h1>jin dashboard</h1><p>Run <code>cd dashboard && bun run build</code> to build the SPA.</p></body></html>";
  try {
    const { resolve, dirname } = await import("path");
    const dir = dirname(new URL(import.meta.url).pathname);
    const htmlPath = resolve(dir, "../../dashboard/dist/index.html");
    const file = Bun.file(htmlPath);
    if (await file.exists()) {
      spaHtml = await file.text();
    }
  } catch {
    // Dashboard not built yet — use placeholder
  }

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // SSE feed endpoint
      if (pathname === "/api/feed" && req.method === "GET") {
        const stream = new ReadableStream({
          start(controller) {
            sseClients.add(controller);
            // Send initial connected event
            controller.enqueue(
              new TextEncoder().encode(`event: connected\ndata: {}\n\n`)
            );
          },
          cancel(controller) {
            sseClients.delete(controller);
          },
        });
        return new Response(stream, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      // API routes
      if (pathname.startsWith("/api/")) {
        const match = matchRoute(routes, req.method, pathname);
        if (match) {
          try {
            const response = await match.handler(req, match.params);
            // Add CORS headers to response
            const headers = new Headers(response.headers);
            for (const [k, v] of Object.entries(corsHeaders)) {
              headers.set(k, v);
            }
            return new Response(response.body, {
              status: response.status,
              headers,
            });
          } catch (err) {
            console.error("API error:", err);
            return new Response(
              JSON.stringify({ error: "Internal server error" }),
              {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders },
              }
            );
          }
        }
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // Dev mode: proxy to Vite dev server
      if (opts.dev) {
        try {
          const viteUrl = `http://localhost:5173${pathname}${url.search}`;
          const viteResp = await fetch(viteUrl, {
            method: req.method,
            headers: req.headers,
            body: req.method !== "GET" ? req.body : undefined,
          });
          return new Response(viteResp.body, {
            status: viteResp.status,
            headers: viteResp.headers,
          });
        } catch {
          // Vite not running, fall through to embedded SPA
        }
      }

      // Serve embedded SPA for all non-API routes (client-side routing)
      return new Response(spaHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });

  console.log(`  jin dashboard running at http://localhost:${port}`);

  // Open browser
  if (opts.open) {
    const url = `http://localhost:${port}`;
    const { platform } = process;
    try {
      if (platform === "darwin") {
        Bun.spawn(["open", url]);
      } else if (platform === "linux") {
        Bun.spawn(["xdg-open", url]);
      } else if (platform === "win32") {
        Bun.spawn(["cmd", "/c", "start", url]);
      }
    } catch {
      // Silently fail if browser can't be opened
    }
  }

  return server;
}
