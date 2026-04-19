---
title: "Durable Discovery Cache Instead of Persistent Discovery Workers"
status: implemented-with-followups
created: 2026-04-17
relates-to: [BP-02, BP-04, BP-10]
---

# Durable Discovery Cache Instead of Persistent Discovery Workers

## Status

This is no longer a greenfield proposal. The core design is landed:

- `SqliteDiscoveryCache` exists
- heavy adapters implement discovery cache import/export
- pipeline hydrate/persist wiring is in place
- `jin cache clear` and per-adapter cache status are in the CLI

The remaining work is narrower:

- fix adapter-specific cache lifecycle bugs
- harden invalidation signatures
- benchmark the current one-shot worker discovery path against an
  in-parent warm-cache path and keep only the cheaper one if results are
  equivalent

## Problem

Heavy-adapter startup discovery is still too expensive on fresh `jin start`.

Current facts:

- `findChanged({ kind: "startup-scan" })` is still the cold-start entrypoint
  for heavy adapters.
- Heavy adapters already keep useful lightweight discovery state in memory:
  - Claude Code: file index / size+mtime cache
  - Codex: file index / size+mtime cache
  - Cursor: layer signatures and parent maps
- That state is lost on full daemon restart.
- A fresh `jin start` therefore replays heavy discovery even when source files
  are unchanged.

One immediate fix is a persistent discovery worker that keeps adapter caches
alive for the lifetime of the daemon. That works technically, but it creates a
new long-lived subprocess class whose only job is preserving in-memory state.

That is not the right final architecture.

## Design Goal

Keep the good parts:

- adapters remain read-only
- pipeline owns execution policy
- heavy discovery can still run out-of-process
- adapter-local discovery state remains lightweight and adapter-specific

Avoid the bad parts:

- no additional forever-lived helper process just to hold cache
- no full-bundle or full-source persistence as "cache"
- no widening of the BP-04 adapter contract

## Decision

Use a **durable discovery cache** written after each heavy discovery pass.

That part is the architectural decision. The exact execution mode for heavy
`findChanged()` after the cache exists was initially left open:

- **Option A:** in-parent discovery with cache-hydrated state
- **Option B:** one-shot discovery worker that hydrates from cache, returns
  refs, persists updated state, and exits

The durable cache is still the core design. The runtime now uses one-shot
worker discovery for heavy adapters, but parent-vs-worker discovery remains a
measurement question rather than a permanent contract commitment.

This gives:

- warm discovery across daemon restarts
- no requirement for an extra long-lived discovery subprocess
- reuse of existing adapter-local discovery semantics

Current implementation:

- the landed path now uses **Option B** for heavy adapters:
  - parent loads durable cache state
  - parent sends cache state + `ChangeHint` to a one-shot discovery worker
  - worker runs `findChanged(hint)` and returns refs plus updated discovery
    state
  - parent persists the returned discovery state transactionally
- per-ref `loadConversation()` workers remain in place for heavy startup and
  periodic ingest

## Non-Goals

- Do not persist full `ConversationBundle`s.
- Do not persist full `ParsedMessage[]`, tool calls, or raw source payloads.
- Do not turn the pipeline into the owner of adapter-specific discovery logic.
- Do not widen BP-04 with a streaming or persistence-aware adapter method.

## Why This Is Better Than Persistent Discovery Workers

### Persistent discovery worker

Pros:

- simplest way to preserve adapter-local cache semantics within one daemon
  lifetime
- minimal serialization work

Cons:

- another long-lived process to debug
- no benefit across full restart
- crash/kill loses the cache anyway
- makes discovery performance depend on helper-process lifetime instead of
  durable state

### Durable discovery cache

Pros:

- survives restart
- no long-lived discovery worker required
- easier operational model: one request, one worker, one result
- cache durability is explicit and inspectable

Cons:

- requires cache schema, invalidation, and versioning
- each discovery execution must hydrate and persist state

