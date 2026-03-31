# Jin Codebase Syllabus

Structured reading order for a full code review. 48 files, ~8,400 lines
(excluding tests and docs). Grouped by concern, ordered by dependency depth
— read each module before the modules that import it.

---

## Module 1: Foundation (no internal dependencies)

These files have zero imports from other src/ files. Read first — everything
else builds on them.

| # | File | Lines | Does |
|---|------|------:|------|
| 1 | `src/adapters/types.ts` | 107 | Core interfaces: Adapter, Session, Message, ToolUse, ThinkingBlock, ContextArtifact |
| 2 | `src/sinks/types.ts` | 69 | Sink interface, PushPayload, SinkConfig, team config encode/decode |
| 3 | `src/config.ts` | 110 | JinConfig schema, load/save from `~/.config/jin/config.json` |
| 4 | `src/pricing.ts` | 68 | Token cost estimation by model family (Claude, OpenAI, Gemini) |
| 5 | `src/self-observation.ts` | 36 | Prevents jin from re-ingesting its own output files |

**v2 impact:** `types.ts` is ground zero — Session→Conversation, Message gets
new fields, ToolUse→ToolCall becomes a separate entity. `sinks/types.ts`
PushPayload changes shape (adds toolCalls). `config.ts` may need routing
changes (git_remote matching). `pricing.ts` unchanged.

---

## Module 2: Data Layer

### 2a: Store (depends on: types.ts)

| # | File | Lines | Does |
|---|------|------:|------|
| 6 | `src/store.ts` | 816 | SQLite schema + all CRUD: sessions, messages, projects, tags, artifacts, tool_usage, FTS, analytics |

**v2 impact:** Complete rewrite of schema (conversations, messages, tool_calls,
_jin_sync, _jin_push_log). Drop projects/tags/tool_usage/artifacts tables.
All Store methods updated. This is the largest single file change.

### 2b: Adapters (depend on: types.ts, pricing.ts)

Read `registry.ts` last in this group — it imports all adapters.

| # | File | Lines | Does | v2 impact |
|---|------|------:|------|-----------|
| 7 | `src/adapters/claude-code.ts` | 604 | JSONL parser with offset caching, sub-agent detection, incremental ingest | Compaction splitting, trace_id, tool_call extraction, git_remote |
| 8 | `src/adapters/codex.ts` | 345 | JSONL parser, bare + RolloutLine formats, compaction, reasoning blocks | Compaction splitting, sub-agent capture (agent_message), trace_id |
| 9 | `src/adapters/cursor.ts` | 230 | SQLite blob tree traversal, DAG reconstruction | Sub-agent capture (agent-transcripts), state.vscdb tokens |
| 10 | `src/adapters/gemini-cli.ts` | 168 | JSON parser, flexible field names, sub-agent detection | Minor — already detects sub-agents |
| 11 | `src/adapters/amp.ts` | 161 | JSONL parser from .local/share/amp | Minimal — Session→Conversation rename |
| 12 | `src/adapters/kiro.ts` | 147 | SQLite adapter with dynamic table detection | Minimal |
| 13 | `src/adapters/opencode.ts` | 177 | JSON/JSONL with platform-specific paths | Minimal |
| 14 | `src/adapters/pi.ts` | 139 | JSONL from .openclaw/agents | Minimal |
| 15 | `src/adapters/piagent.ts` | 139 | JSONL from .pi/agent | Minimal |
| 16 | `src/adapters/warp.ts` | 137 | SQLite ai_queries table | Minimal |
| 17 | `src/adapters/registry.ts` | 41 | Factory + detectAdapters() | Session→Conversation rename |

**Reading strategy:** Read claude-code.ts thoroughly (it's the most complex
and the template for v2 adapter behavior). Skim the simple adapters (amp
through warp) — they all follow the same pattern. Focus on what each drops
or doesn't capture.

---

## Module 3: Sinks (depend on: sinks/types.ts)

| # | File | Lines | Does | v2 impact |
|---|------|------:|------|-----------|
| 18 | `src/sinks/postgres.ts` | 268 | Postgres sink with dual HTTP/wire mode, ensureTables() DDL | **Major rewrite:** strip all DDL, INSERT-only, add schema version check, push tool_calls |
| 19 | `src/sinks/webhook.ts` | 74 | HTTP POST with batching | Add tool_calls to payload |
| 20 | `src/sinks/s3.ts` | 185 | AWS S3/R2/MinIO with Sig V4 signing | Add tool_calls to JSON output |
| 21 | `src/sinks/postgres-search.ts` | 306 | Remote Postgres FTS + fuzzy search | Update table/column names (sessions→conversations) |
| 22 | `src/sinks/registry.ts` | 31 | Sink factory | Unchanged |

