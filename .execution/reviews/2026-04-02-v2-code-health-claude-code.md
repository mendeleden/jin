# V2 Code Health & Blueprint Alignment Audit

- **date**: 2026-04-02
- **auditor**: claude-code (manual deep review)
- **scope**: All v2 code — `src/contracts/`, `src/db/`, `src/pipeline/`, `src/routing.ts`, `src/sinks/webhook.ts`, `src/lifecycle.ts`, `src/runguard.ts`
- **total LOC reviewed**: ~3,700
- **packets covered**: W0-CODEX-01, W1-DB-01, W1-ROUTING-01, W1-LIFECYCLE-01, W1-SINK-01, W1-PIPE-01

## Overall Verdict

Strong foundation, faithful to blueprints at the interface/type level. Contracts
are solid, pipeline landed cleanly. But several BP-specified **runtime
safeguards** are not yet implemented — and some are load-bearing for production.

---

## Aligned

### Contracts (`src/contracts/`)
- All 8 files are faithful transcriptions of the blueprints
- Every type matches the ontology
- No drift found

### Store/DB (`src/db/`)
- `writeBundle()` — exact match to BP-05 pseudocode (hash-gated, revision-based, full transaction)
- `computeBundleHash()` — canonical JSON + SHA-256 with `satisfies` type guards for compile-time safety
- `conversationsNeedingPush()` — exact match to BP-05 SQL
- FTS5 external content with manual refresh — correct per BP-05
- Orphan detection and trace consistency queries — present
- PRAGMA user_version migrations — correct
- WAL mode, busy timeout, foreign keys — all set

### Pipeline (`src/pipeline/`)
- Serial coordinator with work queue — exact match to BP-02 pseudocode
- All work item types present: reconcile-adapters, ingest-all, ingest-adapter, push, shutdown-flush
- Change-gated push: `if (result.anyChanged) enqueuePush()` — correct
- Queue coalescing: adjacent push items collapse, same-adapter fs-change items merge changedPaths — correct
- Shutdown: stopping=true -> discard queue -> shutdown-flush -> final ingest + push -> close sinks — matches BP-02/BP-07
- 15-second drain budget with Promise.race — correct
- Batch sizes with Bun.sleep(0) yields between batches — present in both ingest.ts and push.ts
- WatcherController.reconcile() on adapter re-detection — correct

### Routing (`src/routing.ts`)
- Glob matching with * and ? — correct
- AND semantics for multi-field routes — correct
- Union of all matching routes — correct
- Safe zero-state — correct
- normalizeRemote() strips protocol, SSH prefix, .git, trailing slashes, lowercases — correct per BP-08
- Case sensitivity rules — correct (remote/adapter insensitive, branch/name sensitive)

### Webhook Sink (`src/sinks/webhook.ts`)
- Full-snapshot push with idempotencyKey = ${id}:r${revision} — exact BP-06
- pushed + failed = payloads.length invariant maintained
- No internal retry — correct per BP-06
- Timeout via AbortController — correct
- Per-conversation error reporting from response body parsing

### Lifecycle (`src/lifecycle.ts`, `src/runguard.ts`)
- 5 lifecycle states — correct
- Service precedence detection — correct
- Platform-specific service detection (systemd, launchd, Task Scheduler) — correct
- Graceful shutdown with SIGTERM -> wait -> optional SIGKILL — correct

---

## Drift / Known Deviations

### Store (informational, non-blocking — already noted in control plane)

| # | Issue | BP Says | Code Does | Severity |
|---|---|---|---|---|
| D1 | tool_calls PK | `id TEXT PRIMARY KEY` | `PRIMARY KEY (conversation_id, message_id, id)` composite | LOW |
| D2 | tool_calls.duration_ms default | ontology says `-1` | code uses `0` | LOW |
| D3 | no per-message est_cost column | ontology 2.2 lists it as derived | not in schema | LOW |

### Lifecycle (non-blocking)

| # | Issue | BP Says | Code Does | Severity |
|---|---|---|---|---|
| D4 | No flock/file locking | BP-07 prefers flock-style exclusion | PID file + kill(pid, 0) liveness check | LOW — race window is tiny, stale-PID case handled |

---

## MISSING: Runtime Safeguards (P1/P2)

These are specified in BP-02 and/or implemented in v1, but absent from v2 pipeline.

### P1 — Must Fix Before Production

