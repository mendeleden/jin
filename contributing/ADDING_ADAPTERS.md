# Adding a New Adapter

This guide walks through creating an adapter for a new coding tool. By the end,
jin will be able to detect the tool, ingest its sessions, and watch for changes.

---

## The Adapter interface

Defined in `src/adapters/types.ts`:

```typescript
interface Adapter {
  id: string;
  name: string;
  icon: string;

  detect(): Promise<boolean>;
  sessions(): Promise<Session[]>;
  messages(sessionId: string): Promise<Message[]>;
  watchPaths(): string[];
}
```

| Method         | What it does                                           |
|---------------|--------------------------------------------------------|
| `detect()`    | Returns `true` if the tool's data directory exists and contains session files. Called during `jin init`. |
| `sessions()`  | Scans the tool's data directory and returns a `Session[]` with metadata for every conversation found. |
| `messages(sessionId)` | Given a session ID, parses and returns all `Message[]` objects for that conversation. |
| `watchPaths()` | Returns an array of directory paths that `fs.watch()` should monitor for live changes. |

---

## The Session type

```typescript
interface Session {
  id: string;                          // unique identifier for this session
  name: string;                        // display name (first user message, truncated)
  adapterId: string;                   // must match your adapter's id field
  adapterName: string;                 // must match your adapter's name field
  createdAt: string;                   // ISO 8601 timestamp of first message
  updatedAt: string;                   // ISO 8601 timestamp of last message
  durationMs: number;                  // updatedAt - createdAt in milliseconds
  isActive: boolean;                   // true if last message is within ~5 minutes
  totalTokens: number;                 // sum of input + output tokens
  estCost: number;                     // estimated cost (use pricing.ts helper)
  messageCount: number;                // number of messages in the session
  sourcePath: string;                  // absolute path to the raw data file
  isSubAgent: boolean;                 // true if this is a sub-agent/child session
  metadata: Record<string, unknown>;   // any extra tool-specific data
}
```

---

## The Message type

```typescript
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;                     // plain text content
  timestamp: string;                   // ISO 8601
  model: string;                       // e.g. "claude-sonnet-4-20250514", "gpt-4o"
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;                   // cache read tokens (0 if not applicable)
  cacheWrite: number;                  // cache write tokens (0 if not applicable)
  toolUses: ToolUse[];                 // tool calls made in this message
  thinkingBlocks: ThinkingBlock[];     // extended thinking blocks
}
```

Set numeric fields to `0` if the tool does not expose that data. Set string
fields to `""` if not available. The pipeline handles missing data gracefully.

---

## Skeleton adapter

Create `src/adapters/my-tool.ts`:

```typescript
import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { estimateCost } from "../pricing";
import type { Adapter, Session, Message } from "./types";

export class MyToolAdapter implements Adapter {
  id = "my-tool";
  name = "My Tool";
  icon = "M";
  private dataDir: string;

  constructor() {
    // Determine where the tool stores its data.
    // Check platform-specific paths if needed.
    this.dataDir = join(homedir(), ".my-tool", "sessions");
  }

  async detect(): Promise<boolean> {
    if (!existsSync(this.dataDir)) return false;
    // Verify there is at least one session file
    const files = readdirSync(this.dataDir);
    return files.some((f) => f.endsWith(".jsonl"));
  }

  async sessions(): Promise<Session[]> {
    if (!existsSync(this.dataDir)) return [];
    const sessions: Session[] = [];

    for (const file of readdirSync(this.dataDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(this.dataDir, file);

      try {
        const meta = await this.parseSessionMeta(filePath);
        if (!meta || meta.msgCount === 0) continue;

        sessions.push({
          id: meta.sessionId,
          name: meta.name || meta.sessionId.slice(0, 8),
          adapterId: this.id,
          adapterName: this.name,
          createdAt: meta.firstTimestamp,
          updatedAt: meta.lastTimestamp,
          durationMs:
            new Date(meta.lastTimestamp).getTime() -
            new Date(meta.firstTimestamp).getTime(),
          isActive:
            Date.now() - new Date(meta.lastTimestamp).getTime() < 5 * 60 * 1000,
          totalTokens: meta.totalTokens,
          estCost: meta.estCost,
          messageCount: meta.msgCount,
          sourcePath: filePath,
          isSubAgent: false,
          metadata: {},
        });
      } catch {
        continue;
      }
    }

    sessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return sessions;
  }

  async messages(sessionId: string): Promise<Message[]> {
    // Find the file for this session, then parse messages.
    const filePath = join(this.dataDir, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) return [];
    return this.parseMessages(filePath);
  }

  watchPaths(): string[] {
    return existsSync(this.dataDir) ? [this.dataDir] : [];
  }

  // --- Private helpers ---

  private async parseSessionMeta(filePath: string) {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);
    if (lines.length === 0) return null;

    let sessionId = basename(filePath, ".jsonl");
    let firstTimestamp = "";
    let lastTimestamp = "";
    let msgCount = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let firstUserMessage = "";
    let primaryModel = "";

    for (const line of lines) {
      try {
        const rec = JSON.parse(line);

        // Adapt this to the tool's actual JSONL schema.
        if (rec.role === "user" || rec.role === "assistant") {
          if (!firstTimestamp && rec.timestamp) firstTimestamp = rec.timestamp;
          if (rec.timestamp) lastTimestamp = rec.timestamp;
          msgCount++;

          if (rec.role === "user" && !firstUserMessage && rec.content) {
            firstUserMessage =
              typeof rec.content === "string"
                ? rec.content.slice(0, 120)
                : "";
          }
          if (rec.model && !primaryModel) primaryModel = rec.model;
          if (rec.usage) {
            totalInput += rec.usage.input_tokens || 0;
            totalOutput += rec.usage.output_tokens || 0;
          }
        }
      } catch {
        continue;
      }
    }

    return {
      sessionId,
      name: firstUserMessage.replace(/\n/g, " ").slice(0, 120) || sessionId.slice(0, 8),
      firstTimestamp: firstTimestamp || new Date().toISOString(),
      lastTimestamp: lastTimestamp || new Date().toISOString(),
      msgCount,
      totalTokens: totalInput + totalOutput,
      estCost: estimateCost(primaryModel, totalInput, totalOutput),
    };
  }

  private async parseMessages(filePath: string): Promise<Message[]> {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);
    const messages: Message[] = [];

    for (const line of lines) {
      try {
        const rec = JSON.parse(line);

        // Adapt this to the tool's actual schema.
        if (rec.role !== "user" && rec.role !== "assistant") continue;

        messages.push({
          id: rec.id || `msg-${messages.length}`,
          role: rec.role,
          content: typeof rec.content === "string" ? rec.content : "",
          timestamp: rec.timestamp || "",
          model: rec.model || "",
          inputTokens: rec.usage?.input_tokens || 0,
          outputTokens: rec.usage?.output_tokens || 0,
          cacheRead: 0,
          cacheWrite: 0,
          toolUses: [],
          thinkingBlocks: [],
        });
      } catch {
        continue;
      }
    }

    return messages;
  }
}
```

