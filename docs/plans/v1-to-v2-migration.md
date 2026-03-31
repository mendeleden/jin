---
title: Jin v1 → v2 Migration Plan
phase: 0-7 (full migration)
status: draft
created: 2026-03-28
---

# Jin v1 → v2 Migration Plan

## Context

This branch (`feat/rewrite-ontology`) produced 56 new documentation files:
- v2 data model spec (`docs/ontology.md`)
- 34 code review findings across `docs/review/` (7 bugs, 13 architecture issues, 9 dead code items, 10 design decisions)
- 7-phase roadmap (`docs/v2-roadmap.md`)
- 50-file code syllabus (`docs/code-syllabus.md`)
- Cursor 4-layer investigation + Windows cross-platform verification
- Codex 7-layer investigation
- Compound engineering setup (6 agents, 13 skills, 2 rules)

The codebase is ~12,900 lines across 50 files. v2 requires rewriting ~60% of it. Migration strategy: **nuclear fresh start** — drop all existing data, create v2 schema, re-ingest from source files on disk.

## Approach

Execute in 7 phases with strict dependency ordering. Phase 0 (types/schema/config) is the foundation everything else depends on. Phases 1-2 (infrastructure/sinks) can partially overlap. Phase 3 (adapters) is the largest phase. Phases 4-7 are cleanup.

**Critical path:** Types → Store → Adapters → Ingest → CLI

---

## Priority Order (What to Do First)

### Tier 1: Foundation (must complete before anything else)

| # | Task | Phase | Why First | Risk | Files |
|---|------|-------|-----------|------|-------|
| 1 | **Rename Session → Conversation in types.ts** | 0.1 | Every other file depends on these interfaces | Low | `src/adapters/types.ts` |
| 2 | **Add ToolCall interface** | 0.1 | Needed by store, sinks, and all adapters | Low | `src/adapters/types.ts` |
| 3 | **SinkConfig → discriminated union** | 0.1 | Needed before sink rewrites | Low | `src/sinks/types.ts` |
| 4 | **Rewrite store.ts with PRAGMA user_version** | 0.2 | Every command depends on the store | **High** | `src/store.ts` |
| 5 | **Clean config.ts** | 0.3 | RouteMatch, drop dead fields | Low | `src/config.ts` |

### Tier 2: Infrastructure cleanup (unblocks clean adapter/ingest work)

| # | Task | Phase | Why Second | Risk | Files |
|---|------|-------|------------|------|-------|
| 6 | **Merge runguard + lifecycle → process-state.ts** | 1.1 | Single PID_FILE, single stop. Unblocks watch.ts refactor | Med | `src/runguard.ts`, `src/lifecycle.ts` → `src/process-state.ts` |
| 7 | **Delete TUI** | 1.5 | 500 lines of dead code, 6 files | Low | `src/tui/` (delete) |
| 8 | **Clean start.ts** | 1.2 | Remove --service, guards live here only | Low | `src/commands/start.ts` |
| 9 | **Extract ingest.ts from watch.ts** | 1.3 | Unblocks adapter work — clean separation of ingest from daemon | Med | `src/commands/watch.ts` → `src/ingest.ts` |
| 10 | **Delete tagger.ts** | 4.2 | 198 lines of dead code, replaced by adapter columns | Low | `src/tagger.ts` (delete) |

### Tier 3: Sinks (can overlap with Tier 2)

| # | Task | Phase | Why Third | Risk | Files |
|---|------|-------|-----------|------|-------|
| 11 | **Strip DDL from postgres.ts** | 2.1 | Remove ensureTables(), add schema version handshake | Med | `src/sinks/postgres.ts` |
| 12 | **Strip DDL from postgres-search.ts** | 2.2 | Same violation, extract shared connection logic | Med | `src/sinks/postgres-search.ts` |
| 13 | **Add toolCalls to webhook + S3** | 2.3 | PushPayload shape change | Low | `src/sinks/webhook.ts`, `src/sinks/s3.ts` |
| 14 | **New `jin schema apply` command** | 2.4 | Admin-only DDL runner | Low | `src/commands/schema.ts` (new) |

### Tier 4: Adapters (largest phase, depends on Tiers 1-2)

| # | Task | Phase | Why Fourth | Risk | Files |
|---|------|-------|------------|------|-------|
| 15 | **Claude Code adapter → v2** | 3.1 | Most complete adapter, best test case | Med | `src/adapters/claude-code.ts` |
| 16 | **Codex adapter → v2** | 3.2 | Second most complete, needs sub-agent capture | Med | `src/adapters/codex.ts` |
| 17 | **Cursor adapter → multi-layer rewrite** | 3.3 | Biggest rewrite — Layer 1 primary, Layer 2 supplement, Layer 3 fallback | **High** | `src/adapters/cursor.ts` |
| 18 | **Simple adapters → v2** | 3.4 | 7 adapters, straightforward renames | Low | `src/adapters/amp.ts`, `gemini.ts`, `kiro.ts`, `opencode.ts`, `pi.ts`, `piagent.ts`, `warp.ts` |