| # | Missing Feature | Blueprint Ref | V1 Status | Impact |
|---|---|---|---|---|
| **M1** | **RSS kill switch** — 200MB warn, 256MB hard limit, graceful shutdown on exceed | BP-02 Resource Budget | v1 has it in `watch.ts:235-253` | daemon can grow unbounded, OOM on long-running machines |
| **M2** | **`sink.enabled` check before push** — disabled sinks should be skipped | BP-08 Selective Sink Disable | not in v1 either | `jin sink disable` has no effect on pushDirty() |

### P2 — Should Fix Before Production

| # | Missing Feature | Blueprint Ref | V1 Status | Impact |
|---|---|---|---|---|
| **M3** | **Per-adapter timeout** — 30s per loadConversation, 60s per findChanged | BP-02 Per-Adapter Timeout | not in v1 | hung adapter stalls entire serial loop |
| **M4** | **Consecutive error count + disable** — 3 failures -> skip until next periodic | BP-02 Per-Adapter Timeout | not in v1 | broken adapter retries forever without backoff |
| **M5** | **Per-adapter health tracking** — last success, last error, error count for jin status | BP-02 Error Handling | not in v1 | diagnostic gap |

### P3 — Nice to Have

| # | Issue | Notes |
|---|---|---|
| **M6** | macOS launchd plist has no memory/CPU limits | systemd has MemoryMax=256M/CPUQuota=2%, plist has nothing |
| **M7** | `normalizeBatchSize()` duplicated 3x | identical in loop.ts, ingest.ts, push.ts |
| **M8** | Route evaluation not cached during push | O(conversations x sinks x routes) per cycle — fine for typical, hot at scale |
| **M9** | globToRegExp() not cached | compiled on every route evaluation — fine for typical, hot at scale |

---

## Resource Budget Coverage

| Budget Item (BP-02) | systemd service | daemon mode | foreground | macOS launchd |
|---|---|---|---|---|
| RSS 256MB hard | MemoryMax=256M | **NONE** | **NONE** | **NONE** |
| RSS 200MB warn | MemoryHigh=200M | **NONE** | **NONE** | **NONE** |
| CPU 2% | CPUQuota=2% | **NONE** | **NONE** | **NONE** |
| Ingest batch 20 | DEFAULT_INGEST_BATCH_SIZE | yes | yes | yes |
| Push batch 20 | DEFAULT_PUSH_BATCH_SIZE | yes | yes | yes |
| Watcher debounce 500ms | DEFAULT_WATCH_DEBOUNCE_MS | yes | yes | yes |
| Adapter timeout 30s/60s | **NOT IMPLEMENTED** | - | - | - |

The v1 brain had an RSS check in all modes. The v2 pipeline relies entirely on
systemd cgroups, which only apply to one deployment path.

---

## Code Quality Notes

### Good
- Clean layer separation, no circular imports
- `satisfies` guards on bundle hash for compile-time completeness
- No swallowed exceptions in pipeline
- Queue coalescing prevents push storms
- Bun.sleep(0) yields between batches

### Minor
- store.ts singleton Map never evicts (fine for daemon, accumulates in tests)
- push.ts re-evaluates routes per conversation per sink (O(c*s*r))
- tool_calls FK on message_id makes delete order matter in bundle.ts

---

## Codex Decisions Needed

1. **M1 (RSS kill switch)**: Should this live in `pipeline/loop.ts` as a
   periodic check, or as a separate watchdog? v1 used a setInterval in the
   watch command. The pipeline coordinator already has a periodic timer —
   adding an RSS check to the reconcile-adapters work item would be natural.

2. **M2 (sink.enabled)**: The pipeline currently receives `sinks: ReadonlyArray<Sink>`.
   Should the enabled check live in `pushDirty()` (needs access to config),
   or should the caller filter disabled sinks before passing them to the pipeline?

3. **M3/M4 (adapter timeout + error tracking)**: These are new capabilities
   not in v1. Should they be a separate packet or folded into W1-PIPE-01
   completion?

4. **M6 (macOS limits)**: launchd supports `SoftResourceLimits` /
   `HardResourceLimits` keys but they're deprecated in favor of no equivalent.
   Should we add the RSS kill switch to the pipeline itself and not rely on
   OS-level limits?

---

## Recommended Fix Order

1. Port RSS kill switch into pipeline (P1, ~20 lines)
2. Add sink.enabled filter to pushDirty (P1, trivial)
3. Add per-adapter timeout wrappers (P2, medium)
4. Add consecutive error tracking (P2, small)
5. Extract normalizeBatchSize to shared utility (P3, trivial)
