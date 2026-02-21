# jin Architecture

This document describes the internal architecture of jin: how data flows from
coding tool files to normalized storage to output sinks.

---

## Data flow

```
Tool files on disk        Adapters             Store             Sinks
-------------------     -----------         -----------       -----------
~/.claude/projects/  ->  claude-code  -\
~/.codex/sessions/   ->  codex         \
~/.gemini/           ->  gemini-cli     +-> SQLite (WAL) --> webhook
~/.config/cursor/    ->  cursor        /                  --> postgres
~/.kiro/             ->  kiro         /                   --> s3
  ...                    ...        -/
```

Each adapter reads tool-specific files, normalizes them into `Session` and
`Message` objects, and hands them to the `Store`. Sinks read from the store
and push data to external destinations.

---

## Adapter pattern

Defined in `src/adapters/types.ts`.

Each adapter implements the `Adapter` interface:

```typescript
interface Adapter {
  id: string;          // unique key, e.g. "claude-code"
  name: string;        // display name, e.g. "Claude Code"
  icon: string;        // single char for CLI output

  detect(): Promise<boolean>;          // is tool data present?
  sessions(): Promise<Session[]>;      // list all sessions
  messages(sessionId: string): Promise<Message[]>;  // messages for a session
  watchPaths(): string[];              // dirs to watch for changes
}
```

**Session** captures metadata about a conversation:

| Field          | Type                    | Description                          |
|---------------|-------------------------|--------------------------------------|
| `id`          | `string`                | Unique session identifier             |
| `name`        | `string`                | Display name (often first user msg)   |
| `adapterId`   | `string`                | Which adapter produced this session   |
| `adapterName` | `string`                | Human-readable adapter name           |
| `createdAt`   | `string` (ISO 8601)     | When the session started              |
| `updatedAt`   | `string` (ISO 8601)     | Last activity timestamp               |
| `durationMs`  | `number`                | Wall-clock duration                   |
| `isActive`    | `boolean`               | Whether the session is still live     |
| `totalTokens` | `number`                | Sum of input + output tokens          |
| `estCost`     | `number`                | Estimated cost in USD                 |
| `messageCount`| `number`                | Number of messages                    |
| `sourcePath`  | `string`                | Path to the raw source file           |
| `isSubAgent`  | `boolean`               | Whether this is a sub-agent session   |
| `metadata`    | `Record<string, unknown>` | Adapter-specific extra data         |

**Message** captures a single turn in the conversation:

| Field           | Type              | Description                          |
|----------------|-------------------|--------------------------------------|
| `id`           | `string`          | Unique message identifier             |
| `role`         | `"user" \| "assistant"` | Who sent this message          |
| `content`      | `string`          | Text content of the message           |
| `timestamp`    | `string` (ISO 8601) | When the message was sent          |
| `model`        | `string`          | Model used (e.g. "claude-sonnet-4-20250514") |
| `inputTokens`  | `number`          | Input tokens consumed                 |
| `outputTokens` | `number`          | Output tokens generated               |
| `cacheRead`    | `number`          | Cache read tokens                     |
| `cacheWrite`   | `number`          | Cache write tokens                    |
| `toolUses`     | `ToolUse[]`       | Tool calls made in this message       |
| `thinkingBlocks` | `ThinkingBlock[]` | Extended thinking content           |

Each `ToolUse` has `id`, `name`, `input`, and `output` fields.
Each `ThinkingBlock` has `content` and `tokenCount`.

Adapters are registered in `src/adapters/registry.ts`. The `allAdapters()`
function returns every known adapter. The `detectAdapters()` function filters
to only those whose `detect()` returns true on the current machine.

---

## Sink pattern

Defined in `src/sinks/types.ts`.

Each sink implements the `Sink` interface:

```typescript
interface Sink {
  id: string;
  name: string;

  healthCheck(): Promise<{ ok: boolean; error?: string }>;
  push(data: PushPayload[]): Promise<PushResult>;
  close(): Promise<void>;
}
```

`PushPayload` pairs a `Session` with its `Message[]` array. `PushResult`
reports how many were pushed, how many failed, and any error strings.

Sinks are instantiated via a factory in `src/sinks/registry.ts`:

```typescript
const SINK_FACTORIES: Record<string, (config: SinkConfig) => Sink> = {
  webhook:  (c) => new WebhookSink(c),
  postgres: (c) => new PostgresSink(c),
  s3:       (c) => new S3Sink(c),
};
```

