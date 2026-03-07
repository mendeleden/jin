# Jin Performance Plan — v0.6.0 "Zero Waste"

> "Not one kilobyte unaccounted for, not one CPU cycle wasted."

## Baseline Measurements (v0.5.1, 2026-03-07)

### System Under Test
| Metric | Value |
|---|---|
| Machine | Intel i7-5557U @ 3.10GHz, 4 cores, 16GB RAM |
| OS | Linux 6.8.0-88-generic |
| Jin version | v0.5.1 |
| Binary size | 102MB (Bun single-binary) |
| Runtime | Bun (V8/JSC) |

### Source Data Profile
| Metric | Value |
|---|---|
| JSONL files watched | 187 |
| Total source data on disk | 104MB |
| Total JSONL lines | 30,520 |
| Sessions | 28 |
| Messages | 17,378 |
| Largest JSONL file | ~17MB |
| Active project directories | 7 |

### Current Resource Consumption (PATHOLOGICAL — 5 days uptime)
| Metric | Value | Target (v0.6.0) |
|---|---|---|
| **CPU %** | **40.2%** | <0.5% idle, <5% burst |
| **RSS (resident memory)** | **569MB** (peak 765MB) | <80MB |
| **VM Peak** | **128GB** (!) | <500MB |
| **Threads** | 12 | ≤8 |
| **Open file descriptors** | 378 | <50 |
| **Context switches (voluntary)** | 262,926,874 | — |
| **Context switches (involuntary)** | 6,080,749 | — |
| **rchar (bytes read)** | 7.8TB | <1GB/day |
| **wchar (bytes written)** | 2.27TB | <100MB/day |
| **syscalls (read)** | 688,546,340 | — |
| **syscalls (write)** | 302,578,226 | — |
| **CPU time accumulated** | 2,946 minutes (49 hours) | <5 min/day |
| **Log file size** | 7.1MB (139,642 lines, all duplicated) | <500KB/day |
| **SQLite store** | 47MB | ≤47MB (no regression) |

### Event Frequency (PATHOLOGICAL)
| Metric | Value | Target (v0.6.0) |
|---|---|---|
| Push events (all time, 5 days) | 127,924 | <500/day |
| Push events per hour (active) | ~710 | <20/hour |
| session_updated events (all time) | 5,488 | <100/day |
| `ensureTables()` DDL executions | 127,924 (every push!) | 1 (at startup) |
| Duplicate log lines | 100% (every line 2x) | 0% |
| Watcher event multiplier | 3-6x per file change | 1x |

### Sink Configuration (WASTEFUL)
| Metric | Value | Target |
|---|---|---|
| Configured sinks | 3 | 2 (remove duplicate) |
| postgres-1 and postgres-2 | Same Neon DB (pooler + direct) | Single pooler connection |
| Persistent connections held | 3 (preventing Neon auto-suspend) | 0 persistent (connect-per-push) |
| Messages per INSERT | 1 (individual round-trips) | 50-100 (batched) |
| Push tracking (`push_log`) | Built but never called | Wired up |

---

## Performance Budget (v0.6.0 and all future versions)

These are **hard limits**. Any PR that causes a regression past these numbers MUST be rejected.

### Tier 1: Idle (no active coding session)
| Resource | Budget | Measurement |
|---|---|---|
| CPU | <0.1% | `ps -p $PID -o %cpu` averaged over 5 min |
| RSS | <50MB | `ps -p $PID -o rss` |
| Disk read | 0 bytes/min | `/proc/$PID/io` rchar delta |
| Disk write | 0 bytes/min | `/proc/$PID/io` wchar delta |
| Network | 0 bytes/min | No push when no changes |
| Open FDs | <30 | `ls /proc/$PID/fd \| wc -l` |

### Tier 2: Active (developer coding, files changing)
| Resource | Budget | Measurement |
|---|---|---|
| CPU | <5% sustained, <15% burst (1s) | `pidstat -p $PID 1` |
| RSS | <80MB | `/proc/$PID/status` VmRSS |
| RSS growth | 0 bytes/hour (steady state) | Track over 1 hour |
| Disk read per ingest | ≤ delta bytes (new data only) | Measure bytes read vs bytes appended |
| Postgres queries per push | ≤ 5 per sink | Count via sink logging |
| Ingest latency (file change → SQLite) | <500ms | Measure in watcher callback |
| Push latency (SQLite → Postgres) | <2s per batch | Measure in push callback |
| Log output | <10 lines/minute | `wc -l` delta |