This tradeoff is worth it. The startup replay problem is fundamentally a
**durability** problem, not a worker-lifetime problem.

## Architecture

### Ownership

- Parent pipeline owns:
  - when discovery runs
  - which adapters use discovery workers
  - config snapshot passed to the worker
  - cache DB path and invalidation policy
- Adapter owns:
  - discovery semantics
  - meaning of its lightweight cache structures

### Transport

Keep the same internal worker transport:

- JSON-RPC 2.0
- stdio
- `Content-Length` framing

No new IPC protocol is needed.

### Lifetime

For the landed path:

1. Parent hydrates adapter-specific discovery state from cache.
2. Parent sends cache state plus `ChangeHint` to a one-shot discovery worker.
3. Worker runs `findChanged(hint)` and returns refs plus updated discovery
   state.
4. Parent persists updated discovery state transactionally.
5. Parent schedules heavy `loadConversation()` work.

For heavy load:

- existing per-ref worker model remains unchanged

## Cache Shape

Use a separate SQLite DB under config dir, not the canonical conversation store.

Current file:

- `~/.config/jin/discovery-cache.db`

Reason:

- discovery cache is performance state, not source-of-truth data
- easier to wipe independently
- simpler corruption recovery story
- avoids mixing canonical store semantics with cache invalidation semantics

### Core tables

#### `adapter_cache_meta`

Tracks schema and adapter/config fingerprints.

Columns:

- `adapter_id`
- `config_fingerprint`
- `db_schema_version`
- `adapter_contract_version`
- `updated_at`

#### `adapter_source_state`

One row per scanned source unit.

Columns:

- `adapter_id`
- `config_fingerprint`
- `source_path`
- `source_kind`
- `size_bytes`
- `mtime_ms`
- `signature`
- `payload_version`
- `payload_json`
- `updated_at`

`payload_json` stores only lightweight adapter-specific discovery state, such
as:

- Claude: ref ids, segment ids, boundary metadata
- Codex: ref ids, segment ids, compacted segment ordering
- Cursor: layer signatures, parent-child composer map, snapshot signatures

`payload_json` is acceptable here because this is adapter-owned performance
cache, not canonical analytical data. The ontology preference for normalized
tables applies to source-of-truth structures we query and evolve across the
product surface. Discovery payloads are opaque, adapter-scoped, not
cross-queryable, and must remain easy to invalidate wholesale.

No messages, bundles, or raw source payloads belong here.

### Optional table

#### `adapter_run_state`

Only if needed for adapter-global state that is not keyed to a single source
path.

Examples:

- Cursor parent-child layer map
- future adapter-wide cursors

## Fingerprinting and Invalidation

### Config fingerprint

`config_fingerprint` must be concrete and automatic. It should be the hash of:

- `adapter_id`
- normalized adapter config fields that affect discovery semantics
- `adapter_contract_version`

`adapter_contract_version` is a declared integer on the heavy-adapter cache
extension. It is bumped when that adapter's discovery semantics or persisted
payload meaning changes.

This avoids vague "remember to bump some version later" guidance.

## Remaining Gaps

- Codex cache lifecycle must survive release hooks and fresh adapter recreation.
- Size-equal atomic replacement still needs a stronger invalidation signature.
- The heavy-adapter extension surface is real and should be documented in BP-04
  explicitly rather than inferred from implementation.
- The warm-cache benchmark still decides whether discovery workers are needed
  at all.

### Payload version

`payload_version` is independent of the DB schema version. It is adapter-owned
and lives alongside `payload_json` so a worker can reject stale payload shape
without discarding unrelated cache rows or the whole DB.

Cache rows must be scoped by:

- `adapter_id`
- adapter config fingerprint
- DB schema version
- adapter contract version
- payload version

Invalidate on:

- adapter config changes
- adapter contract version mismatch
- payload version mismatch
- missing/unreadable source path
- malformed persisted payload
- file mtime moving backward relative to cached state
- cache DB corruption or unreadable cache rows