`SinkConfig` is a union-style config object. The `type` field selects the sink.
Remaining fields are sink-specific (e.g. `url` for webhook, `connectionString`
for Postgres, `bucket`/`region`/`endpoint` for S3). Shared fields include
`batchSize`, `teamId`, and `developerId`.

---

## Store

Defined in `src/store.ts`. Uses `bun:sqlite` with WAL mode enabled.

**Tables:**

| Table       | Purpose                                              |
|------------|------------------------------------------------------|
| `sessions` | One row per session. Primary key is `id`. Stores adapter info, timestamps, token counts, cost, source path, metadata (JSON). |
| `messages` | One row per message. Foreign key to `sessions.id` with cascade delete. Stores role, content, model, token counts, tool_uses (JSON), thinking_blocks (JSON). |
| `push_log` | Tracks which sessions have been pushed to which endpoints and the HTTP status. Used by `unpushedSessions()` to avoid re-pushing. |

**Key indexes:** `sessions.adapter_id`, `sessions.updated_at`,
`messages.session_id`, `messages.timestamp`.

All writes use upsert (`INSERT ... ON CONFLICT DO UPDATE`) so re-ingesting
the same session is idempotent. Message batches are wrapped in a transaction.

---

## Watcher

Defined in `src/watcher.ts`.

The `FileWatcher` class wraps Node's `fs.watch()` with recursive watching and
per-path debouncing. Each adapter provides `watchPaths()` -- typically the
directories where the tool writes conversation data. The watcher emits
`WatchEvent` objects with a type (`session_created`, `session_updated`,
`message_added`), the adapter ID, and the file path.

Debounce is configured via `watch.debounceMs` in the config (default: 200ms).
This prevents duplicate ingestion from rapid file writes.

The `jin watch` command sets up the watcher, and on each event, re-ingests
the affected adapter. With `--daemon`, it forks to background and writes a
PID file.

---

## Run modes

jin can run in three modes:

| Mode        | How to start            | How it persists                    |
|------------|-------------------------|------------------------------------|
| Foreground | `jin watch`             | Runs in the terminal, Ctrl+C stops |
| Daemon     | `jin watch --daemon`    | Forks to background, PID file at `~/.config/jin/jin.pid` |
| OS service | `jin service install`   | systemd (Linux), launchd (macOS), Task Scheduler (Windows) |

---

## Run guards

Defined in `src/runguard.ts`.

Before starting, jin checks for conflicting instances:

1. **PID file check** (`isDaemonRunning()`): Reads `~/.config/jin/jin.pid`,
   verifies the process is alive with `process.kill(pid, 0)`.

2. **Service check** (`isServiceInstalled()` / `isServiceActive()`): Checks
   for a systemd unit (`~/.config/systemd/user/jin.service`), a launchd plist
   (`~/Library/LaunchAgents/com.jin.agent.plist`), or a Windows scheduled task.

3. **Mode detection** (`detectRunMode()`): Returns `"service"`, `"daemon"`,
   `"foreground"`, or `"none"`. Used by `jin status` and to prevent conflicting
   instances.

---

## Config

Defined in `src/config.ts`. Stored at `~/.config/jin/config.json`.

```typescript
interface JinConfig {
  adapters: Record<string, AdapterConfig>;  // per-adapter enable/disable + path override
  sinks: SinkConfig[];                      // array of sink configurations
  team?: TeamConfig;                        // teamId, developerId, sync mode
  push?: PushConfig;                        // legacy webhook shortcut
  store: StoreConfig;                       // dbPath, rawDir
  watch: WatchConfig;                       // debounceMs, pollIntervalMs
}
```

Default paths:
- Config file: `~/.config/jin/config.json`
- SQLite database: `~/.config/jin/store.db`
- Raw file copies: `~/.config/jin/raw/`

All adapters are enabled by default. Sinks are empty until configured via
`jin init --team=<code>` or manual editing.

---

## Team config

For team deployments, a lead generates a base64-encoded sink config:

```bash
jin team-config --type=postgres --connection-string="postgres://..." --team-id=myteam
# Outputs: eyJ0eXBlIjoicG9zdGdyZXMiLC4uLn0=
```

Developers onboard with:

```bash
jin init --team=eyJ0eXBlIjoicG9zdGdyZXMiLC4uLn0=
jin watch
```

The encoding/decoding functions are in `src/sinks/types.ts`:
`encodeTeamConfig()` and `decodeTeamConfig()`. The encoded string is a plain
base64 of the JSON `SinkConfig` object. This avoids requiring developers to
manually configure connection strings or credentials.
