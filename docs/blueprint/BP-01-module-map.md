---
title: "BP-01: Module Map & File Layout"
status: reviewed
created: 2026-03-28
depends-on: []
informs: [BP-02, BP-03, BP-04, BP-05, BP-06, BP-07, BP-08, BP-10]
---

# BP-01: Module Map & File Layout

## Principle

The directory structure reflects the **data flow**, not the file types.

Jin is a loop:

```
file change → parse via adapter → save to store → push to sinks → wait → repeat
```

The module map makes this loop obvious. One directory — `pipeline/` — is the
brain. Everything else is a layer the brain calls into, or a thin wrapper
that calls the brain.

---

## Layers

```
Source files on disk
       ↓
   [ Adapters ]       Read-only parsers. Know tool formats. Own change detection.
       ↓
   [ Pipeline ]        THE BRAIN. The loop. Ingest, push, watch, schedule.
       ↓  ↑
   [ Store ]           SQLite. Schema, CRUD, search, sync tracking.
       ↓
   [ Sinks ]           Push to remote. Postgres, S3, webhook.

Cross-cutting:
   [ Daemon ]          Process lifecycle: PID, signals, daemonize, service.
   [ Commands ]        CLI entry points. Thin wrappers.
   [ Config ]          User preferences. Read-only at runtime.
```

Each directory owns **one concern**. No file reaches across two layers
except through a defined interface.

---

## File Layout

```
src/
  adapters/              # Read-only parsers
    types.ts             #   Conversation, Message, ToolCall interfaces
    registry.ts          #   allAdapters() — returns all known adapters
    claude-code.ts       #   Claude Code JSONL parser
    codex.ts             #   Codex JSONL + state DB parser
    cursor.ts            #   Cursor multi-layer parser (state.vscdb + transcripts)
    gemini-cli.ts        #   Gemini CLI JSON parser
    amp.ts               #   Simple adapters...
    kiro.ts
    opencode.ts
    pi.ts
    piagent.ts
    warp.ts

  pipeline/              # THE BRAIN — the jin loop
    loop.ts              #   The coordinator: setup → ingest → push → watch → periodic → shutdown
    ingest.ts            #   ingestAdapter() — call adapter, write store
    push.ts              #   pushToSinks() — read store, route, push to sinks, backpressure
    watcher.ts           #   FileWatcher — fs.watch wrapper, debounce, triggers the loop

  db/                    # SQLite persistence
    store.ts             #   getStore() singleton, open/close, transaction helpers
    schema.ts            #   PRAGMA user_version migrations array
    conversations.ts     #   Conversation CRUD (upsert, get, list, count)
    messages.ts          #   Message CRUD (upsert, get, count)
    tool-calls.ts        #   ToolCall CRUD (insert, get, query by name)
    sync.ts              #   _jin_sync + _jin_push_state — push state tracking
    search.ts            #   FTS5 full-text search

  sinks/                 # Push to remote
    types.ts             #   Sink interface, SinkConfig union, PushPayload
    registry.ts          #   createSink() factory
    postgres.ts          #   Postgres INSERT writer (no DDL)
    s3.ts                #   S3/R2/MinIO JSON upload
    webhook.ts           #   HTTP POST

  daemon/                # Process lifecycle
    process-state.ts     #   PID_FILE, isDaemonRunning, stop, cleanup
    daemonize.ts         #   Fork to background, env vars, log redirect

  commands/              # CLI wrappers (thin)
    start.ts             #   Guards → launch daemon or foreground
    stop.ts              #   Stop daemon
    watch.ts             #   Foreground mode — calls pipeline/loop.ts
    service.ts           #   OS service install/uninstall
    schema.ts            #   jin schema apply — admin/operator DDL for Postgres (escape hatch; not core onboarding — BP-Product-Strategy.md)
    sink.ts              #   jin sink add/remove/pause/resume
    route.ts             #   jin route add/remove
    ingest.ts            #   One-shot ingest (jin ingest)
    show.ts              #   Show conversation + --trace + --tree
    list.ts              #   List conversations
    search.ts            #   FTS search
    stats.ts             #   Token/cost analytics
    export.ts            #   Export conversations
    status.ts            #   Daemon health, sink state, schema versions

  api/                   # Dashboard HTTP server
    server.ts            #   Bun.serve setup
    routes.ts            #   REST endpoints

  routing.ts             # Conversation → sink matching (glob, AND semantics)
  config.ts              # Config loading — user preferences, read-only at runtime
  pricing.ts             # Model cost estimation
  index.ts               # CLI entry point, command routing
```

---

## Module Responsibilities

### pipeline/ — "The brain. The loop."

The pipeline is jin's core runtime. It owns the entire data flow:
file change → adapter → store → sink.

