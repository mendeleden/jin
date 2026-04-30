import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { configDir } from "../src/config";

const PORT = Number(process.env.PORT) || 3333;
const HTML_PATH = join(import.meta.dir, "diagnostic-viewer.html");
const DEBUG_LOG = resolveDiagnosticLogPath();

type Candidate = {
  path: string;
  source: string;
};

function resolveDiagnosticLogPath(): Candidate {
  const candidates = diagnosticLogCandidates();
  return (
    candidates.find((candidate) => existsSync(candidate.path)) ??
    candidates[0] ?? {
      path: join(configDir(), "debug.jsonl"),
      source: "jin config dir",
    }
  );
}

function diagnosticLogCandidates(): Candidate[] {
  if (process.env.JIN_DIAGNOSTIC_LOG) {
    return [
      {
        path: process.env.JIN_DIAGNOSTIC_LOG,
        source: "JIN_DIAGNOSTIC_LOG",
      },
    ];
  }

  const home = homedir();
  const candidates: Candidate[] = [
    {
      path: join(configDir(), "debug.jsonl"),
      source: "jin config dir",
    },
  ];

  if (process.platform === "win32") {
    candidates.push(
      {
        path: join(
          process.env.LOCALAPPDATA || join(home, "AppData", "Local"),
          "jin",
          "debug.jsonl",
        ),
        source: "Windows LOCALAPPDATA",
      },
      {
        path: join(
          process.env.APPDATA || join(home, "AppData", "Roaming"),
          "jin",
          "debug.jsonl",
        ),
        source: "Windows APPDATA fallback",
      },
    );
  } else {
    candidates.push(
      {
        path: join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "jin", "debug.jsonl"),
        source: "XDG config",
      },
      {
        path: join(home, ".config", "jin", "debug.jsonl"),
        source: "home .config fallback",
      },
    );

    if (process.platform === "darwin") {
      candidates.push({
        path: join(home, "Library", "Application Support", "jin", "debug.jsonl"),
        source: "macOS Application Support fallback",
      });
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.path.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

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
      if (!existsSync(DEBUG_LOG.path)) {
        const checked = diagnosticLogCandidates()
          .map((candidate) => `- ${candidate.source}: ${candidate.path}`)
          .join("\n");
        return new Response(`debug log not found\nchecked:\n${checked}\n`, {
          status: 404,
          headers: {
            "content-type": "text/plain",
            "cache-control": "no-store",
          },
        });
      }
      return new Response(Bun.file(DEBUG_LOG.path), {
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
console.log(`reading: ${DEBUG_LOG.path}`);
console.log(`source: ${DEBUG_LOG.source}`);
