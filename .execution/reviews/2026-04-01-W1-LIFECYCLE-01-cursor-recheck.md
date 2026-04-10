# Review: W1-LIFECYCLE-01 — Runtime Boundary (Recheck)

- reviewer: `cursor-REVIEWER-runtime-boundary-recheck`
- packet: `W1-LIFECYCLE-01`
- date: `2026-04-01`
- verdict: **approved — no blocking findings**

---

## Scope of Review

Narrow recheck of lifecycle-owned files only, following Codex direction to
separate the mixed-workspace attribution from the prior review round. The
prior review's B1 (webhook boundary violation) is **dismissed** — `W1-SINK-01`
separately owns `src/sinks/webhook.ts` and `test/webhook-sink.test.ts` and is
already approved. Those files are out of scope for this packet.

Files reviewed (lifecycle-owned only):
- `src/lifecycle.ts` (modified)
- `src/runguard.ts` (modified)
- `src/commands/start.ts` (modified)
- `src/commands/stop.ts` (modified)
- `src/commands/status.ts` (modified)
- `src/commands/service.ts` (modified)
- `test/lifecycle-boundary.test.ts` (new — lifecycle tests)

Frozen contracts verified unchanged:
- `src/contracts/lifecycle.ts` ✓
- `src/contracts/config.ts` ✓
- `src/contracts/pipeline.ts` ✓

Forbidden directories verified untouched:
- `src/pipeline/**` ✓
- `src/contracts/**` ✓
- `src/db/**` ✓
- `src/adapters/**` ✓

Tests run:
- `bun test test/lifecycle-boundary.test.ts` — 5/5 pass, 16 assertions

---

## Blocking Findings

None.

---

## Prior Review Findings — Disposition

| Finding | Prior Status | Recheck Disposition |
|---------|-------------|---------------------|
| B1 (webhook boundary violation) | blocking | **dismissed** — `W1-SINK-01` owns those files; mixed-workspace attribution in shared branch |
| B2 (no lifecycle tests) | blocking | **resolved** — `test/lifecycle-boundary.test.ts` added with 5 passing tests |
| D1 (stop timeout asymmetry) | informational | **carried** — still present, still informational |
| D2 (v1 Store API in status.ts) | informational | **carried** — expected bridge, absorbed when v2 store lands |

---

## Aligned

### BP-07 Core Invariants

| Invariant | Status | Evidence |
|-----------|--------|----------|
| One long-lived owner per store | ✓ | `start.ts:67-77` blocks second owner with mode-specific messaging |
| Single coordinator | ✓ | `runguard.ts:230-256` — `detectActiveOwner()` checks service, PID file, and process liveness |
| Query without daemon | ✓ | `status.ts` opens store directly, returns useful output when stopped |
| Shared runtime path | ✓ | Foreground, daemon, and service all enter through `watchCommand` / `startCommand` |
| Desktop is client | ✓ | No desktop logic introduced |
| Config snapshot at start | ✓ | No hot-reload; config loaded once via `loadConfig()` |

### BP-07 Lifecycle State Model

Five states implemented in `runguard.ts:198-228` via `resolveRuntimeState()`:

| State | How entered | Evidence |
|-------|------------|----------|
| `stopped` | No active owner detected | `getRuntimeStatus()` returns `stopped` when `detectActiveOwner()` is null |
| `starting` | `markRuntimeStarting()` writes state file | `runguard.ts:150-154`, grace period 10s before auto-promote |
| `running` | `markRuntimeRunning()` writes state file | `runguard.ts:156-164`, or auto-promoted from stale `starting` |
| `degraded` | `markRuntimeRunning(issues)` with non-empty issues | `runguard.ts:161` — `issues.length > 0 ? "degraded" : "running"` |
| `stopping` | `markRuntimeStopping()` writes state file | `runguard.ts:166-170`, written before SIGTERM in `lifecycle.ts:106` |

State resolution handles edge cases:
- Stale `starting` (grace period expired) → promotes to `running`/`degraded`
- Owner drift (PID or mode changed) → rewrites persisted state
- Orphaned state file (process dead) → clears to `stopped`

### BP-07 Lifecycle Commands

| Command | BP-07 Behavior | Implementation | Tested |
|---------|---------------|----------------|--------|
| start | no-op if running, blocks second owner, reports service precedence | `start.ts:67-82` | ✓ 2 tests |
| stop | no-op if stopped, signal + bounded wait, service-aware | `stop.ts` + `lifecycle.ts:89-178` | ✓ 1 test |
| restart | stop then start, waits full drain budget | `start.ts:102-139` | (implicit via start/stop coverage) |
| status | works when stopped, shows mode/health/issues/paths | `status.ts` | ✓ 1 test |
| service install | stops existing owner before installing, marks starting→running | `service.ts:362-448` | ✓ 1 test |