**Contains:**

- **loop.ts** — The coordinator. Sets up adapters and sinks, runs initial
  ingest, starts the file watcher, runs periodic full scans, handles
  shutdown. This file reads like a story — the top-level flow of jin in
  ~150 lines.

- **ingest.ts** — Calls `adapter.findChanged()` and `adapter.loadConversation()`
  for each changed ref, writes bundles to the store. Handles batching
  (yield between groups to cap RSS) and error logging. Never touches sinks.

- **push.ts** — Reads from the store (`conversationsNeedingPush()`), routes
  conversations to sinks, pushes full snapshots in batches with backpressure.
  Records push results. Never touches adapters.

- **watcher.ts** — Wraps `fs.watch()` with debouncing. When a file changes,
  it fires a callback that the loop uses to trigger ingest → push.

**Owns:**
- The ingest → store → push flow
- Scheduling (periodic scan intervals, push debounce timers)
- Backpressure (batch sizes, GC yields, RSS monitoring)

**Does NOT own:**
- Parsing source files (adapters)
- SQLite schema or queries (db/)
- Remote connections (sinks/)
- Process lifecycle (daemon/)

**Why one directory:** Jin's loop is one flow. Splitting ingest and push
across different directories forces you to read two places to understand
one thing. Co-locating them in `pipeline/` means: open one directory, see
the brain. The files within are separate (ingest.ts vs push.ts) because
they have different failure modes, but they sit together because they're
one flow.

### adapters/ — "Read source files, return normalized data"

**Owns:**
- Parsing tool-specific file formats (JSONL, SQLite, JSON)
- Change detection (each adapter knows its own storage model)
- ID generation (deterministic, derived from source data)
- Compaction splitting (adapter-specific boundary detection)
- git_remote and branch resolution (from conversation cwd)
- Tool call extraction (from source format to ToolCall[])

**Does NOT own:**
- Writing to the store (pipeline/ingest.ts does that)
- Deciding when to run (pipeline calls it)
- Push tracking or sink routing
- File watching

**Interface:** See BP-04 (Adapter Contract).

### db/ — "SQLite persistence with typed access"

**Owns:**
- SQLite schema definition and migration (PRAGMA user_version)
- CRUD for conversations, messages, tool_calls
- Push state tracking (_jin_sync, _jin_push_state)
- FTS5 search
- Singleton access (getStore())

**Does NOT own:**
- Deciding what to store (pipeline passes data in)
- Remote database management (sinks handle Postgres)
- Business logic (no "if adapter is X, then Y")

**Why split into multiple files:** The store manages 5 entity types
(conversations, messages, tool_calls, sync, search) plus schema. Splitting
by entity keeps each file under 150 lines with a single purpose. A schema
change to messages touches messages.ts — not a 500-line monolith.

**Interface:** See BP-05 (Store & Migration).

### sinks/ — "Push data to remote systems"

**Owns:**
- Formatting data for remote systems (Postgres SQL, S3 JSON, webhook HTTP)
- Connection management (open, healthcheck, close)
- Family-specific readiness checks (table sinks verify schema version via
  jin_meta; object sinks verify bucket access; delivery sinks verify
  endpoint reachability)
- Retry and error handling for remote calls

**Does NOT own:**
- Remote resource provisioning (admin/platform: migrations, optional
  `jin schema apply` for generic Postgres — operator escape hatch per
  BP-Product-Strategy.md; infra creates buckets; receivers register endpoints)