### Tier 3: Startup / Full Reconciliation
| Resource | Budget | Measurement |
|---|---|---|
| Cold ingest (all files) | <5s for 200 files / 100MB | Time `jin ingest --once` |
| Peak RSS during cold ingest | <150MB | Monitor during ingest |
| Startup to first watch event | <2s | Time from exec to first log |

---

## Implementation Plan

### Phase 0: Instrument (Before ANY code changes)

**Goal:** Establish automated baseline measurement so every subsequent change has before/after proof.

#### Task 0.1: Add `jin benchmark` command
- Runs a standardized performance test:
  1. Start daemon, wait 10s idle → measure idle CPU/RSS/IO
  2. Append 100 lines to a test JSONL file → measure ingest CPU/RSS/IO/latency
  3. Wait 60s → measure steady-state RSS (detect leaks)
  4. Report all metrics in a table
- Output format: JSON (for CI) + human-readable table
- Store results in `~/.config/jin/benchmarks/` with timestamps

#### Task 0.2: Add `/proc` self-monitoring to the daemon
- On the periodic timer (every 30s), read own `/proc/self/status` and `/proc/self/io`
- Log RSS, CPU time delta, rchar delta, wchar delta
- If RSS > `MemoryBudget` (configurable, default 150MB), log WARNING
- If RSS > `MemoryMax` (configurable, default 256MB), log CRITICAL and exit(1) — let systemd/launchd restart
- Store metrics in SQLite `daemon_metrics` table for `jin status --perf` reporting

#### Task 0.3: Add performance assertions to CI
- Run `jin benchmark` in CI on every PR
- Assert: idle CPU <0.5%, RSS <80MB, ingest of 100 files <3s
- Fail the build if any assertion is violated
- Store benchmark results as CI artifacts for trend tracking

**Assignee:** Systems Engineer (Persona 1)
**Measurement:** The benchmark command itself produces the measurements. Success = command exists and runs.

---

### Phase 1: Stop the Bleeding (Critical Fixes)

**Goal:** Reduce resource consumption by 10-50x with minimal code changes. No architecture changes.

#### Task 1.1: Fix duplicate logging
**File:** `src/commands/watch.ts` (lines 62-67, 229-270)
**Problem:** `console.log()` writes to stdout (redirected to log file by `daemonize()`), AND `appendFileSync()` writes to the same log file. Every line appears twice.
**Fix:** In the `log()` function, check if daemonized. If yes, only `appendFileSync`. If no (foreground mode), only `console.log`.
**Before:** 139,642 log lines (69,821 unique)
**After:** 69,821 log lines
**Metric:** `wc -l ~/.config/jin/jin.log` after 1 hour, compare to baseline rate of ~1,940 lines/hour → expect ~970.

#### Task 1.2: Fix watcher event multiplication
**File:** `src/adapters/claude-code.ts` (lines 165-177), `src/watcher.ts` (line 20)
**Problem:** `watchPaths()` returns overlapping subdirectories, each watched with `recursive: true`. A file change triggers events from multiple parent watchers with different relative paths, bypassing the debounce key.
**Fix:** Option A: Return only the top-level `~/.claude/projects/` (or platform equivalent) as a single watch path. Option B: Resolve all event paths to absolute paths before debounce keying.
**Before:** 6 events per file change (3 overlapping watchers × 2 OS events)
**After:** 1 event per file change
**Metric:** Count `session_updated` log lines in 10 minutes of active coding. Before: ~50-100. After: ~8-15.

#### Task 1.3: Remove duplicate Postgres sink
**File:** `~/.config/jin/config.json` (user action + documentation)
**Problem:** `postgres-1` (pooler) and `postgres-2` (direct) point to the same Neon database. Every session is written twice to the same tables.
**Fix:** Remove `postgres-2`. Update route for `jin` project to use `postgres-1`. Document that pooler endpoints should always be preferred for this workload.
**Before:** 3 sinks, 6 push operations per file change
**After:** 2 sinks, 2 push operations per file change (after Task 1.2)
**Metric:** Count `Pushed` log lines per hour. Before: ~710. After: ~60.

