---
title: "Review Findings — Code Reality vs Durable Discovery Cache Proposal"
status: findings
created: 2026-04-17
companion-to: durable-discovery-cache-review.md
---

# Review Findings

Five independent reviewers explored the codebase against the durable
discovery cache proposal and my earlier design review. Findings are
consolidated here with concrete `file:line` citations.

## Headline: The Proposal Lags The Code

**My earlier review assumed the current state was "persistent discovery
worker landed, durable cache not yet started." That framing is wrong.**

What is actually in the tree today:

1. **The "persistent" discovery worker is not persistent.** It is already
   one-shot per ref — `Bun.spawn` at the top of every
   `ingestConversationViaWorker` call, stdin EOF at the end.
   (`src/pipeline/ingest-worker.ts:240–245, 373`)

2. **Discovery cache contract is landed in adapters.**
   `exportDiscoveryState` / `importDiscoveryState` /
   `discoveryCacheContractVersion` exist as an opt-in extension
   (`src/adapters/discovery-cache.ts:23–28`) and are implemented by
   Claude Code, Codex, and Cursor.

3. **A durable discovery cache DB already exists.**
   `src/db/discovery-cache.ts` — SQLite, WAL mode (line 82),
   `busy_timeout` (line 83), `payload_version` column (line 19),
   `adapter_contract_version` (line 18), config fingerprint
   (`discoveryConfigFingerprint`, line 143).

4. **Disk-backed parent write session is already landed.**
   `src/db/write-session.ts:49,111,182,202` implements
   `StagedConversationWriteSession`. Staging tables `_jin_stage_*` exist
   in migration v2 (`src/db/schema.ts:136–176`). The
   `disk-backed-parent-write-session.md` proposal describes as future
   work something the code already does.

5. **Observability surface partially exists.** `jin status`
   (`src/commands/status.ts:196–217`) already prints
   `cached_sources` / `fresh_sources` / `invalidated_sources` per
   adapter. `jin cache clear` exists (`src/commands/cache.ts`).
   `DiagnosticLogger.discoveryResult()` already logs cache outcome to
   JSONL (`src/pipeline/diagnostic.ts:115–137`).

**So most of what my review asked for — fingerprinting, payload
versioning, SQLite concurrency, cache-clear command, per-adapter status
— is already built.** What is missing is narrower:

- A human-readable startup log line summarizing cache hit/miss per
  adapter.
- Documentation in BP-04 of the optional heavy-adapter extension
  surface.
- The proposals and `CLAUDE.md` need to be updated to reflect reality.

That is a much smaller ask than the review implied. The proposal
document should be rewritten as "close the gap" rather than "greenfield
design."

---

## P1 — Real Bugs

### P1-1. `releaseDiscoveryMemory` contract violation in Codex

`src/adapters/codex.ts:221` clears `fileIndexCache` entirely. Claude
Code's equivalent (`src/adapters/claude-code.ts:455–458`) correctly
keeps the lightweight index and drops only the heavy `loadedFileCache`.

**Consequence:** if the pipeline calls `releaseDiscoveryMemory` between
an `exportDiscoveryState` and the next scan (or before `exportDiscoveryState`
if the ordering changes), Codex exports empty state and re-parses
everything on the next run. The durable cache becomes useless for
Codex under exactly the memory-pressure conditions it was designed for.

**Fix:** align Codex's `releaseDiscoveryMemory` with Claude Code's —
drop only heavy loaded-bundle state, preserve `fileIndexCache` and
`statCache`.

### P1-2. Size-equal, content-different blind spot

All three heavy adapters treat `(size, mtimeMs)` as the file identity.
- `src/adapters/claude-code.ts:391–395`
- `src/adapters/codex.ts:382`
- `src/adapters/cursor.ts:352` (`"id:mtimeMs:size"` signature)

An atomic replace that lands in the same mtime-second with the same
byte count is silently treated as unchanged. Reviewer A confirms this
is real for all three heavy adapters. Low frequency, but the durable
cache extends the window in which this matters from "one scan" to
"forever, until size changes."

**Fix:** add a content hash (first-N-bytes + last-N-bytes, or full
xxhash for small files) as the invalidation tiebreaker. Small addition
to the signature payload.