**Key review point:** `postgres.ts` lines 147-228 is the `ensureTables()` DDL
that must be completely removed. Understand what it creates so you know what
`jin schema apply` needs to produce instead.

---

## Module 4: Ingestion Pipeline

The core data flow: adapters → tagger → store → sinks. Read in this order.

| # | File | Lines | Does | v2 impact |
|---|------|------:|------|-----------|
| 23 | `src/tagger.ts` | 198 | Auto-tags sessions with project, model, language, tool usage | **Major change:** project detection moves to git_remote on conversation. Tags/tool_usage tables gone. Some logic (gitRemoteFromCwd) moves to adapter or store. |
| 24 | `src/watcher.ts` | 60 | File system watcher with per-file debouncing | Minimal — session→conversation event rename |
| 25 | `src/progress.ts` | 39 | Ingest progress tracking to disk | Minimal |
| 26 | `src/routing.ts` | 60 | Route matching: session → which sinks | Update to match on git_remote column directly instead of project table lookup |
| 27 | `src/sink-resolver.ts` | 107 | Reverse routing: cwd → which Postgres sinks to search | Update routing logic |
| 28 | `src/commands/ingest.ts` | 77 | Batch ingest: all adapters → store → tags | Session→Conversation, remove tagging calls for projects/tags |
| 29 | `src/commands/watch.ts` | 575 | Daemon loop: initial ingest + watcher + sink push + periodic sync | Largest command file. Session→Conversation throughout. Push logic adds tool_calls. Delta ingest logic. |

**Reading strategy:** `watch.ts` is the heart of the daemon. Read it
carefully — it orchestrates adapters, store, watcher, sinks, and routing.
`tagger.ts` is the most impacted utility file: most of its logic either moves
elsewhere or gets deleted.

---

## Module 5: CLI Commands (depend on: store, config, lifecycle)

Query and display commands. Read after understanding the store schema.

| # | File | Lines | Does | v2 impact |
|---|------|------:|------|-----------|
| 30 | `src/commands/list.ts` | 71 | `jin sessions` — list with filtering | Rename to `jin conversations`, query conversations table |
| 31 | `src/commands/show.ts` | 198 | `jin show <id>` — display messages | Add --trace, --tree flags. Query conversations + tool_calls |
| 32 | `src/commands/search.ts` | 160 | `jin search` — FTS local + remote | Update table references |
| 33 | `src/commands/analyze.ts` | 79 | `jin stats` — token/cost breakdown | Update to use conversations table, add git_remote grouping |
| 34 | `src/commands/export.ts` | 109 | `jin export` — JSON/Markdown output | Add tool_calls to export |
| 35 | `src/commands/status.ts` | 205 | `jin status` — daemon health, sink state | Add schema version display |
| 36 | `src/commands/connect.ts` | 720 | `jin connect` — interactive sink setup + routing | Largest command. Routing changes for git_remote matching |
| 37 | `src/commands/benchmark.ts` | 394 | `jin benchmark` — performance metrics | Session→Conversation rename |

---

## Module 6: Infrastructure (depend on: config, runguard)

Lifecycle, updates, OS services. Less impacted by v2 but still need review.

| # | File | Lines | Does | v2 impact |
|---|------|------:|------|-----------|
| 38 | `src/runguard.ts` | 87 | PID file management, service detection (systemd/launchd/schtasks) | Unchanged |
| 39 | `src/lifecycle.ts` | 207 | Component state detection, stop all | Unchanged |
| 40 | `src/commands/start.ts` | 100 | `jin start` — spawn daemon or service | Unchanged |
| 41 | `src/commands/stop.ts` | 57 | `jin stop` | Unchanged |
| 42 | `src/commands/service.ts` | 426 | Install/uninstall OS service (3 platforms) | Unchanged |
| 43 | `src/updater.ts` | 482 | GitHub release check, self-update, rollback | Add store.db backup on update (v2 nuclear migration trigger) |
| 44 | `src/commands/init.ts` | 149 | First-time setup, team config decode, auto-ingest | Session→Conversation, minor |
| 45 | `src/commands/team-config.ts` | 81 | Encode sink config as base64 for sharing | Unchanged |
| 46 | `src/commands/setup-skills.ts` | 133 | Register jin as skill in Claude Code/Gemini/Codex | Unchanged |

---

## Module 7: API Layer (depends on: store, config)

| # | File | Lines | Does | v2 impact |
|---|------|------:|------|-----------|
| 47 | `src/api/routes.ts` | 151 | REST endpoints: sessions, analytics, projects, tags | Update all endpoints for conversations, add tool_calls, remove projects/tags |
| 48 | `src/api/server.ts` | 289 | Bun HTTP server, SSE live events, SPA routing | SSE events rename session→conversation |
| 49 | `src/api/_spa.ts` | 2 | Embedded dashboard HTML | Unchanged |