#### Task 1.4: Move `ensureTables()` to sink initialization
**File:** `src/sinks/postgres.ts` (line 50)
**Problem:** `ensureTables()` runs 8-9 DDL statements (including `DROP TRIGGER / CREATE TRIGGER` which takes `ACCESS EXCLUSIVE` lock) on EVERY push call.
**Fix:** Call `ensureTables()` once in the constructor or in `healthCheck()`. Cache a boolean `this.tablesEnsured = true` to never run again.
**Before:** 127,924 DDL executions over 5 days (~1,066/hour)
**After:** 1 DDL execution per daemon lifetime
**Metric:** Add a counter for `ensureTables()` calls. Assert it equals 1 after any test run.

#### Task 1.5: Exclude self-observation
**File:** `src/commands/watch.ts` (onChange handler)
**Problem:** Jin watches the directory containing its own active Claude Code session. Every ingest triggers file reads, which (combined with the periodic timer) creates a feedback loop.
**Fix:** Detect the current session's JSONL file path (from the `JIN_SESSION` env var or by checking which files are open by the current process). Exclude it from the watcher, or add a configurable `excludePaths` array.
**Before:** Continuous feedback loop during active coding
**After:** No self-observation
**Metric:** During a 5-minute idle period (no human typing), `session_updated` events should be 0. Before: ~10/minute from periodic timer re-triggering.

**Assignee:** Systems Engineer (Persona 1) for 1.1, 1.2, 1.5. Database Engineer (Persona 3) for 1.3, 1.4.
**Combined Phase 1 Target:**
- CPU: 40% → <5%
- Push events/hour: 710 → <30
- Log lines/hour: 1,940 → <100

---

### Phase 2: Incremental Architecture (High-Impact Refactors)

**Goal:** Eliminate the full-reparse antipattern and implement proper push tracking.

#### Task 2.1: Implement byte-offset file tracking
**Files:** New `src/file-tracker.ts`, modify `src/adapters/claude-code.ts`, `src/commands/watch.ts`
**Problem:** Every ingest reads ALL 187 JSONL files from byte 0, parsing every line. For 104MB of source data, this is ~200MB of allocations per cycle (read + split + parse, done twice for metadata and messages).
**Design:**
```
FileTracker {
  registry: Map<filePath, {
    inode: number,
    size: number,
    mtime: number,
    byteOffset: number,   // last read position
    lineCount: number,
    sessionId: string      // cached from first parse
  }>
}
```
- On file change: `stat()` the file. If `size === registry.size && mtime === registry.mtime`, skip entirely (O(1)).
- If changed: `seek(byteOffset)`, read only new bytes, parse only new lines, update offset.
- On truncation (`size < byteOffset`): reset to 0, full re-parse (rare).
- Persist registry to SQLite on shutdown, restore on startup.
**Before:** 104MB read per ingest cycle (~200MB allocations)
**After:** Only delta bytes read (typically 1-5KB per message append)
**Metric:** Track `bytes_read_per_ingest` in daemon metrics. Before: ~104,000,000. After: <10,000 (during active coding with single file changing).

#### Task 2.2: Targeted ingest (only changed file)
**File:** `src/commands/watch.ts` (ingestAdapter function)
**Problem:** `ingestAdapter()` calls `adapter.sessions()` which scans ALL files for ALL projects. The `WatchEvent` has a `path` field identifying exactly which file changed, but it's ignored.
**Fix:** Pass the changed file path to a new `adapter.ingestFile(path)` method. Only parse that one file. Fall back to full scan only on periodic reconciliation.
**Before:** 187 files parsed per watcher event
**After:** 1 file parsed per watcher event
**Metric:** `files_parsed_per_ingest`. Before: 187. After: 1.

#### Task 2.3: Wire up push tracking (already built!)
**File:** `src/store.ts` (logPush, unpushedSessions), `src/commands/watch.ts`
**Problem:** `store.logPush()` and `store.unpushedSessions()` exist but are never called. The push pipeline re-pushes ALL sessions every cycle.
**Fix:** After successful push, call `store.logPush(sessionId, sinkId)`. Before pushing, call `store.unpushedSessions(sinkId)` to get only sessions with new data since last push. Push only the delta.
**Before:** All 28 sessions pushed every cycle
**After:** Only changed sessions pushed (typically 1)
**Metric:** `sessions_pushed_per_cycle`. Before: 7-28. After: 1 (during active single-session coding).

