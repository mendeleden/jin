# Architecture Issues

Structural problems — responsibility confusion, coupling, wrong
abstractions. These aren't bugs (they don't produce wrong results today)
but make the codebase hard to maintain and extend.

---

## ARCH-1: Types and SQLite schema are independent (Q1)

Adding one field requires updating 6 places manually: TS interface, SQL
DDL, INSERT statement, ON CONFLICT clause, parameter list, row mapper.
No compile-time check they're in sync. The Postgres sink has its own
independent copy of all of this.

**v2 fix:** PRAGMA user_version migration array (Q9) eliminates the
dual schema/migrate system. Consider shared column definitions or tests
that verify schema matches types.

---

## ARCH-2: Schema as const string + ad-hoc migrate() (Q9)

Two competing schema systems: `const SCHEMA` (CREATE TABLE IF NOT EXISTS)
for fresh databases, `migrate()` (PRAGMA table_info checks) for existing
ones. They can drift. No version tracking.

**v2 fix:** Replace with PRAGMA user_version + sequential migration
function array. One system, one version number.

---

## ARCH-3: Store constructor does too much (Q10)

14 call sites each run full schema creation + migration. Read-only
commands (`jin sessions`, `jin show`) execute DDL. `status.ts` creates
two Store instances in one command.

**v2 fix:** Singleton getter. Separate `open()` from `migrate()`.
Migrations called explicitly by daemon/init/ingest only.

---

## ARCH-4: store.ts mixes 6 concerns in 816 lines (Q11)

Schema, writes, reads, push tracking, analytics, projects/tags/artifacts,
row mappers — all in one file. ~300 lines are v1 dead weight (projects,
tags, artifacts).

**v2 fix:** After removing dead code, ~400-500 lines remain. Split into
`src/db/` directory if still crowded, or keep as one file if coherent.

---

## ARCH-5: SinkConfig flat union bag (Q19)

All sink types share one interface with every field optional. No type
narrowing. `{ type: "s3", url: "http://..." }` compiles without error.

**v2 fix:** Discriminated union with `SinkConfigBase` + per-type
interfaces (`WebhookSinkConfig`, `PostgresSinkConfig`, `S3SinkConfig`).

---

## ARCH-6: postgres-search.ts runs DDL (Q18)

`ensureSearchSchema()` creates columns, indexes, triggers, functions,
and extensions on remote Postgres. Same violation as `ensureTables()`
in `postgres.ts`. Also duplicates the Postgres connection logic
(~60 lines shared between the two files).

**v2 fix:** Strip DDL. Extract shared `PostgresConnection` utility.
Search schema created by admin/Prismatic.

---

## ARCH-7: 4 PID file readers, confused lifecycle ownership (Q25)

`PID_FILE` declared in runguard.ts, lifecycle.ts, watch.ts, and
updater.ts. `isRunning()` in watch.ts duplicates `isDaemonRunning()`
in runguard.ts. `stopExistingDaemon()` in service.ts duplicates
`stopWatcher()` in lifecycle.ts (but weaker — no SIGKILL).

**v2 fix:** Merge runguard.ts + lifecycle.ts → `process-state.ts`.
Single PID_FILE, single stop implementation. Delete duplicates from
watch.ts, service.ts, updater.ts.

---

## ARCH-8: `jin start --service` is a verb collision (Q27)

"Start" and "install service" are different operations routed through
the same command. Two entry paths reach `serviceCommand("install")`:
`jin start --service` and `jin service install`.

**v2 fix:** Remove `--service` from `jin start`. Clean verb separation:
`jin start` = run now, `jin service install` = configure OS.

---

## ARCH-9: Execution-level cycles via process spawning (Q30)

Code imports are a DAG, but execution has cycles: `watchCommand` →
`daemonize()` → `Bun.spawn("jin start --foreground")` → re-enters
`index.ts` → `watchCommand`. Guard checks run 3x. Dynamic imports
paper over what would be circular static dependencies.

**v2 fix:** `startCommand` owns all guards. `watchCommand` trusts
env vars set by parent (`JIN_DAEMON`, `JIN_LAUNCHED_BY_SERVICE`).

---

## ARCH-10: `newMessages` duck-typed via `as any` (Q31)

Optional adapter method not in the `Adapter` interface. Called via
`'newMessages' in adapter` runtime check + `(adapter as any)` cast.
No compile-time safety. Only Claude Code implements it.

**v2 fix:** Either add to Adapter interface as typed optional method,
or move delta logic into adapter-internal concern (adapter caches
its own state, `messages()` handles optimization internally).

---

## ARCH-11: watchCommand does 8 jobs in 576 lines (Q33)

Guards, setup, initial ingest, file watcher, background loops,
shutdown, daemonize, ingest functions + PID logic — all in one file.

**v2 fix:** Move guards to startCommand. Move daemonize + PID to
process-state.ts. Extract ingest functions to `src/ingest.ts`.
Result: ~200 lines — setup → ingest → watch → periodic → shutdown.

---

## ARCH-12: Two competing caches at wrong abstraction levels (Q34)

Claude Code's `fileCache` (adapter-level) and `ingestStatCache`
(ingest-level in watch.ts) both check file stat to skip unchanged
files. They overlap for Claude Code (double-checking) and the
ingest-level cache breaks for shared-DB adapters.

**v2 fix:** Delete `ingestStatCache`. Adapters own their own change
detection. `conversations()` returns only changed conversations.
Ingest layer has no cache.

---

## ARCH-13: `ingestSingleFile` assumes one file = one session (Q34)

Watcher's `onChange` calls `ingestSingleFile(adapter, store, filePath)`
which maps one file path to one session. Breaks for shared-DB adapters
where one file contains 65+ sessions.

**v2 fix:** Drop `ingestSingleFile`. On file change, call
`adapter.conversations()` — adapter decides what changed.