---

## File discovery patterns

Different tools store data in different locations. Common patterns:

**Home directory, dot-folder:**
```typescript
const dataDir = join(homedir(), ".my-tool", "sessions");
```

**XDG config/data paths (Linux/macOS):**
```typescript
const xdg = join(homedir(), ".config", "my-tool", "sessions");
const legacy = join(homedir(), ".my-tool", "sessions");
const dataDir = existsSync(xdg) ? xdg : legacy;
```

**Platform-specific paths:**
```typescript
const home = homedir();
let dataDir: string;
if (process.platform === "darwin") {
  dataDir = join(home, "Library", "Application Support", "MyTool", "sessions");
} else if (process.platform === "win32") {
  dataDir = join(process.env.APPDATA || join(home, "AppData", "Roaming"), "MyTool", "sessions");
} else {
  dataDir = join(home, ".local", "share", "my-tool", "sessions");
}
```

**Nested project directories** (like Claude Code):
```typescript
// Tool stores data per-project in subdirectories
for (const projDir of readdirSync(this.dataDir)) {
  const dirPath = join(this.dataDir, projDir);
  if (!statSync(dirPath).isDirectory()) continue;
  for (const file of readdirSync(dirPath)) {
    if (!file.endsWith(".jsonl")) continue;
    // parse each file as a session
  }
}
```

Always guard with `existsSync()` before reading. Tools may not be installed.

---

## Common parsing patterns

**JSONL (line-delimited JSON):**
Most tools use this format. Each line is a JSON object.

```typescript
const text = await Bun.file(filePath).text();
const lines = text.split("\n").filter(Boolean);
for (const line of lines) {
  try {
    const rec = JSON.parse(line);
    // process rec
  } catch {
    continue;  // skip malformed lines
  }
}
```

**SQLite database:**
Some tools store data in SQLite. Use `bun:sqlite` directly.

```typescript
import { Database } from "bun:sqlite";

const db = new Database(filePath, { readonly: true });
const rows = db.prepare("SELECT * FROM conversations").all();
db.close();
```

**Single JSON file:**
Some tools write one JSON file per session.

```typescript
const data = JSON.parse(await Bun.file(filePath).text());
// data is the full session object
```

Always wrap parsing in try/catch. Files may be partially written, corrupted,
or in an unexpected format version.

---

## Register in registry.ts

Edit `src/adapters/registry.ts`:

```typescript
import { MyToolAdapter } from "./my-tool";

export function allAdapters(): Adapter[] {
  return [
    new ClaudeCodeAdapter(),
    new CursorAdapter(),
    // ... existing adapters ...
    new MyToolAdapter(),
  ];
}
```

Also add the default config entry in `src/config.ts`:

```typescript
export function defaultConfig(): JinConfig {
  return {
    adapters: {
      // ... existing ...
      "my-tool": { enabled: true },
    },
    // ...
  };
}
```

---

## Test your adapter

**Quick local test:**

```bash
# Verify detection
bun run src/index.ts init
# Should show "my-tool" as detected (if its data exists on your machine)

# Verify data
bun run src/index.ts sessions --adapter=my-tool
bun run src/index.ts stats
```

**Typecheck:**

```bash
bun run typecheck
```

**With the Docker test harness:**

If the tool has a CLI that can be run in Docker, add a Dockerfile under
`test-harness/<tool-name>/Dockerfile` and a service entry in
`test-harness/docker-compose.yml`. Follow the pattern of the existing
`gemini-cli` or `codex` services. Mount the tool's data directory as a shared
volume so `jin-watch` can pick it up.

---

## Checklist

- [ ] Adapter file created at `src/adapters/<tool-name>.ts`
- [ ] Implements all `Adapter` interface methods
- [ ] `detect()` returns `false` when tool is not installed (no crashes)
- [ ] `sessions()` handles empty directories and malformed files
- [ ] `messages()` returns well-formed `Message[]` with correct roles
- [ ] Registered in `src/adapters/registry.ts`
- [ ] Default config added in `src/config.ts`
- [ ] `bun run typecheck` passes
- [ ] Tested with `jin init` and `jin sessions`