#### Task 2.4: Delta message pushing
**File:** `src/sinks/postgres.ts`, `src/store.ts`
**Problem:** When pushing a session, ALL messages are sent (e.g., 600 messages for a long session), even if only 1 new message was added.
**Fix:** Track `last_pushed_message_index` per (session_id, sink_id). On push, only send messages with index > last pushed. Update after success.
**Before:** All messages re-pushed every cycle (e.g., 600 messages)
**After:** Only new messages pushed (e.g., 1-3)
**Metric:** `messages_pushed_per_cycle`. Before: hundreds. After: 1-5.

#### Task 2.5: Batch Postgres inserts
**File:** `src/sinks/postgres.ts` (lines 55-96)
**Problem:** Each message is a separate `INSERT ... ON CONFLICT` query — individual network round-trips to Neon. For 50 messages over 50ms latency, that's 2.5 seconds of wall time.
**Fix:** Build multi-row VALUES inserts:
```sql
INSERT INTO messages (id, session_id, ...) VALUES
  ($1,$2,...), ($N+1,$N+2,...), ...
ON CONFLICT (id) DO UPDATE SET ...
```
Batch size: 100 messages per INSERT. Sessions can also be batched.
**Before:** N queries for N messages (e.g., 50 round-trips)
**After:** ceil(N/100) queries (e.g., 1 round-trip)
**Metric:** `postgres_queries_per_push`. Before: ~150 (7 sessions × ~20 msgs + 7 session upserts + 8 DDL). After: ~3 (1 session upsert + 1 message batch + 0 DDL).

**Assignee:** Systems Engineer (Persona 1) for 2.1, 2.2. Database Engineer (Persona 3) for 2.3, 2.4, 2.5.
**Combined Phase 2 Target:**
- CPU: <5% → <0.5%
- RSS: 569MB → <80MB
- Bytes read per ingest: 104MB → <10KB
- Postgres queries per push: ~150 → ~3

---

### Phase 3: Process Management (Reliability & Resource Isolation)

**Goal:** Prevent future resource runaways. Make the daemon self-limiting and externally managed.

#### Task 3.1: Add resource self-monitoring with kill switch
**File:** `src/commands/watch.ts` (periodic timer)
**Design:** Every 30s, read `/proc/self/status` (Linux) or `process.memoryUsage()` (cross-platform):
- If RSS > 200MB: log WARNING, force GC if available
- If RSS > 256MB: log CRITICAL, write metrics to SQLite, exit(1)
- If CPU time delta > 5s per 30s window (16.7%+ CPU): log WARNING
- Store all readings in `daemon_metrics` SQLite table
**Metric:** Daemon should never exceed memory budget. Verify with `jin status --perf` showing max RSS over time.

#### Task 3.2: Enhance systemd unit with cgroup limits
**File:** `src/commands/service.ts` (lines 38-55)
**Add to generated unit:**
```ini
CPUQuota=10%
MemoryMax=256M
MemoryHigh=200M
TasksMax=20
OOMPolicy=stop
IOWriteBandwidthMax= 5M
```
**Metric:** `systemctl --user show jin.service -p MemoryPeak` should never reach MemoryMax during normal operation.

#### Task 3.3: Enhance launchd plist with resource controls
**File:** `src/commands/service.ts` (lines 134-179)
**Add:**
```xml
<key>ProcessType</key>
<string>Background</string>
<key>Nice</key>
<integer>10</integer>
```
**Plus self-monitoring kill switch from Task 3.1 (cross-platform).**

#### Task 3.4: Add `jin ingest --once` oneshot mode
**File:** New command or flag in `src/commands/watch.ts`
**Design:** Ingest all changed files (using file tracker from 2.1), push to sinks, exit. No watcher, no daemon. This enables:
- `systemd.path` / launchd `WatchPaths` triggering
- `systemd.timer` / launchd `StartInterval` periodic runs
- CLI-time ingest before queries (`jin search` can call this internally)
**Metric:** Execution time for `jin ingest --once` with no changes: <500ms. With 1 changed file: <2s.

