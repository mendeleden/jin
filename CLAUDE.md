# Jin

Jin is a CLI daemon that ingests AI coding conversation data from 10+ tools into SQLite and pushes to remote sinks (Postgres, S3, webhook). It runs as a background process watching for file changes, parsing tool-specific formats, and syncing normalized data.

## Build & Test

```bash
bun test                    # unit tests
bun run typecheck           # tsc --noEmit
bun run build               # compile binary
bun run test:integration    # postgres/s3 via docker compose
bun run dev                 # run from source
```

## Architecture

```
Adapter (read tool files) → Ingest (watch.ts loop) → Store (SQLite) → Sink (push to remote)
```

- **Adapters** (`src/adapters/`): Read-only parsers. Each knows one tool's file format. Return `Conversation[]` and `Message[]`.
- **Store** (`src/store.ts`): SQLite — schema, CRUD, push tracking, FTS5 search.
- **Sinks** (`src/sinks/`): Push data to Postgres, S3, or webhook endpoints.
- **Watch** (`src/commands/watch.ts`): Daemon loop — detects file changes, calls adapters, writes store, pushes sinks.
- **Config** (`src/config.ts`): `~/.config/jin/config.json` — adapters, sinks, routing rules.

### Supported Adapters
Claude Code, Codex, Cursor, Gemini CLI, Amp, Kiro, OpenCode, Pi, PiAgent, Warp

### Supported Sinks
Postgres, S3 (AWS/R2/MinIO), Webhook

## v2 Redesign (In Progress)

We are doing a full v2 rewrite. Key decisions:

- **Session → Conversation**: Everything is a Conversation. Compaction segments, sub-agents, forks — all linked via `trace_id`/`parent_id`/`relationship`.
- **tool_calls table**: Extracted from messages, queryable via SQL. Not JSON blobs.
- **git_remote replaces projects**: No projects table. Route matching reads conversation columns directly.
- **Tags dropped**: Replaced by conversation columns (`adapter_id`, `model`, `branch`, `labels`).
- **Nuclear migration**: Drop existing data, re-ingest from source files. IDs are deterministic.
- **Jin never runs DDL on Postgres**: Least privilege. Schema owned by admin/Prismatic.
- **Adapters own change detection**: No ingest-level stat cache. Each adapter knows its storage format.
- **PRAGMA user_version migrations**: Replace dual SCHEMA string + ad-hoc migrate().

## Key References

- `docs/ontology.md` — v2 data model spec (the source of truth)
- `docs/blueprint/` — 8 reviewed architectural blueprints (source of truth for v2 design)
- `docs/adapters/` — Per-tool storage investigations (Cursor, Codex)
- `docs/competitor-research.md` — Market analysis and OTEL conventions

## Known Issues (from review)

- **BUG-2**: Shared-DB change detection remains uneven outside Cursor. Cursor now uses adapter-owned signatures, but Kiro/Warp still need revalidation.
- **ARCH-7**: PID/runtime ownership is still duplicated across 5 places, not 4.
- **ARCH-10**: `as any` is mostly gone, but typed-intersection duck-typing still exists around heavy-adapter/store extensions and should be formalized instead of guessed by callers.
- **ARCH-12/13**: The old ingest-level stat cache is gone, but adapter-local caches and the durable discovery cache now form a multi-layer cache stack that still needs explicit lifecycle tests.

## Coding Conventions

- Runtime: Bun (not Node)
- Language: TypeScript strict
- Tests: `bun test` (Bun's built-in test runner)
- No `npm` or `node` commands — always `bun`
- Prefer editing existing files over creating new ones
- Adapter methods must be typed on the interface or on an explicit extension surface — no hidden duck-typed hooks
- Store migrations use PRAGMA user_version — no ad-hoc schema checks
- Sinks never run DDL — they push data only

## Investigation Conventions

When investigating how a tool stores conversation data:
- **Enumerate ALL tool types** — both leaf tools (read, grep, edit) and orchestration tools (spawn, task_v2, Task). They live in the same message stream but serve different purposes
- **Verify parent→child bidirectionally** — metadata arrays (subagentComposerIds) + spawn events in parent message stream + child session existence
- **Use the checklist** at `docs/adapters/INVESTIGATION_CHECKLIST.md` for new adapter investigations
- **Document per-platform paths** — macOS, Linux, Windows in every investigation doc

## Compound Engineering

This project uses compound engineering. Full pipeline: Office Hours → Brainstorm → Plan → Plan Review → Guard → Work → Review → Resolve → Compound. Not every task needs every phase — see `/lfg` for shortcuts by task type.

### Discovery & Framing
- `/office-hours` — Reframe fuzzy problems via 6 forcing questions. Use when unsure *what* to build.
- `/brainstorm` — Explore competing approaches. Use when unsure *how* to build.

### Planning
- `/plan` — Create implementation plan. Researches codebase, references roadmap, saves to `docs/plans/`.
- `/plan-product-review` — Strategic review: scope, value, timing, opportunity cost. Scores 1-5 across 4 dimensions.
- `/plan-arch-review` — Technical review: v2 compliance, risk, simplicity, test coverage. Scores 1-5 across 6 dimensions.

### Implementation
- `/work` — Execute an approved plan step by step with validation after each change.
- `/guard` — Safety mode for destructive operations (schema, IDs, sinks, PID files). Pause-and-confirm contract.
- `/investigate` — Structured debugging: reproduce → hypothesize → isolate → verify → fix.

### Quality
- `/review` — Launch 6 parallel domain-specific reviewers on changes.
- `/resolve` — Auto-fix review findings. P1 first, P2 second, P3 triaged with user.

### Learning
- `/compound` — Capture learnings via 4 parallel analysis agents. Saves to `docs/solutions/`, updates CLAUDE.md/agents.
- `/retro` — Periodic reflection across recent work. Scans git history, solutions, review findings for meta-patterns.

### Full Pipeline
- `/lfg` — Orchestrates all phases with gates. Skips phases based on task type.

### Review Agents (6, run in parallel by /review)
- `reviewer-pipeline` — Backpressure, change detection, delivery guarantees, resource budgets
- `reviewer-schema` — Type↔DDL sync, migration safety, upsert correctness, Postgres contract
- `reviewer-adapter` — Parsing accuracy, data completeness, ID stability, edge cases
- `reviewer-daemon` — PID management, signal handling, service integration, shutdown
- `reviewer-simplicity` — Dead code, over-engineering, YAGNI, readability
- `reviewer-migration` — ID determinism, data preservation, re-ingest correctness, rollback safety

### Directory Structure
- `docs/brainstorms/` — Exploration outputs from `/office-hours` and `/brainstorm`
- `docs/plans/` — Approved implementation plans from `/plan`
- `docs/solutions/` — Solved problems with YAML frontmatter from `/compound`

### Existing User-Level Skills (not project-specific)
- `/security-council` — 5-persona security review (Ex-Vercel, Ex-Supabase, Ex-Wiz, Ex-CyberArk, Ex-Google)
- `/tooling-council` — 5-persona tooling review (Ex-Datadog, Ex-Homebrew, Ex-Stripe CLI, Ex-ClickHouse, Ex-Vector)

@docs/ontology.md