Failure mode must always be:

- discard stale cache row
- do a bounded full discovery rescan

Never:

- return wrong refs from stale cache

### Adapter-specific signatures

Not every adapter should rely on size+mtime alone.

- Claude / Codex may use size+mtime plus adapter-local structural metadata
- Cursor and other SQLite-backed adapters should prefer adapter-derived
  signatures over raw file stat alone where practical

If an adapter cannot distinguish "same size, different content" from its file
stat data alone, it must treat the source as changed.

## Adapter Integration Model

Do **not** widen the public adapter contract.

Keep BP-04 as:

- `findChanged(hint?)`
- `loadConversation(ref)`

Instead, heavy adapters get an **optional heavy-adapter extension** inside
their owned implementation:

- `exportDiscoveryState(): JsonValue`
- `importDiscoveryState(state: JsonValue): void`
- `discoveryCacheContractVersion: number`

These are not part of the two-method BP-04 core surface, but they are still
real contract surface for heavy-adapter maintainers. They must be documented,
tested, and versioned like a contract.

Why:

- preserves the public adapter contract
- keeps adapter-specific cache semantics inside the adapter
- avoids making the pipeline understand cache payload structure
- makes resumability explicit instead of hand-wavy

## Safety Rules

### Write timing

Do not write cache only on process exit.

Persist after each successful discovery call.

Reason:

- crash-safe
- restart-safe
- worker can be short-lived
- no dependence on “clean exit” semantics

### Partial failure

If cache write fails:

- log the failure
- still return the fresh `ConversationRef[]` if discovery itself succeeded
- next run falls back to uncached discovery

Discovery correctness is more important than cache durability.

### Cache DB failure

If the cache DB cannot be opened or read:

- log once
- disable discovery-cache usage for the rest of that daemon lifetime
- continue with bounded uncached discovery

Do not retry opening a broken cache DB on every scan.

### Unreadable sources

If a source exists in cache but cannot be opened now:

- drop or invalidate that source row
- log at warning level if worth surfacing
- continue discovery

### Concurrency

If SQLite backs the discovery cache, use:

- WAL mode
- non-zero `busy_timeout`
- one short `BEGIN IMMEDIATE` transaction per cache write pass

No DB lock should be held across IPC or while adapter discovery code is still
running.

### Two-daemon assumption

The cache is designed for Jin's normal single-runtime-owner model. Two daemons
pointing at the same cache DB are out of scope and should be treated as an
operator/runtime-state bug, not a discovery-cache feature.

### Response after commit

If discovery state commits successfully but the worker dies before returning
its RPC response, the parent may retry and rediscover. That is acceptable as
long as cache writes are idempotent and correctness still degrades to bounded
duplicate discovery work, not wrong refs.

## Observability and Operator Surface

This cache cannot be silent.

Minimum required operator surface:

- `jin status` shows per-adapter discovery cache state:
  - enabled/disabled
  - last cache hit/miss counts
  - last invalidation reason
  - cache DB path
- one safe cache reset command:
  - `jin cache clear`
- startup and periodic diagnostics emit structured discovery counters such as:
  - `cached_sources`
  - `invalidated_sources`
  - `fresh_sources`
  - `cache_disabled_reason`

The first debugging tool should not be `rm`.

## Measurement Gate

Before committing to worker-backed discovery after the durable cache lands,
benchmark all three shapes:

1. current cold discovery baseline
2. durable cache + in-parent warm discovery
3. durable cache + one-shot worker discovery

If in-parent warm discovery stays comfortably within the BP-10 RSS budget, the
worker discovery path should be deleted rather than preserved as dead weight.

This proposal therefore does **not** assume worker discovery survives the
measurement phase.

## Expected Performance Outcome

### Continuous daemon runtime

Should remain good:

- unchanged-source discovery should become cheap regardless of process boundary
- parent should not need to retain large adapter-local discovery structures