### P1-3. Duck-typed adapter extensions everywhere — ARCH-10 is not fixed

`CLAUDE.md` says the rule is "Adapter methods must be typed on the
Adapter interface — no duck-typing via `as any`." The `as any` is
gone. Typed-intersection duck-typing has replaced it and is pervasive:

- `src/pipeline/ingest.ts:565–568` — `adapter as Adapter & { releaseTransientMemory?() }`
- `src/pipeline/ingest.ts:565–568` — `adapter as Adapter & { releaseDiscoveryMemory?() }`
- `src/pipeline/ingest-worker.ts:511–517` — `created as typeof created & { loadConversation?, releaseTransientMemory?, releaseDiscoveryMemory? }`
- `src/adapters/discovery-cache.ts:32–33` — `adapter as Adapter & Partial<DiscoveryCacheCapableAdapter>`
- `src/pipeline/ingest.ts:445–466` — `ConversationStore & { database?: { prepare? } }` (probes SQLite internals)

**This is the ARCH-10 pattern.** The interface doesn't declare the
method; callers guess-and-cast. The violation isn't syntactic (no
`as any`); it's structural.

**Fix:** declare these as optional methods on the BP-04 `Adapter`
interface, or add a formal `HeavyAdapter extends Adapter` extension.
For the store, expose `ConversationStore.hasLocalData()` rather than
probing `.database?.prepare`.

### P1-4. Shutdown drain timeout orphans in-flight workers

`src/commands/watch.ts:216–246` + `src/pipeline/loop.ts:400–418`:
shutdown waits up to `shutdownDrainTimeoutMs`, then
`performShutdown` returns `timedOut: true` and watch calls
`process.exit(1)`. **There is no `subprocess.kill()` in the timeout
branch.** An in-flight worker becomes an orphan Bun process that will
eventually exit when stdin closes, but on slow machines this is tens
of seconds of orphan lifetime after daemon exit.

**Fix:** on timeout, explicitly kill all in-flight worker subprocesses
before `process.exit`.

### P1-5. `hadLoadFailure` suppresses cache persistence after partial success

`src/pipeline/ingest.ts:196–215, 242`: if any ref in a batch fails to
load, `persistAdapterDiscoveryState` is skipped for the whole batch.
Successfully loaded refs earlier in the batch have their store rows
written, but the discovery cache is not updated — so on next startup
those same refs will be re-scanned.

**Fix:** persist partial discovery state for refs that succeeded; or
track a per-ref "discovered but not loaded" vs "discovered and
loaded" distinction in the cache.

---

## P2 — Design Smells

### P2-1. The worker path is dead on fs-change — the common case

`src/pipeline/ingest.ts:328–330` — `resolveWorkerIngestSnapshot`
returns `null` when the hint is missing or `kind === "fs-change"`.
The worker only fires on `periodic-scan` and `startup-scan`. But
periodic and startup scans are exactly what the durable cache will
make cheap.

**Implication:** once the cache is warm, the worker has nothing to do.
Reviewer C's suspicion is confirmed by code inspection. The honest
post-cache architecture is:

- discovery runs in the parent (cheap, cache-hydrated)
- load runs in a worker only when actually loading something heavy
- the current "worker for periodic discovery" path can be deleted

Before shipping more worker plumbing, benchmark the warm-cache
in-parent path and decide if the worker survives at all.

### P2-2. Four hardcoded `["claude-code", "codex", "cursor"]` sets

- `src/pipeline/ingest.ts:66` — `WORKER_INGEST_ADAPTERS`
- `src/pipeline/ingest.ts:67` — `DISCOVERY_CACHE_ADAPTERS`
- `src/pipeline/ingest.ts:540–546` — `needsSingleRefIngestBatch`
- `src/pipeline/ingest.ts:548–554` — `needsAggressiveBatchReclaim`

Identical membership, four places. Adding a heavy adapter requires
four synchronized edits.

**Fix:** one `HEAVY_ADAPTERS` set, or better, a capability flag
exposed by the adapter itself.

### P2-3. No max frame size on JSON-RPC parent read

`src/pipeline/ingest-worker.ts:771` — `parseContentLength` accepts
any integer. A misbehaving worker or corrupt pipe could return
`Content-Length: 1073741824` and the read loop buffers indefinitely.
Real OOM risk.