### Tier 5: Pipeline + CLI (depends on adapters)

| # | Task | Phase | Why Fifth | Risk | Files |
|---|------|-------|-----------|------|-------|
| 19 | **Routing: glob matching + AND semantics** | 4.1 | Fixes BUG-1, unblocks real routing | Med | `src/routing.ts` |
| 20 | **Ingest refactor: drop ingestSingleFile** | 4.3 | Fixes BUG-2, ARCH-12, ARCH-13 | Med | `src/ingest.ts` |
| 21 | **CLI command renames** | 5.1 | sessions → conversations, add --trace/--tree | Low | `src/commands/*.ts`, `src/index.ts` |
| 22 | **API route updates** | 5.2 | v2 table/column names | Low | `src/api/routes.ts` |

### Tier 6: Coordination + Misc

| # | Task | Phase | Why Last | Risk | Files |
|---|------|-------|----------|------|-------|
| 23 | **Prismatic schema migration** | 6 | Requires Prismatic team coordination | **High** | External repo |
| 24 | **External pricing.json** | 7 | Nice-to-have, not blocking | Low | `src/pricing.ts` |
| 25 | **Windows isServiceActive fix** | 7 | BUG-5, low severity | Low | `src/runguard.ts` (or process-state.ts by then) |

---

## Bug Fix Priority

| Bug | Severity | When to Fix | Reason |
|-----|----------|-------------|--------|
| BUG-1 | High | Phase 4.1 (routing rewrite) | Route matching is completely non-functional with globs. Fixed as part of routing rewrite. |
| BUG-2 | High | Phase 4.3 (ingest refactor) | Shared-DB stat cache breaks 3 adapters. Fixed by deleting ingestStatCache, adapters own change detection. |
| BUG-3 | Medium | Phase 0.2 (store rewrite) | insertMessages missing record_type. Fixed by deleting insertMessages, always use upsert. |
| BUG-4 | Medium | Phase 4.3 (ingest refactor) | newMessages afterIndex semantics wrong. Fixed by moving delta logic into adapters. |
| BUG-5 | Medium | Phase 7 | Windows locale in isServiceActive. Deferred — not blocking v2. |
| BUG-6 | Low | Phase 7 | Config file write race. Accept or implement daemon-owns-writes. |
| BUG-7 | Low | Phase 1.2 (start cleanup) | Redundant guard checks. Fixed by guards-only-in-startCommand. |

---

## Dead Code Deletion Schedule

| ID | What | Lines | When to Delete | Depends On |
|----|------|-------|---------------|------------|
| DEAD-7 | TUI (`src/tui/`, 6 files) | ~500 | Phase 1.5 (early, no dependencies) | Nothing |
| DEAD-6 | Tag infrastructure (tagger.ts + store methods) | ~250 | Phase 0.2 (store rewrite) + Phase 4.2 (tagger deletion) | Store rewrite first |
| DEAD-5 | Project infrastructure (store methods + tables) | ~130 | Phase 0.2 (store rewrite) | Store rewrite |
| DEAD-3 | self-observation.ts | ~30 | Phase 1.3 (watch refactor) | Inline into watch.ts |
| DEAD-4 | unpushedSessions | ~10 | Phase 0.2 (store rewrite) | Store rewrite |
| DEAD-9 | Duplicate isRunning/PID_FILE in watch.ts | ~15 | Phase 1.1 (process-state merge) | process-state.ts |
| DEAD-8 | stopExistingDaemon in service.ts | ~20 | Phase 1.4 (service cleanup) | process-state.ts |
| DEAD-1 | rawDir config | ~10 | Phase 0.3 (config cleanup) | Nothing |
| DEAD-2 | syncMode/syncIntervalMs | ~5 | Phase 0.3 (config cleanup) | Nothing |

**Total removable: ~785 lines** (before any new code is written)

---

## Architecture Issue Resolution Map

| ID | Issue | Resolution Phase | How |
|----|-------|-----------------|-----|
| ARCH-1 | Types/SQLite schema independent | 0.1 + 0.2 | Rewrite both in sequence, test sync |
| ARCH-2 | Dual SCHEMA + migrate() | 0.2 | Replace with PRAGMA user_version array |
| ARCH-3 | Store constructor does too much | 0.2 | Singleton getStore(), separate open/migrate |
| ARCH-4 | store.ts mixes 6 concerns | 0.2 | Delete dead code → ~400 lines, evaluate split |
| ARCH-5 | SinkConfig flat bag | 0.1 | Discriminated union |
| ARCH-6 | postgres-search runs DDL | 2.2 | Strip DDL, extract shared connection |
| ARCH-7 | 4 PID file readers | 1.1 | Merge → process-state.ts |
| ARCH-8 | --service verb collision | 1.2 | Remove --service from jin start |
| ARCH-9 | Execution-level cycles | 1.2 + 1.3 | Guards in startCommand only, env vars |
| ARCH-10 | newMessages duck-typed | 4.3 | Move delta logic into adapters internally |
| ARCH-11 | watch.ts 8 jobs | 1.3 | Extract ingest.ts, process-state.ts, ~200 lines |
| ARCH-12 | Two competing caches | 4.3 | Delete ingestStatCache, adapters own detection |
| ARCH-13 | ingestSingleFile 1:1 assumption | 4.3 | Drop function, adapter.conversations() decides |