### Fresh restart

Should materially improve:

- discovery worker restores lightweight prior state
- unchanged sources should not need full structural rebuild
- heavy startup scans stop looking like first-ever ingest every time

## Rollout Plan

1. Add discovery cache DB and schema.
2. Add cache observability surface (`jin status`, diagnostics, cache-clear).
3. Add adapter config fingerprinting and payload versioning.
4. Add heavy-adapter discovery-state import/export helpers plus versioned tests.
5. Benchmark:
   - durable cache + in-parent discovery
   - durable cache + one-shot worker discovery
6. Select discovery execution mode based on the benchmark.
7. Keep heavy `loadConversation()` worker path unchanged.
8. Validate:
   - fresh restart scan time
   - parent RSS during startup
   - cache invalidation on config change
   - cache DB failure fallback behavior

## Success Criteria

- heavy startup discovery after restart no longer replays all unchanged refs
- no additional forever-lived discovery subprocess is required
- parent RSS remains bounded during heavy startup discovery
- cache corruption or invalidation degrades to bounded full discovery, not
  wrong data
- fresh-restart heavy discovery target: `< 2s` on the representative warm-cache
  validation dataset
- steady-state cache hit rate target: `> 95%` on unchanged-source periodic
  scans
- discovery cache DB target size: `< 50 MB` on a representative long-lived
  workstation dataset

## Relationship To Disk-Backed Parent Writes

The end-state ingest win is:

- discovery cache hit
- no `loadConversation()`
- no parent staged write

This proposal and the disk-backed parent write-session proposal are
complementary:

- discovery cache avoids unnecessary ingest work entirely
- disk-backed staged writes keep necessary ingest bounded when a load is still
  required

## Alternative Considered: Long-Running Discovery Worker

A resident discovery subprocess that spawns once per daemon lifetime and
preserves adapter-local discovery state in memory is a valid alternative. It
solves a narrower problem and is explicitly rejected here, but the tradeoffs
are real and worth stating in full.

### Arguments for

- Smallest implementation delta from the current codebase. Adapter in-memory
  state (for example `fileIndexCache`) is reused as-is, with no schema.
- Directly fixes repeated `findChanged()` replay during a single daemon
  lifetime, which is the observed pain today.
- No cache schema, no fingerprinting, and no invalidation policy are required
  to ship.
- Keeps discovery hot across startup, periodic, and later periodic scans
  without any disk round-trip.
- Good fit if the problem is strictly "do not redo work while the daemon is
  already running."

### Arguments against

- Introduces another forever-lived subprocess category that has to be debugged,
  monitored, and reasoned about during shutdown, crashes, orphan cleanup,
  protocol drift, and stale-config reloads.
- Does not solve restart replay at all. Every `jin stop` / `jin start` still
  pays the full cold discovery cost.
- A crash or OOM-kill loses exactly the state the worker existed to preserve.
- Encourages a pattern where operational performance depends on helper
  lifetime rather than on durable state.
- Harder to introspect because there is no durable artifact on disk to inspect,
  wipe, or version.

### Why we are not choosing it

The cost of a resident helper is ongoing and paid by the next person who has
to debug daemon behavior. The cost of the durable cache is up-front and paid
once. The restart-replay bug, which the resident worker does not fix, is the
original motivation, so solving only the within-lifetime case does not close
the actual problem.

The resident-worker design may still exist as a short-term experiment before
durable cache lands, but it is not the target architecture.

## Related

- [disk-backed-parent-write-session.md](/Users/edenmendel/Documents/GitHub/jin/docs/proposals/disk-backed-parent-write-session.md)
- [durable-discovery-cache-review.md](/Users/edenmendel/Documents/GitHub/jin/docs/proposals/durable-discovery-cache-review.md)
- [BP-02-data-flow.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-02-data-flow.md)
- [BP-04-adapter-contract.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-04-adapter-contract.md)
