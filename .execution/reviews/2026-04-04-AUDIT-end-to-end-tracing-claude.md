# AUDIT: End-to-End Tracing (v2 pipeline)

**Date:** 2026-04-04
**Mode:** read-only audit
**Scope:** source discovery → adapter → pipeline/store → routing → sinks → daemon boundary → read/query surfaces
**Inputs reviewed:** `.execution/program.md`, `.execution/packets/W3-PRODUCT-01.md`, BP-02/07/08, `src/index.ts`, `src/commands/**`, `src/api/**`, `src/pipeline/**`, `src/routing.ts`, `src/sinks/**`, `src/adapters/**`, `src/store.ts`

---

## 1. End-to-End Path Summary

| Hop | File | Function / responsibility |
|---|---|---|
| Discovery | `src/pipeline/watcher.ts`, `src/pipeline/file-watcher.ts` | fs-watch with 500ms debounce; change → `ingest-adapter` work item |
| Coordinator | `src/pipeline/loop.ts` | serial drain of queue; per-adapter timeouts (find 60s, load 30s); RSS guards (200MB warn / 256MB hard) |
| Adapter dispatch | `src/pipeline/ingest.ts` (`ingestOne`, `ingestAll`) | calls adapter `findChanged(hint?)` → `loadConversation(ref)` per `src/contracts/adapters.ts` |
| Persist | `src/db/bundle.ts:writeBundle()` | atomic upsert `conversations` + `messages` + `tool_calls`; recomputes `_jin_sync` (bundle_hash, local_revision, ingested_at) |
| Gate | `loop.ts` | if `changed=true` → enqueue `push` work item (coalesced) |
| Route | `src/routing.ts:sinkIdsForConversation()` → `matchesRoute()` | glob match on remote/adapter/branch/name (AND within rule, union across matches); empty = no push |
| Push | `src/pipeline/push.ts:pushDirty()` | `conversationsNeedingPush(sink.id)` where `last_successful_revision < local_revision`; batches of 20 |
| Record | `src/db/sync.ts:recordPushResult()` | updates `_jin_push_state` per (conversation, sink) |
| Daemon | `src/commands/watch.ts`, `src/commands/start.ts` | PID at `~/.config/jin/jin.pid`; 15s graceful-shutdown flushes final ingest + push |
| Read | `src/commands/{show,sessions,search,status}.ts` + `src/db/query-surface.ts` | direct SQLite via `getStore()` singleton, daemon not required |
| API | `src/api/routes.ts` | `GET /api/sessions/:id`, `/overview`; control endpoints delegate to CLI (W2-DAEMON-02) |

---

## 2. Weakest Seams (ordered by impact)

1. **Push error history is single-slot** — `_jin_push_state.last_error` overwrites each attempt. No count of consecutive failures, no attempt log. Cannot answer "how many times and when did conv X fail to sink Y?"
2. **Routing mismatches are silent** — conversations matching zero routes are dropped with no log line and no surface in `jin status`. Misconfigured routes present as empty sink state.
3. **Reverse traceability missing** — `conversations.source_path` column exists in schema but `writeBundle()` never populates it from the adapter bundle. Cannot go store-row → source file.
4. **Adapter error → conversation correlation absent** — on `loadConversation` timeout/throw, the failing `ConversationRef` isn't included in the log; whole adapter cycle is skipped.
5. **Queue backlog invisible** — `loop.ts` tracks `currentWork`/queue internally; no `/api/queue-status` endpoint, no `jin status` field for backlog depth or oldest-item age.
6. **Consecutive adapter-failure disable not implemented** — BP-02 specifies 3-strike disable; absent from `loop.ts`. Already tracked on the scoreboard as BP-02's only remaining hardening follow-up.
7. **CLI exit-code loss at daemon boundary** — one-shot `jin ingest` push failures don't propagate to process exit code; breaks CI/scripting.
8. **Batch-level push detail collapsed** — `PushSummary` (`push.ts:122-126`) aggregates across batches and sinks; can't isolate which batch/sink failed in a mixed-result cycle.
9. **Orphan DAG prevention absent** — `writeBundle()` doesn't validate `parent_id` existence; orphans only detected post-hoc.
10. **Watcher path reconciliation unlogged** — `watcher.reconcile()` adds/removes watch paths without trace output.

---

## 3. Seam → File Mapping

| # | Files | Lines |
|---|---|---|
| 1 | `src/db/sync.ts` | 108–160 (`recordPushResult`) |
| 2 | `src/pipeline/push.ts`, `src/routing.ts` | push.ts:129–143 (null-filter drop) |
| 3 | `src/db/schema.ts` + `src/pipeline/ingest.ts` + `src/db/bundle.ts` | `source_path` column never written |
| 4 | `src/pipeline/ingest.ts` | 67–77, 108–119 (timeout/error paths) |
| 5 | `src/pipeline/loop.ts`, `src/pipeline/queue.ts`, `src/api/routes.ts` | loop.ts:44–119 |
| 6 | `src/pipeline/loop.ts` | 190–340 (noted deferred in `.execution/blueprints.md` BP-02) |
| 7 | `src/commands/watch.ts`, `src/commands/start.ts` | 24–100 |
| 8 | `src/pipeline/push.ts` | 46–126 |
| 9 | `src/db/bundle.ts` | `writeBundle` |
| 10 | `src/pipeline/watcher.ts` | `reconcile()` |

---

## 4. Product-Facing vs Internal Observability

**Product-facing** (users will ask / file bugs about):
- **#1 push error history** — "why isn't my conversation in Postgres?" is the canonical user question; last-error-only leaves them without a path forward.
- **#2 silent routing mismatches** — presents as "nothing is pushing" with no diagnostic.
- **#5 queue backlog** — "is jin caught up?" is a dashboard/status expectation.
- **#7 CLI exit codes** — user-visible via scripts/CI integration.

**Internal observability** (dev-facing, debug-time):
- **#3 reverse traceability** (store → source file) — needed to root-cause most adapter/ingest bugs.
- **#4 adapter error correlation** — operational logs for jin devs.
- **#6 consecutive-failure disable** — hardening; already tracked.
- **#8 batch-level push detail** — tuning signal.
- **#9 orphan prevention** — consistency check; user-visible symptom is opaque.
- **#10 watcher reconciliation logs** — adapter-toggle debugging.

---

## Priority Recommendation

For v2 hardening, address in order: **#1, #2, #3**.

- #1 and #2 are the two places a user's data can disappear from their view with no diagnostic. Both are modest scope: extend `_jin_push_state` with attempt count + last-attempted-revision; emit a "no route matched" counter per ingest cycle.
- #3 is the highest-leverage internal fix — populating `source_path` during `writeBundle` unlocks root-causing nearly every other class of bug on this list. The column already exists.
- #6 is already on the BP-02 follow-up list; no action here.
- #4, #8, #10 are log-quality fixes and can ride along with #3.

---

## Blueprint Drift

No new BP drift to record. The scoreboard at `.execution/blueprints.md` already captures:
- BP-02 consecutive-error tracking deferred (matches seam #6).
- BP-07 per-adapter/per-sink health detail deferred (related to seams #5, #6).
- BP-06 informational drift on push write semantics (adjacent to seam #1, but already noted).

The findings above are **observability gaps within aligned/mostly-aligned BPs**, not drift from the BP specs themselves. No scoreboard update warranted.