### BP-07 Shutdown Semantics

- `stopWatcher()` in `lifecycle.ts:89-178`:
  - Reads current runtime status
  - If stopped: cleans up stale PID file and state, returns immediately
  - If service mode: delegates to `requestServiceStop()`, polls via `waitForServiceStop()`
  - If daemon/foreground: sends `SIGTERM`, polls via `waitForPidExit()`
  - Optional `forceAfterTimeout`: escalates to `SIGKILL` after wait
  - `waitForServiceStop()` capped to `SHUTDOWN_DRAIN_TIMEOUT_MS` (15s from contract)
- `markRuntimeStopping()` written before signaling (state visible to concurrent `status` calls)

### BP-07 Service Precedence

- `start.ts:67-70`: If running under service, reports service ownership and suggests service control
- `start.ts:79-81`: If service installed but inactive, warns user
- `service.ts:362-381`: Service install path stops existing daemon/foreground owner first
- Platform coverage: Linux (systemd), macOS (launchd), Windows (Task Scheduler)

### Frozen Contract Compliance

No files under `src/contracts/` modified. Implementation imports:
- `RuntimeMode`, `RuntimeState`, `RuntimeOwnershipRecord`, `RuntimeIssue`, `RuntimeStatus` from `contracts/lifecycle.ts`
- `SHUTDOWN_DRAIN_TIMEOUT_MS` (15s) from `contracts/lifecycle.ts`

### Boundary Discipline

Only lifecycle-owned files changed:
- `src/lifecycle.ts`, `src/runguard.ts`
- `src/commands/start.ts`, `src/commands/stop.ts`, `src/commands/status.ts`, `src/commands/service.ts`
- `test/lifecycle-boundary.test.ts` (new)

No forbidden files touched by this packet's lifecycle work.

---

## Drift

### D1. `DEFAULT_STOP_WAIT_MS` (2s) vs `SHUTDOWN_DRAIN_TIMEOUT_MS` (15s) — informational

`lifecycle.ts:20` uses 2s for `jin stop` default wait; `start.ts:121-124`
uses 15s for `jin restart`. The asymmetry is intentional — `stop` returns
quickly as a control-plane action ("still stopping, check `jin status`"),
while `restart` blocks until the old owner exits so it can re-start. A
one-line comment in `lifecycle.ts` explaining this choice would help. Not
blocking.

### D2. `status.ts` v1 Store API — informational

`status.ts:222-230` calls `store.sessionCount()`, `store.messageCount()`,
`store.analyzeByAdapter()` — v1 Store methods. This is an expected bridge
that will be absorbed when v2 store integration lands. Not blocking.

---

## Unowned Spread

None in lifecycle-owned scope. The prior review's unowned spread finding
(`src/sinks/webhook.ts`, `test/webhook-sink.test.ts`) belongs to
`W1-SINK-01` and is separately approved.

---

## Progress

### Acceptance Checks

| # | Check | Status | Test |
|---|-------|--------|------|
| 1 | Starting a second long-lived owner is blocked | ✓ | `starting a second detached owner is blocked` |
| 2 | Service-owned runtime is reported instead of spawning a daemon | ✓ | `service-owned runtime is reported instead of spawning a daemon` + `service install path waits for the existing owner to stop` |
| 3 | Status works while stopped | ✓ | `status works while stopped` |
| 4 | Stop behaves as a control-plane action, not an unbounded wait | ✓ | `stop behaves like a bounded control-plane action` |
| 5 | Tests cover ownership checks and service precedence | ✓ | 5 tests passing, all acceptance checks covered |

All five acceptance checks pass with tests.

### BP Alignment Summary

- **BP-07**: Fully aligned. Ownership model, five-state lifecycle machine,
  start/stop/restart/status commands, shutdown semantics, service precedence,
  and error messaging all match the blueprint. No gaps found.
- **BP-08**: Config snapshot semantics respected (no hot-reload). Not directly
  in scope but not contradicted.
- **BP-Product-Strategy**: Desktop-as-client boundary preserved. No desktop
  logic introduced.

---

## Codex Decisions Needed

1. **No blocking decisions remain.** The lifecycle lane is clean. Codex can
   move `W1-LIFECYCLE-01` to `approved`.

2. **Follow-up items (informational, not blocking):**
   - D1: Add a one-line comment explaining the 2s/15s stop timeout asymmetry.
   - D2: `status.ts` v1 Store API bridge — absorbed when v2 store lands.
   - Deeper `runguard.ts` unit tests (direct tests for `detectActiveOwner`,
     `resolveRuntimeState`, PID file edge cases) would strengthen confidence.
     Suggest folding into a future test-hardening pass.