---

## Implementation Sequence (Recommended Order)

### Sprint 1: Foundation (Phase 0)

**Goal:** v2 types compile, v2 store works, tests pass.

1. **types.ts** — Rename Session→Conversation, add ToolCall, update Message, update Adapter interface, SinkConfig union
2. **store.ts** — Full rewrite: v2 schema, PRAGMA migrations, singleton, delete dead methods
3. **config.ts** — Drop dead fields, update RouteMatch
4. **Fix all callers** — Every file that imports Session/Store/Config must update
5. Validate: `bun run typecheck` + `bun test`

### Sprint 2: Cleanup (Phase 1)

**Goal:** Process lifecycle is clean, dead code removed.

1. **Delete TUI** (Phase 1.5) — quick win, 500 lines gone
2. **Merge process-state.ts** (Phase 1.1) — single PID, single stop
3. **Clean start.ts** (Phase 1.2) — remove --service, guards here only
4. **Extract ingest.ts** (Phase 1.3) — separate ingest from daemon loop
5. **Clean service.ts** (Phase 1.4) — delete stopExistingDaemon
6. Validate: `bun run typecheck` + `bun test` + manual `jin start`/`jin stop`

### Sprint 3: Sinks (Phase 2)

**Goal:** Postgres is INSERT-only, schema handshake works.

1. **Strip DDL from postgres.ts** — delete ensureTables, add version check
2. **Strip DDL from postgres-search.ts** — extract shared connection
3. **Add toolCalls to webhook + S3** — payload shape change
4. **New jin schema apply** — admin DDL command
5. Validate: `bun test:integration` (docker compose postgres)

### Sprint 4: Adapters (Phase 3) — Largest Phase

**Goal:** All adapters produce v2 Conversations.

1. **Claude Code** — Gold standard, test compaction splitting + sub-agents + tool_calls
2. **Codex** — Second most complex, add sub-agent capture
3. **Simple adapters** (7) — Straightforward renames, add gitRemote/branch
4. **Cursor** — Last because most complex rewrite (Layer 1 primary)
5. Validate: per-adapter test suites with real fixtures

### Sprint 5: Pipeline + CLI (Phases 4-5)

**Goal:** End-to-end flow works with v2 data.

1. **Routing rewrite** — glob matching, AND semantics, delete project joins
2. **Delete tagger.ts** — all its callers removed by now
3. **Ingest refactor** — drop ingestSingleFile, adapters own change detection
4. **CLI renames** — sessions→conversations, add --trace/--tree
5. **API route updates** — v2 table/column names
6. Validate: full manual test (`jin start` → ingest → push → `jin conversations`)

### Sprint 6: Coordination (Phase 6)

**Goal:** Prismatic reads v2 data.

1. Prismatic migration (external team coordination)
2. Deploy sequence: Prismatic schema → jin binary → daemon restart → re-ingest → push
3. Validate: Prismatic dashboard shows v2 data

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Store rewrite breaks everything** | All commands fail | Write v2 schema alongside v1, switch atomically. Test with real 800-session store.db. |
| **Deterministic IDs change on re-ingest** | Push log invalidated, sink duplicates | Test: ingest same file twice, assert same IDs. Use `/guard` during implementation. |
| **Cursor Layer 1 has undocumented fields** | Adapter misses data | Windows investigation already found corrections (thinking, toolFormerData.result). Cross-platform verification underway. |
| **Codex sub-agents undocumented** | Adapter incomplete | Investigation doc exists but needs deeper dive into agent_jobs table. |
| **Prismatic schema coordination** | v2 push fails | Jin pauses pushes on schema mismatch. Prismatic migration runs first. |
| **Type rename breaks 50+ files** | Massive commit | Do it in one pass with find-and-replace, then fix compilation errors. Don't split across commits. |

## Validation

- [ ] `bun run typecheck` passes after each phase
- [ ] `bun test` passes after each phase
- [ ] `bun test:integration` passes after Phase 2
- [ ] Manual `jin start` → `jin conversations` works after Phase 5
- [ ] Re-ingest produces identical IDs (test before Phase 3)

## Open Questions

1. **Cursor Windows findings** — `toolFormerData.result` and `thinking` field corrections: were these absent on macOS or just not checked? Need to verify before updating the orchestration doc. Investigation in progress.
2. **Codex agent_jobs table** — How do sub-agents link to parent sessions? Investigation doc exists but needs hands-on verification.
3. **PENDING-1** — Per-message model availability: verified for Codex (turn_context.payload.model), still need Claude Code and Cursor verification.
4. **Prismatic timeline** — When can Prismatic run v2 schema migration? This gates Phase 6.