---

## Module 8: Entry Point

| # | File | Lines | Does | v2 impact |
|---|------|------:|------|-----------|
| 50 | `src/index.ts` | 528 | CLI arg parsing, command routing, help text, version display | Command renames (sessions→conversations), add `jin schema apply`, help text updates |

---

## Dependency Graph (simplified)

```
                    types.ts ◄──────────────────────────────────┐
                       │                                        │
                       ▼                                        │
    ┌──────────── adapters/*.ts                                 │
    │                  │                                        │
    │                  ▼                                        │
    │            registry.ts                                    │
    │                  │                                        │
    │     ┌────────────┤                                        │
    │     ▼            ▼                                        │
    │  ingest.ts    watch.ts ──► watcher.ts                     │
    │     │            │                                        │
    │     ▼            ▼                                        │
    │  tagger.ts ──► store.ts ◄── commands/*.ts ◄── index.ts   │
    │                  │              │                          │
    │                  ▼              ▼                          │
    │              routing.ts    sink-resolver.ts                │
    │                  │              │                          │
    │                  ▼              ▼                          │
    │              sinks/*.ts    postgres-search.ts              │
    │                  │                                        │
    │                  ▼                                        │
    └───────────► sinks/types.ts ◄──────────────────────────────┘

    config.ts ◄── (used by ~15 files, not shown for clarity)
    lifecycle.ts ◄── start.ts, stop.ts, status.ts
    runguard.ts ◄── lifecycle.ts
    updater.ts ◄── index.ts
```

---

## Suggested Review Order for v2 Design Docs

**Pass 1 — Data model (what changes):**
Types → Store → Claude Code adapter → Codex adapter → Cursor adapter

**Pass 2 — Data flow (how it moves):**
Ingest → Watch → Tagger → Routing → Sinks (postgres.ts especially)

**Pass 3 — Consumer surface (what users see):**
List → Show → Search → Analyze → Export → Status → Index (CLI)

**Pass 4 — Infrastructure (what stays):**
Lifecycle → Runguard → Updater → Service → Init

---

## Files by v2 Impact

**Rewrite (fundamentally different):**
- `store.ts` (816 lines) — new schema, new methods
- `sinks/postgres.ts` (268 lines) — strip DDL, add tool_calls push, schema version check
- `tagger.ts` (198 lines) — most logic deleted or moved

**Heavy modification:**
- `adapters/claude-code.ts` (604 lines) — compaction splitting, trace_id, tool extraction
- `adapters/codex.ts` (345 lines) — compaction splitting, sub-agent capture
- `adapters/types.ts` (107 lines) — Session→Conversation, new fields
- `commands/watch.ts` (575 lines) — conversation throughout, push tool_calls
- `api/routes.ts` (151 lines) — all endpoints updated

**Moderate modification:**
- `adapters/cursor.ts` (230 lines) — sub-agent capture, state.vscdb
- `commands/show.ts` (198 lines) — add --trace, --tree
- `commands/connect.ts` (720 lines) — routing changes
- `commands/search.ts` (160 lines) — table references
- `routing.ts` (60 lines) — git_remote matching
- `sink-resolver.ts` (107 lines) — routing logic
- `index.ts` (528 lines) — command renames, help text
- `sinks/postgres-search.ts` (306 lines) — table/column names
- `updater.ts` (482 lines) — add store.db backup

**Minimal / rename only:**
- 8 simple adapters (amp, gemini-cli, kiro, opencode, pi, piagent, warp, registry)
- `sinks/webhook.ts`, `sinks/s3.ts`, `sinks/registry.ts`
- `commands/ingest.ts`, `commands/list.ts`, `commands/analyze.ts`, `commands/export.ts`
- `commands/benchmark.ts`, `commands/status.ts`

**Unchanged:**
- `lifecycle.ts`, `runguard.ts`, `watcher.ts`, `progress.ts`, `self-observation.ts`
- `commands/start.ts`, `commands/stop.ts`, `commands/service.ts`
- `commands/setup-skills.ts`, `commands/team-config.ts`
- `config.ts`, `pricing.ts`
- `api/server.ts`, `api/_spa.ts`

---

## New Files Needed

| File | Does |
|------|------|
| `src/commands/schema.ts` | `jin schema apply` — create Postgres tables for standalone sinks (admin CLI, not daemon). **Not in tree yet** — Phase 2.4 / `docs/v2-roadmap.md`; no `schema` subcommand in `src/index.ts` until implemented. |

## Files to Delete

| File | Reason |
|------|--------|
| (none deleted, but large sections removed from store.ts, tagger.ts, postgres.ts) | |