- Deciding what to push (pipeline/push.ts handles that)
- Change detection or push tracking (db/sync.ts tracks what's been pushed)

**Interface:** See BP-06 (Sink Contract).

### daemon/ — "Manage the jin process"

**Owns:**
- PID file management (single PID_FILE constant, single location)
- Process detection: isDaemonRunning(), isServiceActive(), isServiceInstalled()
- Process control: stopWatcher(), stopAll()
- Daemonize: fork to background, redirect stdout, set env vars
- Environment variable contracts: JIN_DAEMON, JIN_LAUNCHED_BY_SERVICE

**Does NOT own:**
- What the daemon does (pipeline/ owns that)
- CLI command parsing (commands/ own that)
- Config loading

### commands/ — "Thin CLI wrappers"

**Owns:**
- Argument parsing and validation
- User-facing output (console.log, progress bars)
- Composing calls to the layers above

**Does NOT own:**
- Business logic — delegates to pipeline/, db/, sinks/, daemon/
- Each command should be under 100 lines

The key insight: `commands/watch.ts` (foreground mode) is a thin wrapper
that loads config, detects adapters, connects sinks, then calls
`pipeline/loop.ts`. The brain is in pipeline/, not in the command.

### config.ts — "User preferences, read-only at runtime"

Config stores what the **user** decided: which sinks, what routes, watch
settings. It does not store machine-detected state.

**Adapter presence detection is ephemeral.** The daemon calls
`adapter.detect()` on every startup and periodic scan. This is only the cheap
"is this tool installed here?" check. It does not persist detection results to
config. If a developer installs a new coding tool, the daemon discovers it on
the next cycle — no `jin init` required, no config write needed.

**Startup discovery is a different phase.** After presence detection, the
pipeline still runs `findChanged({ kind: "startup-scan" })`, which can be
expensive for rich adapters and therefore lives under the BP-02/BP-04 memory
contract and the BP-10 validation gate. Config stays read-only; we do not
persist discovery output into config as a shortcut.

Config stores adapter **overrides** only: if a user explicitly disables an
adapter (`{ "claude-code": { "enabled": false } }`), that preference is
persisted. Everything else is derived at runtime.

```typescript
// Adapter resolution: detect() is a cheap presence check.
// Startup discovery happens later in the pipeline.
for (const adapter of allAdapters()) {
  const pref = config.adapters[adapter.id];
  if (pref?.enabled === false) continue;  // User explicitly disabled
  if (await adapter.detect()) active.push(adapter);
}
// No config write. Detection is ephemeral. Config is read-only.
```

**Why read-only at runtime:**
- Eliminates config file write races between daemon and CLI commands
- Clean ownership: user writes config (via `jin sink add`, `jin route add`,
  manual edit), daemon reads it
- One-shot commands (`jin show`, `jin search`) also call `detect()` for the
  same cheap presence check, but any real startup discovery work still belongs
  to the pipeline path rather than config

### routing.ts — "Match conversations to sinks"

Lives at `src/routing.ts` — not inside pipeline/ or sinks/. It's a pure
matching function: given a conversation and a set of route rules, return
which sinks should receive it.

**Owns:**
- Glob matching on conversation fields (git_remote, cwd, adapter_id, name)
- AND semantics: multiple fields in one route must all match
- No side effects — pure function

**Called by:** pipeline/push.ts during the push phase.

---

## Dependency Rules

```
adapters/types.ts           (LEAF — no outbound dependencies)
      ↑
adapters/*.ts ──────────+
      ↑                 |
      |                 ↓
pipeline/ingest.ts → db/*.ts → (bun:sqlite)
      |                 ↑
      |                 |
pipeline/push.ts ───→ db/sync.ts
      |
      ↓
pipeline/push.ts → sinks/*.ts
      |
      ↓
pipeline/push.ts → routing.ts → config.ts

daemon/*.ts → config.ts    (only needs configDir())

commands/*.ts → pipeline/ + db/ + daemon/ + config.ts
api/routes.ts → db/ + config.ts
```

**Rules:**
1. `adapters/` never imports from `db/`, `sinks/`, `pipeline/`, or `daemon/`
2. `db/` never imports from `sinks/`, `pipeline/`, or `daemon/`
3. `sinks/` never imports from `db/` or `pipeline/` — sinks receive data via function parameters, they don't reach into the store
4. `pipeline/` imports from `adapters/`, `db/`, `sinks/`, `routing.ts` — it's the orchestrator that wires everything together
5. `daemon/` only imports from `config.ts` (for directory paths)
6. `commands/` can import from anything — they're the composition root
7. No circular imports. Period.

---

## Design Decisions Captured Here

| Decision | Rationale |
|----------|-----------|
| Pipeline is one directory (not split ingest/ + push/) | The loop is one flow. Co-locating ingest and push makes the brain obvious. Files are separate for editing; directory is shared for navigation. |
| Config is read-only at runtime | Eliminates write races. Detection is ephemeral — `detect()` is cheap. Config stores user preferences only. |
| Routing lives at src/ root | It's a pure matching function used by pipeline/push.ts. It doesn't belong inside pipeline (it's not the loop) or sinks (it doesn't push data). |
| db/ is split by entity | Conversations, messages, tool_calls, sync, search each get their own file. Schema changes are scoped, not monolithic. |
| Commands are thin wrappers | Business logic lives in pipeline/, db/, daemon/. Commands compose and format output. Under 100 lines each. |
| Sinks receive data via parameters | `sinks/postgres.ts` never imports from `db/`. The push function in pipeline/ reads from the store and passes data to the sink. Clean layer separation. |

---

## References

- BP-04: Adapter Contract — what adapters provide to the pipeline
- BP-05: Store & Migration — how db/ manages schema and data
- BP-06: Sink Contract — how sinks receive and push data
- BP-07: Process Lifecycle — how daemon/ manages the process
- BP-08: Routing & Configuration — how conversations match to sinks
- BP-10: Performance Validation — how release perf validation proves the
  runtime budgets without persisting discovery state into config