#### Task 3.5: Make daemon optional for local queries
**File:** `src/commands/search.ts`, `src/commands/sessions.ts`, `src/commands/stats.ts`
**Design:** Before querying local SQLite, run a lightweight incremental ingest (check file mtimes, parse only changed files). This eliminates the requirement to have a running daemon for local-only workflows.
**Metric:** `jin sessions` without running daemon returns fresh data in <3s.

#### Task 3.6: Change default syncMode from "realtime" to "periodic"
**File:** `src/config.ts`, documentation
**Design:** Default debounce: 5000ms (was 200ms). Default push interval: 60s (was 1s). Default periodic sync: 300s (was 30s). Offer `--realtime` flag for those who need it, with a logged resource warning.
**Metric:** Push events per hour in default mode: <20 (was 710).

#### Task 3.7: Connect-per-push for Postgres sinks
**File:** `src/sinks/postgres.ts` (getConn method)
**Problem:** Persistent connections prevent Neon auto-suspend, consume connection slots 24/7.
**Fix:** Open connection at start of push, close after push completes. Use connection string directly, no pooling needed client-side (Neon pooler handles it).
**Metric:** Between pushes, `SELECT count(*) FROM pg_stat_activity WHERE application_name = 'jin'` should return 0.

**Assignee:** SRE (Persona 2) for 3.1, 3.2, 3.3. Product Tech Lead (Persona 4) for 3.4, 3.5, 3.6. Database Engineer (Persona 3) for 3.7.
**Combined Phase 3 Target:**
- Daemon self-limits to 256MB (hard kill) and 10% CPU (via cgroup)
- Local queries work without daemon
- Default push rate: <20/hour

---

### Phase 4: Observability & Governance (Permanent Guardrails)

**Goal:** Make resource usage visible and enforced so this class of bug never recurs.

#### Task 4.1: `jin status --perf` command
**Display:**
```
  jin performance (last 24h)

  Resource        Current     Peak      Budget      Status
  ─────────────────────────────────────────────────────────
  CPU             0.3%        2.1%      <5%         ✓ OK
  RSS             42MB        61MB      <80MB       ✓ OK
  Disk read       12KB/min    850KB/min <1MB/min    ✓ OK
  Disk write      4KB/min     120KB/min <500KB/min  ✓ OK
  Open FDs        18          22        <50         ✓ OK
  Postgres qps    0.02        0.8       <1          ✓ OK

  Ingest
  ─────────────────────────────────────────────────────────
  Files tracked   187         Bytes read/ingest   2.4KB avg
  Ingest cycles   142         Full re-parses      0
  Push cycles     24          Messages pushed     47

  Anomalies (last 24h): none
```

#### Task 4.2: Performance regression CI gate
**File:** `.github/workflows/perf.yml`
**Design:**
1. Run `jin benchmark` on a standardized test corpus (50 JSONL files, 10MB total)
2. Compare against stored baseline in `perf/baseline.json`
3. Fail if any metric regresses >10%:
   - Cold ingest time
   - Incremental ingest time
   - Peak RSS during ingest
   - Idle RSS after 30s
   - Postgres queries per push cycle
4. On main branch merge, update baseline

#### Task 4.3: CONTRIBUTING.md performance section
**Content:**
```markdown
## Performance Requirements

Every PR must pass the performance gate. Run `jin benchmark` locally before submitting.

### Hard Limits (will fail CI)
- Idle RSS: <80MB
- Idle CPU: <0.5%
- Incremental ingest (1 changed file): <500ms
- Full ingest (200 files, 100MB): <5s
- Postgres queries per push: <10

### Design Rules
1. NEVER re-read a file from byte 0 unless it was truncated
2. NEVER push data that hasn't changed since last push
3. NEVER hold persistent database connections
4. NEVER run DDL on the hot path
5. NEVER watch your own output files
6. Batch all database writes (minimum 50 rows per INSERT)
7. All allocations must be proportional to DELTA, not TOTAL data size

### How to Measure
- `jin benchmark` — automated performance test
- `jin status --perf` — live daemon metrics
- `/proc/$PID/io` — raw I/O counters (Linux)
- `jin start --foreground 2>&1 | grep PERF` — per-operation timing
```

