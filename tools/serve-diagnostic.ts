import { homedir } from "os";
import { join } from "path";

const PORT = Number(process.env.PORT) || 3333;
const HTML_PATH = join(import.meta.dir, "diagnostic-viewer.html");
const DEBUG_LOG = process.env.JIN_DIAGNOSTIC_LOG || join(homedir(), ".config/jin/debug.jsonl");

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/diagnostic-viewer.html") {
      return new Response(Bun.file(HTML_PATH), {
        headers: {
          "content-type": "text/html",
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/debug.jsonl") {
      return new Response(Bun.file(DEBUG_LOG), {
        headers: {
          "content-type": "application/x-ndjson",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`jin diagnostic viewer: http://localhost:${PORT}`);
console.log(`reading: ${DEBUG_LOG}`);