**Fix:** cap at e.g. 64 MB. Any legitimate conversation frame is
orders of magnitude smaller.

### P2-4. No parent-side handshake timeout by default

`src/pipeline/ingest-worker.ts:438` — `timeoutMs > 0` guard; default
is `0`. A worker that hangs before writing its first byte leaves the
parent waiting forever on `initialize`.

**Fix:** always apply a handshake timeout (5–10s), separate from the
overall work timeout.

### P2-5. Codex `statCache` is a redundant parallel map

`src/adapters/codex.ts:102–103` — `statCache` and `fileIndexCache`
both hold `{size, mtimeMs}` per path. They are kept in sync but
`statCache` is dead weight; a single map would do.

### P2-6. Cursor `collectLayer1Changes` non-atomic map replacement

`src/adapters/cursor.ts:339–340` — `layer1Signatures` is replaced
before `buildLayer1ParentMap` runs. If `buildLayer1ParentMap` threw
(it currently can't in practice), the two maps would be
out-of-sync. Fragile, not broken.

### P2-7. `reclaimProcessMemory` is dead code

`src/pipeline/ingest.ts:607–613` — defined, no callers. Its siblings
`reclaimAdapterBoundaryMemory` and `reclaimAdapterBatchMemory` are
used.

**Fix:** delete.

### P2-8. `normalizeConfig` silently drops v1 fields

`src/config.ts:206–218` — normalizes only four keys. `team`,
`store`, `defaultSinks`, `routeUnmatchedToAll` are in the `JinConfig`
type but discarded on save. Either wire them or delete them from the
type.

### P2-9. DEAD-1 / DEAD-2 still present

`src/config.ts:59–70`:
- `StoreConfig.rawDir` — unread (DEAD-1)
- `TeamConfig.syncMode` / `syncIntervalMs` — unread (DEAD-2)

Remnants from v1. Delete.

### P2-10. Legacy v1 methods on `ClaudeCodeAdapter`

`src/adapters/claude-code.ts:532–574` — `sessions()`, `sessionForFile()`,
`messages()`, `newMessages()`, `artifacts()`. Not on BP-04, not called
from ingest. ~90 lines of `artifacts()` alone. If a v1 command path
still uses them, it should be removed alongside the v1 cleanup.

---

## P3 — Doc Drift Against Code

### P3-1. `CLAUDE.md` "Known Issues" is stale

- **BUG-1** (route matching string equality): **fixed.**
  `src/routing.ts:81–95` uses `globToRegExp`. Remove from list.
- **BUG-2** (Shared-DB stat cache broken for Cursor/Kiro/Warp):
  **fixed for Cursor** via content-based signatures
  (`cursor.ts:98–100`). Kiro/Warp unchecked.
- **ARCH-7** (PID file in 4 places): **worse than documented.**
  Five locations: `src/updater.ts:10`, `src/daemon/runtime-state.ts:19`,
  `src/daemon/daemonize.ts:5`, `src/daemon/process-state.ts:17`,
  `src/commands/watch.ts:477–478`.
- **ARCH-10** (`newMessages`/`sessionForFile` duck-typed via `as any`):
  **language is outdated.** No `as any` remains, but typed-intersection
  duck-typing is pervasive (see P1-3).
- **ARCH-12/13** (two competing caches, 1:1 file:session):
  **substantially fixed.** `ingestSingleFile` is gone. But the
  durable cache now adds a third layer that must agree with the
  adapter-local caches, and reconciliation is manual
  (`ingest.ts:411–433`).

**Action:** rewrite the `CLAUDE.md` Known Issues section. Three of
five are stale or wrong.

### P3-2. Durable discovery cache proposal describes partially-landed work

The proposal reads as greenfield. The code has:

- `DiscoveryCacheState`, `DiscoveryCacheCapableAdapter` interfaces
  (`src/adapters/discovery-cache.ts:23–28`)
- `exportDiscoveryState` / `importDiscoveryState` implemented in all
  three heavy adapters
- `SqliteDiscoveryCache` with WAL, busy_timeout, payload_version,
  config fingerprint (`src/db/discovery-cache.ts`)
- `jin cache clear` and `jin status` cache display

**Action:** rewrite the proposal as "land the remaining gaps" — the
doc is closer to a migration README than an architecture decision.

### P3-3. `disk-backed-parent-write-session.md` describes landed work

The proposal describes the implementation as future. The code has
`_jin_stage_sessions`, `_jin_stage_messages`, `_jin_stage_tool_calls`
and the staged write session today (`src/db/schema.ts:136–176`,
`src/db/write-session.ts`).

**Action:** close the proposal as "landed" and move the remaining
decision-gate content into a retrospective or into `CLAUDE.md`.

### P3-4. BP-04 does not document the heavy-adapter extension

`DiscoveryCacheCapableAdapter` is a real contract surface that
adapter authors need to know about. BP-04 currently lists only
`findChanged` / `loadConversation` / `detect` / `watchPaths`.

**Action:** add a "Heavy Adapter Extensions" section to BP-04
documenting `exportDiscoveryState`, `importDiscoveryState`,
`discoveryCacheContractVersion`, `releaseDiscoveryMemory`,
`releaseTransientMemory`.

### P3-5. `docs/worker-ingest-flow-guide.md` is accurate

No drift found.

### P3-6. Ontology §7.1 schema matches code

No drift found.

---

## Updated Verdict On The Proposal

**Original verdict:** "Direction approved, implementation not ready to
land."

**Revised verdict:** **Direction is correct AND most of it is already
implemented.** The proposal and my review together overstated the
amount of net-new work. The real outstanding items are:

1. Fix `releaseDiscoveryMemory` inconsistency in Codex (P1-1).
2. Add a content-hash fallback for size-equal atomic replace (P1-2).
3. Promote the duck-typed methods to a proper `HeavyAdapter`
   extension interface (P1-3).
4. Kill in-flight workers on shutdown timeout (P1-4).
5. Persist partial discovery state on partial batch failure (P1-5).
6. Decide whether the worker path survives once cache is warm
   (P2-1). Benchmark first.
7. Update the two proposal docs to reflect landed reality; rewrite
   `CLAUDE.md` Known Issues.

Items 1–5 are concrete bug fixes, not architecture. Item 6 is the one
real remaining architecture question. Item 7 is documentation
hygiene.

**What this means for the "long-running discovery worker" question
the user raised:** moot. The worker is already one-shot per ref. The
real question is whether *any* worker is needed for discovery
post-cache, or whether discovery collapses into the parent and the
worker becomes a load-only concern.

---

## Addendum — Empirical Verification (Live Daemon)

After writing the above, I ran three more reviewers
(schema / daemon / migration) and did an empirical check against a
live `jin start --foreground` daemon (PID 15268, ~95% CPU at
observation time). The empirical check materially reframes the
problem.

### Empirical-1. Cache IS populated and IS being read (proposal is landed)

`~/.config/jin/discovery-cache.db` — 1 MB main + 3 MB WAL, actively
written.

```
SELECT adapter_id, COUNT(*) FROM adapter_source_state GROUP BY 1;
  claude-code  908
  codex        193
  cursor         7
```

Recent `discovery:result` events for all three heavy adapters show
`cachedSources=N, invalidatedSources=0, freshSources=0`. **The cache
is working.** Startup is not re-parsing unchanged files. The symptom
the user reported ("I see all refs processed each time") is almost
certainly **not** a cache miss — it's something else (see next finding).

### Empirical-2. P0 — Cursor is in a runaway fs-change loop

Event count over ~30s window of `debug.jsonl`:

```
cursor       226
claude-code   15
gemini-cli     3
codex          3
```

Cursor is firing `discovery:result` twice per second, every second,
every event returning `cachedSources=7, freshSources=0`. Each cycle
costs ~20ms (fs-change → ingest-adapter work item → discovery →
reclaim). At ~4 cycles/second that's **~8% CPU burned on discovery
with cache hits that produce no work**, plus pipeline queue pressure.

Root cause: no debouncing/coalescing in the watch path.
`Grep "debounce|coalesce|throttle" src/` returns **zero matches**.
Cursor's `state.vscdb-wal` is continuously written by the live
Cursor IDE, and every write becomes an independent fs-change event,
becomes an ingest-adapter queue item, becomes a full worker-eligible
discovery pass (the cache hit is on each individual pass, but the
whole pipeline still runs).

**This is the actual reason the daemon is pegged at 95% CPU**, and it
is adjacent to — but worse than — the startup replay concern the
proposal was addressing. A durable cache does not help here; the
cache is already hit. The fix is a debounce/coalesce layer between
the file watcher and the adapter work queue.

**Fix shape:** coalesce multiple fs-change events for the same
adapter within a short window (100–500ms) into one work item. Already
the case for periodic scans, not the case for the watch path.

### Empirical-3. P1 — Silent `catch {}` blocks in adapters violate documented rules

`.claude/rules/adapters.md` says: *"Silent `catch {}` blocks are
forbidden in adapters — surface parse errors so they can be debugged."*

Violations found:
- `src/adapters/kiro.ts:124` — swallows all errors in `findChanged`
- `src/adapters/kiro.ts:292` — swallows all errors in message load
- `src/adapters/gemini-cli.ts:159` — swallows all errors
- `src/adapters/opencode.ts:147` — swallows all errors

Four adapters, five silent catches. All would hide real parse
failures from the operator.

### Empirical-4. Worker ingest tests are happy-path only

`test/worker-ingest.test.ts` (189 lines) exercises:
- Codex: one ref, one happy load
- Cursor: one ref, one happy load

Does NOT cover:
- Worker failure or timeout
- Partial batch failure (multiple refs, one fails) — P1-5 in the
  main findings
- Shutdown with in-flight worker — P1-4
- Cache hit path (the thing the durable cache buys)
- Any adapter beyond Codex/Cursor

Fixing the P1 bugs without adding tests will leave them unguarded.

### Empirical-5. Migration reviewer — additional P1s

From the schema/migration review:

- **`adapter_contract_version` is written on save but never checked on
  load.** `src/db/discovery-cache.ts:154` checks `payload_version`
  only. Contract version bumps are currently protected only because
  the value is also baked into `config_fingerprint` — that coupling
  is undocumented and load-bearing. If a future refactor separates
  them, contract-version invalidation silently breaks.
- **Staging table orphan risk on crash.** `_jin_stage_*` rows from
  an interrupted write session survive across restart. GC runs only
  on next `beginWrite` for some conversation. On a large corpus
  re-ingest that crashes partway, tens of thousands of orphan rows
  can accumulate.
- **No foreign keys between staging tables.**
  `src/db/schema.ts:136–176` — `_jin_stage_messages` and
  `_jin_stage_tool_calls` reference `_jin_stage_sessions.session_id`
  but without `FOREIGN KEY ... ON DELETE CASCADE`. Cleanup is manual
  and ordered; any reordering silently leaks child rows.
- **`initializeStagedSession` uses manual `BEGIN/COMMIT`.**
  `src/db/write-session.ts:232–253` — every other staging write uses
  `db.transaction()`. Mixed patterns.
- **Discovery cache migration uses single-shot `CREATE TABLE IF NOT
  EXISTS` instead of iterated version array.** `src/db/discovery-cache.ts:434`
  — future schema bumps must restructure the function, mirroring the
  pre-fix ARCH-2 pattern that was already fixed in the canonical
  store.

### Empirical-6. Daemon reviewer — additional P1s

From the daemon review:

- **Three PID writers, not one.** `src/daemon/daemonize.ts:44`,
  `src/commands/watch.ts:101`, `src/updater.ts:184`. Each has a ~500ms
  TOCTOU window during startup.
- **`SIGHUP` not handled** (`src/commands/watch.ts:213–214`). Under
  launchd/nohup the daemon dies without cleanup.
- **`jin stop` wait is 2s, shutdown drain is longer.** Operator sees
  "still stopping" and `jin start` refuses while the daemon is mid-shutdown.
- **Two `jin start` processes can both pass `isRunning()` and both
  open `store.db`.** No exclusive lock. WAL mode hides the damage
  until `_jin_sync` revision counters diverge.

---

## Revised P0/P1 Summary (sorted by urgency)

| Rank | Finding | Source | File |
|------|---------|--------|------|
| **P0** | Cursor runaway fs-change loop — 226 scans / 30s, 8% CPU on cache-hit no-ops | Empirical | `src/pipeline/watcher.ts`, `src/pipeline/queue.ts` (missing debounce) |
| P1 | `adapter_contract_version` written but never checked on load | Migration | `src/db/discovery-cache.ts:154` |
| P1 | Codex `releaseDiscoveryMemory` clears `fileIndexCache` (defeats export) | Adapter | `src/adapters/codex.ts:221` |
| P1 | Shutdown timeout orphans in-flight workers | Pipeline/Daemon | `src/commands/watch.ts:231`, `src/pipeline/loop.ts:192–208` |
| P1 | Three PID writers with TOCTOU windows | Daemon | `daemonize.ts:44`, `watch.ts:101`, `updater.ts:184` |
| P1 | No `SIGHUP` handler | Daemon | `src/commands/watch.ts:213–214` |
| P1 | Size-equal atomic replace not detected (all three heavy adapters) | Adapter | `claude-code.ts:391`, `codex.ts:382`, `cursor.ts:352` |
| P1 | Typed-intersection duck-typing pervasive (ARCH-10 not fixed) | Simplicity | `ingest.ts:565`, `ingest-worker.ts:511` |
| P1 | Silent `catch {}` in 4 adapters violates documented rule | Rule-check | `kiro.ts:124,292`, `gemini-cli.ts:159`, `opencode.ts:147` |
| P1 | Staging table orphan risk on crash, no FK cascades, no startup sweep | Schema/Migration | `schema.ts:136–176`, `write-session.ts:232–253` |
| P1 | Two `jin start` can both open `store.db` (no exclusive lock) | Daemon | `watch.ts:61,101` |
| P1 | `hadLoadFailure` suppresses cache persistence for refs that succeeded | Pipeline | `ingest.ts:196–215,242` |

**The #1 thing to fix is P0 — it's what's actually burning the user's
CPU right now, and no amount of cache architecture work addresses
it.** Add a per-adapter fs-change debounce (100–500ms coalesce window)
and the observed loop goes away.

---

## Round 2 — Verification Against Subsequent Changes

After the above, the user made a substantial round of changes: 1,901
insertions, 199 deletions across 34 files. Four parallel reviewers
(adapter, pipeline, daemon, schema) verified each P0/P1 against the
new code. Results below.

### Fixed cleanly

| Finding | Status | Evidence |
|---|---|---|
| **P0** Cursor runaway fs-change loop | **FIXED** (two layers) | `src/adapters/cursor.ts:269–300` — Layer 1 returns `false` on fs-change (periodic-only); `src/pipeline/file-watcher.ts:30–48` — 500ms debounce per `(adapterId, path)` key; exact-file watch on `state.vscdb` instead of directory |
| **P1-5** `hadLoadFailure` suppresses cache persistence for whole batch | **FIXED** | `src/pipeline/ingest.ts:281–289, 485–491` — per-ref `excludedDiscoverySourcePaths` filter; successful refs persist |
| **P1** Codex `releaseDiscoveryMemory` clears `fileIndexCache` | **FIXED** | `src/adapters/codex.ts:226–228` — now only clears `loadedFileCache`, aligned with Claude Code |
| **P1** Cursor `collectLayer1Changes` non-atomic map swap | **FIXED** | `src/adapters/cursor.ts:337–338` — both maps replaced after loop |
| **P1** Fingerprint unsorted object keys | **FIXED** | `src/db/discovery-cache.ts:397–411` — stable literal key order |
| **P2-4** No parent-side handshake timeout by default | **FIXED** | All callers now pass non-zero `timeoutMs` from `ingest.ts:122–128, 183–193` |
| Discovery cache lifecycle tests added | **PARTIAL** | `test/discovery-cache.test.ts` covers recreation, empty-store, load-failure, partial-failure, lifecycle replay — but NOT `releaseDiscoveryMemory()` ordering and NOT the `adapter_contract_version` load gate |

### Partial fixes

| Finding | Status | Evidence |
|---|---|---|
| **P1** Typed-intersection duck-typing | **PARTIAL** | `releaseTransientMemory?()` / `releaseDiscoveryMemory?()` now on `Adapter` interface (`src/contracts/adapters.ts:27–33`). But `exportDiscoveryState` / `importDiscoveryState` still live on separate `DiscoveryCacheCapableAdapter` in `src/adapters/discovery-cache.ts:23–28` — a layering violation (contract defined in `src/adapters/`, not `src/contracts/`). Cursor + Codex still implement `V2Adapter` from `./types`, not `ContractAdapter` from `../contracts/adapters` |
| **P1-4** Shutdown timeout orphans in-flight workers | **PARTIAL** | Worker subprocesses are killed on worker-side timeout/error (`ingest-worker.ts:471–476, 503–509`). But the **daemon-level drain timeout** path at `src/pipeline/loop.ts:202–207` still returns without killing workers and `watch.ts:231–234` calls `finishWithExit(1)` without an explicit kill sweep |
| **P1** `jin stop` wait < shutdown drain timeout | **PARTIAL** | `start.ts:39` and `restart.ts:97` now pass `waitForExitMs: SHUTDOWN_DRAIN_TIMEOUT_MS`. But the user-facing `stop.ts:61` still uses `DEFAULT_STOP_WAIT_MS = 2_000` — operators running `jin stop` still see "still stopping" during long drains |
| **P2-2** Four hardcoded `["claude-code","codex","cursor"]` sets | **PARTIAL** | Consolidated to two `Set` constants at `ingest.ts:72–73`, but `needsSingleRefIngestBatch` (`:623`) and `needsAggressiveBatchReclaim` (`:631`) still hardcode the same three adapters separately |
| **P2** Discovery cache migration iterated array | **PARTIAL** | `runDiscoveryCacheMigrations` at `src/db/discovery-cache.ts:434–476` now uses `PRAGMA user_version` gating — real improvement. But still single-branch `if` rather than iterated `migrations[]` like `schema.ts:204–215` |
| **BP-04** documents heavy-adapter extension contract | **PARTIAL** | Documents `releaseTransientMemory?()` and `releaseDiscoveryMemory?()` (lines 74–84 of diff). Mentions `exportDiscoveryState` / `importDiscoveryState` / `discoveryCacheContractVersion` / `discoveryCachePayloadVersion` by name but provides no field semantics, no version-matching rules, no interface |

### Still unchanged

| Finding | Evidence |
|---|---|
| **P1** Size-equal atomic-replace blind spot | `claude-code.ts:390–395`, `codex.ts:929–933`, `cursor.ts:350` all still `size + mtime` only. No content-hash tiebreaker anywhere |
| **P1** `adapter_contract_version` written but never checked on load | `src/db/discovery-cache.ts:154` still checks only `payload_version`. Contract-version invalidation works today *only* because the version is baked into `config_fingerprint` — an undocumented and load-bearing coupling |
| **P1** Silent `catch {}` in adapters | Still present: `gemini-cli.ts:159`, `opencode.ts:147`, `kiro.ts:292`. Violates `.claude/rules/adapters.md` |
| **P1** Three PID writers, TOCTOU windows | `daemonize.ts:44`, `watch.ts:101`, `updater.ts:184` all still write independently. Now augmented by a *fourth* reader path via `runtime-state.ts` — structural problem unchanged |
| **P1** No SIGHUP handler | `watch.ts:213–214` still only registers SIGINT/SIGTERM |
| **P1** Two `jin start` can race past `isRunning()` | `watch.ts:47,61` still a plain read-check-write with no `O_EXCL` / `flock`. Two concurrent daemons can both open `store.db` |
| **P1** Staging tables have no FK CASCADE | `schema.ts:143–177` — `_jin_stage_messages` / `_jin_stage_tool_calls` reference `session_id` without `FOREIGN KEY` |
| **P2** `initializeStagedSession` manual `BEGIN/COMMIT` | `write-session.ts:232–253` — inconsistent with rest of file |
| **P2** Orphan GC only on `beginWrite`, not startup | Unchanged — rows from a crashed-before-first-write session persist |
| **P2** `reclaimProcessMemory` dead code | `ingest.ts:684–690` still unused |
| **P2-3** No max frame size on JSON-RPC parent read | `ingest-worker.ts:1017–1024` — still uncapped; the `Uint8Array` concat loop at `:953` is now additionally an O(n²) allocation path |
| **P3** No Postgres schema handshake | Not started |

### New bugs introduced by this round

| ID | Severity | Finding | File |
|---|---|---|---|
| N-1 | P2 | Cursor `resolveLayer1ParentId` rebuilds full parent map on every cache miss — unbounded DB opens per load batch | `src/adapters/cursor.ts:586–594` |
| N-2 | P2 | Cursor `resolveLayer1TraceId` same pattern — two redundant full DB scans possible per conversation load | `src/adapters/cursor.ts:597–612` |
| N-3 | P2 | Layering: `DiscoveryCacheCapableAdapter` lives in `src/adapters/discovery-cache.ts` not `src/contracts/` — adapters import the contract from a peer adapter file | `src/adapters/discovery-cache.ts:23–28` |
| N-4 | P2 | `loadStartupConfig` writes `config.json` in-place with no atomic rename — crash mid-write destroys user sinks/routes | `src/config.ts:251` |
| N-5 | P2 | `loadStartupConfig` silently re-injects missing adapter defaults on every start; user who removes an adapter entry gets it back with no warning, comments/ordering lost | `src/config.ts:250–251` |
| N-6 | P2 | Streaming `concatUint8Arrays` on every chunk — parent RSS can reach tens of MB mid-frame for large conversations | `src/pipeline/ingest-worker.ts:953` |
| N-7 | P2 | `as WorkerStartedNotification` / `as WorkerSampleNotification` casts on notification params with no runtime validation — malformed worker notifications silently operate on `undefined` | `ingest-worker.ts:307,316,331,343,354` |
| N-8 | P2 | `reclaimSqliteStoreMemory` duck-types the store via `database?.exec?.(...)` — ARCH-10 pattern reappearing | `src/pipeline/ingest.ts:666–681` |
| N-9 | P2 | `_jin_stage_sessions.conversation_id` has no FK to `conversations` — orphan session rows survive conversation delete | `src/db/schema.ts:136–141` |
| N-10 | P3 | `tool_calls` composite PK `(conversation_id, message_id, id)` diverges from ontology spec (`id TEXT PRIMARY KEY`) — allows duplicate tool call ids across messages | `src/db/schema.ts:78` vs `docs/ontology.md §7.1` |
| N-11 | P3 | `cache.ts` daemon-liveness check uses persisted `jin.runtime.json` state, not live-PID — after daemon crash, `jin cache clear` refuses forever | `src/commands/cache.ts:7` |
| N-12 | P3 | `updater.ts` writes spawned PID based on `exitCode === null` at 500ms — a slow-starting process that later fails will leave its PID reported as live | `src/updater.ts:179–186` |

### One source of confusion worth noting

`docs/issues/2026-04-17-startup-replays-heavy-adapter-discovery-on-fresh-start.md`
reports identical `913 / 6 / 416` ref counts across restart as evidence
that the cache isn't working. But `findChanged()` returns *all* refs
currently visible in source — the cache doesn't reduce the returned
count, it reduces the **per-ref parse cost** (compaction scan, layer
fingerprint). Equal counts before/after cache is expected. The right
metric is wall-clock time to complete discovery, not ref count. The
issue is written as if it is open, but the cache is already populated
(908 / 7 / 193 sources in my live-daemon check) — it is probably
already landing the intended win, just measured against the wrong
signal. Worth confirming with a restart timing benchmark before
relitigating the architecture.

### Revised verdict

The user shipped ~80% of what the review asked for. The remaining
items split cleanly:

- **Five P1s still wide open** (size-equal hash, adapter_contract_version
  load gate, silent catches, SIGHUP, exclusive-lock on startup). Each
  is a small, contained fix — none require architecture changes.
- **Several PARTIAL fixes** where the first half landed and the second
  half didn't — notably the PID writer consolidation, `jin stop` wait
  alignment, and the BP-04 contract documentation. These are "finish
  the migration" tasks.
- **Twelve new bugs** introduced by this round — most P2, none showstoppers,
  but N-4 and N-5 (config file overwrite without atomic rename, and
  silent re-injection of defaults) are the kind that erase user state
  and should be fixed before this branch merges to main.