#### Task 4.4: Add per-operation timing logs
**File:** `src/commands/watch.ts`, `src/sinks/postgres.ts`
**Design:** Wrap key operations with `performance.now()`:
```
[PERF] ingest: 12ms (1 file, 2.4KB read, 3 new messages)
[PERF] push(postgres-0): 145ms (1 session, 3 messages, 1 query)
[PERF] idle: RSS=42MB, CPU=0.1%, FDs=18
```
Only log PERF lines when `--verbose` or when values exceed thresholds.

**Assignee:** Product Tech Lead (Persona 4) for 4.1, 4.3. Systems Engineer (Persona 1) for 4.2, 4.4.

---

## Phase Summary & Expected Metrics

| Phase | CPU After | RSS After | Push/hour After | Timeline |
|---|---|---|---|---|
| Baseline (now) | 40.2% | 569MB | 710 | — |
| Phase 1 (stop the bleeding) | <5% | ~300MB | <30 | Week 1 |
| Phase 2 (incremental arch) | <0.5% | <80MB | <10 | Week 2-3 |
| Phase 3 (process mgmt) | <0.5% + capped | <80MB + capped | <5 | Week 3-4 |
| Phase 4 (governance) | Enforced in CI | Enforced in CI | Enforced in CI | Week 4-5 |

## Verification Protocol

After each phase, run this exact sequence and record results:

```bash
# 1. Start fresh daemon
jin stop && sleep 2 && jin start

# 2. Wait 60s for stabilization
sleep 60

# 3. Capture idle baseline
PID=$(cat ~/.config/jin/jin.pid)
echo "=== IDLE ==="
ps -p $PID -o %cpu,rss,vsz --no-headers
cat /proc/$PID/io
ls /proc/$PID/fd | wc -l

# 4. Simulate active coding (append 50 messages)
TEST_FILE=~/.claude/projects/-home-edmininode-test/test-session.jsonl
for i in $(seq 1 50); do
  echo '{"type":"assistant","message":{"content":"test message '$i'"},"timestamp":"'$(date -Iseconds)'"}' >> $TEST_FILE
  sleep 2
done

# 5. Capture active metrics
echo "=== ACTIVE ==="
ps -p $PID -o %cpu,rss,vsz --no-headers
cat /proc/$PID/io

# 6. Wait 5 min, check for memory leaks
sleep 300
echo "=== POST-ACTIVE ==="
ps -p $PID -o %cpu,rss,vsz --no-headers

# 7. Compare RSS: post-active should be within 5% of idle
```

## Architecture Decision Records

### ADR-001: File offset tracking over full-file re-parse
**Status:** Accepted
**Context:** JSONL files are append-only. Re-reading from byte 0 on every change is O(fileSize) when O(delta) is possible.
**Decision:** Track byte offset per file. Seek to last position, read only new bytes.
**Consequences:** Must handle file truncation (reset offset). Must persist offsets across restarts.

### ADR-002: Oneshot ingest over persistent daemon (default)
**Status:** Proposed
**Context:** The daemon exists primarily to watch files and push to sinks. With OS-level file watching (systemd.path, launchd WatchPaths), the daemon is unnecessary overhead.
**Decision:** Default mode is oneshot triggered by OS file watcher. Long-running daemon is opt-in via `--realtime`.
**Consequences:** Slight increase in ingest latency (process startup cost). Eliminates all memory leak and orphan process risks.

### ADR-003: Batch database writes
**Status:** Accepted
**Context:** Individual INSERT per message creates N round-trips to remote Postgres. Network latency dominates.
**Decision:** Multi-row VALUES inserts, batched by 100 rows. All writes in a single transaction per push cycle.
**Consequences:** Slightly more complex SQL construction. Single failure rolls back entire batch (acceptable — retry will re-send).

### ADR-004: No persistent database connections
**Status:** Accepted
**Context:** Persistent connections prevent Neon serverless auto-suspend, consuming compute hours and connection slots 24/7.
**Decision:** Open connection per push cycle, close after commit.
**Consequences:** ~500ms connection overhead per push (Neon cold start). Acceptable given push frequency of <1/minute.

### ADR-005: Performance budget as CI gate
**Status:** Accepted
**Context:** This incident was caused by accumulated performance regressions that were never measured or caught.
**Decision:** All PRs must pass `jin benchmark` with no regression >10% from baseline.
**Consequences:** Requires maintaining a benchmark corpus and baseline. Small CI time cost (~30s per run). Prevents future incidents of this class.
