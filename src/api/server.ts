import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { Store } from "../store";
import { loadConfig, configDir } from "../config";
import { createRoutes, matchRoute } from "./routes";
import embeddedHtml from "./_spa";

const UI_PID_FILE = join(configDir(), "ui.pid");
const UI_PORT_FILE = join(configDir(), "ui.port");

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

  // Dashboard HTML is embedded at compile time via scripts/embed-spa.ts
  const spaHtml = embeddedHtml;

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

  const url = `http://localhost:${port}`;
  console.log(`  \x1b[34m\x1b[1mjin\x1b[0m dashboard running at \x1b[36m${url}\x1b[0m`);

  // Write port file so `jin ui status` can find us
  writeFileSync(UI_PORT_FILE, String(port));

  // Open browser
  if (opts.open) {
    openBrowser(url);
  }

  return server;
}

function openBrowser(url: string) {
  const { platform: os } = process;
  try {
    if (os === "darwin") {
      Bun.spawn(["open", url]);
    } else if (os === "linux") {
      Bun.spawn(["xdg-open", url]);
    } else if (os === "win32") {
      Bun.spawn(["cmd", "/c", "start", url]);
    }
  } catch {
    // Silently fail if browser can't be opened
  }
}

/** Check if the UI server is already running */
function getRunningPid(): number | null {
  if (!existsSync(UI_PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(UI_PID_FILE, "utf-8").trim());
    process.kill(pid, 0); // throws if process is dead
    return pid;
  } catch {
    // Stale PID file — clean up
    try { unlinkSync(UI_PID_FILE); } catch {}
    try { unlinkSync(UI_PORT_FILE); } catch {}
    return null;
  }
}

function getRunningPort(): number | null {
  if (!existsSync(UI_PORT_FILE)) return null;
  try {
    return parseInt(readFileSync(UI_PORT_FILE, "utf-8").trim());
  } catch {
    return null;
  }
}

/** Start the UI server as a detached background process */
export async function startDetached(opts: { port?: number }): Promise<void> {
  const port = opts.port || 4000;

  // Check if already running
  const existingPid = getRunningPid();
  if (existingPid) {
    const existingPort = getRunningPort() || "?";
    console.log(`  \x1b[33m!\x1b[0m jin dashboard already running (PID ${existingPid})`);
    console.log(`  \x1b[36mhttp://localhost:${existingPort}\x1b[0m`);
    openBrowser(`http://localhost:${existingPort}`);
    return;
  }

  // Launch detached — detect if running as compiled binary or via bun
  const binPath = process.execPath;
  const isCompiled = !binPath.endsWith("bun") && !binPath.endsWith("node");
  const cmd = isCompiled
    ? [binPath, "ui", "--no-open", `--port=${port}`]
    : [binPath, "run", process.argv[1], "ui", "--no-open", `--port=${port}`];

  const logPath = join(configDir(), "ui.log");
  const { openSync, closeSync } = await import("fs");
  const logFd = openSync(logPath, "a");

  const proc = Bun.spawn(cmd, {
    stdout: logFd,
    stderr: logFd,
    stdin: "ignore",
    env: { ...process.env },
  });
  closeSync(logFd);

  // Wait briefly for it to start
  await Bun.sleep(500);

  if (proc.exitCode !== null) {
    console.log(`  \x1b[31m✗\x1b[0m Failed to start. Check ${logPath}`);
    return;
  }

  writeFileSync(UI_PID_FILE, String(proc.pid));
  writeFileSync(UI_PORT_FILE, String(port));
  proc.unref();

  const url = `http://localhost:${port}`;
  console.log(`  \x1b[32m✓\x1b[0m jin dashboard started (PID ${proc.pid})`);
  console.log(`  \x1b[36m${url}\x1b[0m`);
  console.log(`  \x1b[2mstop: jin ui stop\x1b[0m`);

  openBrowser(url);
}

/** Stop the detached UI server */
export function stopServer(): void {
  const pid = getRunningPid();
  if (!pid) {
    console.log("  \x1b[2mjin dashboard is not running\x1b[0m");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`  \x1b[32m✓\x1b[0m jin dashboard stopped (PID ${pid})`);
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m Failed to stop PID ${pid}: ${err}`);
  }

  try { unlinkSync(UI_PID_FILE); } catch {}
  try { unlinkSync(UI_PORT_FILE); } catch {}
}

/** Show UI server status */
export function serverStatus(): void {
  const pid = getRunningPid();
  if (!pid) {
    console.log("  \x1b[2mjin dashboard is not running\x1b[0m");
    console.log("  \x1b[2mstart: jin ui start\x1b[0m");
    return;
  }

  const port = getRunningPort() || "?";
  console.log(`  \x1b[32m●\x1b[0m jin dashboard running`);
  console.log(`    PID:  ${pid}`);
  console.log(`    URL:  \x1b[36mhttp://localhost:${port}\x1b[0m`);
  console.log(`  \x1b[2mstop: jin ui stop\x1b[0m`);
}
