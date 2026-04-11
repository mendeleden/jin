# Review: W1-LIFECYCLE-01 — Runtime Boundary (Round 2)

- reviewer: `cursor-REVIEWER-runtime-boundary`
- packet: `W1-LIFECYCLE-01`
- date: `2026-04-01`
- verdict: **conditionally approved — one blocking finding remains, one prior blocking finding resolved**

---

## Scope of Review

Re-review after the worker's second pass. Read all files listed in the
packet's "Read In Order" section, the frozen contract surface, the live
control plane state, and the worker heartbeat. Compared implementation
against BP-07 lifecycle ownership, BP-08 config snapshot semantics, and
BP-Product-Strategy daemon/desktop boundary.

Files reviewed:
- `src/lifecycle.ts` (modified)
- `src/runguard.ts` (modified)
- `src/commands/start.ts` (modified)
- `src/commands/stop.ts` (modified)
- `src/commands/status.ts` (modified)
- `src/commands/service.ts` (modified)
- `src/sinks/webhook.ts` (modified — **forbidden file, unchanged from R1**)
- `test/lifecycle-boundary.test.ts` (new — lifecycle tests added)
- `test/webhook-sink.test.ts` (new — outside lifecycle lane, unchanged from R1)
- `src/contracts/lifecycle.ts`, `src/contracts/config.ts`, `src/contracts/pipeline.ts` (frozen — unchanged ✓)

Tests run:
- `bun test test/lifecycle-boundary.test.ts` — 5/5 pass

---

## Blocking Findings

### B1. Boundary Violation: `src/sinks/webhook.ts` and `test/webhook-sink.test.ts` (carried from R1)

The packet explicitly lists `src/sinks/**` as forbidden. The worker rewrote
the webhook sink (v2 snapshot push, idempotency keys, timeout handling,
partial batch failure parsing) and added a 268-line webhook test file. This
work belongs in `W1-SINK-01`. Global rule §3 (boundary discipline) is
violated.

**Recommendation:** Codex should either:
1. Revert the webhook changes from this branch and land them via `W1-SINK-01`, or
2. Retroactively expand `W1-SINK-01` scope to acknowledge this work already
   landed, so the lifecycle branch can merge as-is.

This is a process/boundary finding, not a code quality finding. The webhook
implementation itself is well-structured and BP-06 compliant per the
`W1-SINK-01` review.

---

## Resolved from R1

### B2 (R1). No Lifecycle Tests — **RESOLVED**

The worker added `test/lifecycle-boundary.test.ts` with 5 focused tests:

| Test | Acceptance Check |
|------|-----------------|
| `starting a second detached owner is blocked` | ✓ AC #1 |
| `service-owned runtime is reported instead of spawning a daemon` | ✓ AC #2 |
| `service install path waits for the existing owner to stop` | ✓ AC #2 (install variant) |
| `stop behaves like a bounded control-plane action` | ✓ AC #4 |
| `status works while stopped` | ✓ AC #3 |

All 5 tests pass. The tests properly mock `lifecycle.ts`, `runguard.ts`,
`watch.ts`, `service.ts`, and `config.ts` to isolate command-level behavior.
The mock structure is clean and the assertions directly verify the acceptance
checks from the packet.

**Coverage note:** The tests exercise the command surface (`startCommand`,
`stopCommand`, `statusCommand`) through mocks. They do not exercise
`runguard.ts` internals (e.g., `detectActiveOwner`, `resolveRuntimeState`,
`readPersistedRuntimeState`) directly. This is acceptable for the packet's
acceptance checks but leaves room for deeper unit tests in a follow-up.

---

## Aligned

### BP-07 Core Invariants

| Invariant | Status | Evidence |
|-----------|--------|----------|
| One long-lived owner per store | ✓ | `start.ts:67-77` blocks second owner, reports mode |
| Single coordinator | ✓ | Ownership detection in `runguard.ts:230-256` |
| Query without daemon | ✓ | `status.ts` reads store directly, works when stopped |
| Shared runtime path | ✓ | Foreground/daemon/service use same pipeline entry |
| Desktop is client | ✓ | No desktop logic added |
| Config snapshot at start | ✓ | No hot-reload introduced |

### BP-07 Lifecycle State Model

All five states implemented in `runguard.ts:198-228`:
- `stopped` — no active owner detected
- `starting` — written by `markRuntimeStarting`, grace period of 10s
- `running` — written by `markRuntimeRunning`, degraded if issues present
- `degraded` — issues array non-empty
- `stopping` — written by `markRuntimeStopping`

State resolution logic correctly handles:
- Stale `starting` state (grace period expiry → promote to running/degraded)
- Owner drift detection (PID/mode change → rewrite persisted state)
- Orphaned persisted state (process dead → clear to stopped)

### BP-07 Lifecycle Commands

| Command | BP-07 Behavior | Implementation |
|---------|---------------|----------------|
| start | reports no-op if running, blocks second owner, reports service precedence | ✓ `start.ts:67-82` |
| stop | no-op if stopped, signal+bounded wait, service-aware | ✓ `stop.ts` + `lifecycle.ts:89-178` |
| restart | stop then start | ✓ `start.ts:102-139` |
| status | works when stopped, shows mode/health/issues | ✓ `status.ts` |

### BP-07 Shutdown

- `stopWatcher` sends SIGTERM, polls exit with bounded `waitForExitMs` (default 2s)
- Optional `forceAfterTimeout` escalates to SIGKILL
- `markRuntimeStopping` writes state before signaling
- Service mode routes through `requestServiceStop` (platform-specific)
- `waitForServiceStop` capped to `SHUTDOWN_DRAIN_TIMEOUT_MS` (15s from contract)

### Frozen Contract Compliance

No files under `src/contracts/` were modified. The implementation correctly
imports and uses contract types:
- `RuntimeMode`, `RuntimeState`, `RuntimeOwnershipRecord`, `RuntimeIssue`,
  `RuntimeStatus` from `contracts/lifecycle.ts`
- `SHUTDOWN_DRAIN_TIMEOUT_MS` (15s) from `contracts/lifecycle.ts`
- `DEFAULT_WEBHOOK_TIMEOUT_MS` from `contracts/config.ts` (in webhook — forbidden file)

---

## Drift

### D1. `DEFAULT_STOP_WAIT_MS` vs `SHUTDOWN_DRAIN_TIMEOUT_MS` (carried from R1, informational)

`lifecycle.ts:20` defines `DEFAULT_STOP_WAIT_MS = 2_000` as the default
wait for `stopWatcher`. `jin stop` (default path) waits 2s then returns
"still stopping," while `jin restart` (`start.ts:121-124`) waits the full
15s (`SHUTDOWN_DRAIN_TIMEOUT_MS`).

This asymmetry is defensible: `stop` is a quick control-plane action that
reports status, while `restart` must wait for exit before re-starting.
Adding a code comment would help future readers. Not blocking.

### D2. `status.ts` still uses v1 Store API (carried from R1, informational)

`status.ts:222-230` calls `store.sessionCount()`, `store.messageCount()`,
and `store.analyzeByAdapter()` — v1 Store methods. Expected to be absorbed
when v2 store integration lands. Not blocking for this packet.

---

## Unowned Spread

The webhook sink changes (`src/sinks/webhook.ts` + `test/webhook-sink.test.ts`)
remain the only unowned spread. All other changes are within the packet's
owned file list.

---

## Progress

### Acceptance Checks

| Check | Status |
|-------|--------|
| Starting a second long-lived owner is blocked | ✓ tested |
| Service-owned runtime is reported instead of spawning a daemon | ✓ tested |
| Status works while stopped | ✓ tested |
| Stop behaves as a control-plane action, not an unbounded wait | ✓ tested |
| Tests cover ownership checks and service precedence | ✓ 5 tests passing |

### BP Alignment Summary

- **BP-07**: Well-aligned. Ownership model, lifecycle state machine,
  start/stop/restart/status commands, shutdown semantics, and service
  precedence all match the blueprint. All acceptance checks pass with tests.
- **BP-08**: Not directly in scope; config snapshot semantics respected.
- **BP-Product-Strategy**: Desktop-as-client boundary preserved.

---

## Codex Decisions Needed

1. **Webhook sink boundary violation (B1)**: The only remaining blocking
   finding. The webhook code is good but lives in a forbidden file. Options:
   - (a) Revert webhook changes from this branch, merge lifecycle-only.
   - (b) Accept as-is, note in `W1-SINK-01` that webhook is already landed.
   - Recommendation: option (b) — the work is done, tested, and reviewed.
     Moving it backwards adds risk for no user benefit. Just update
     `W1-SINK-01` scope to reflect reality.

2. **Deeper runguard unit tests (informational)**: The current tests mock
   runguard entirely and test command behavior. Direct unit tests for
   `detectActiveOwner`, `resolveRuntimeState`, PID file handling, and
   service detection would strengthen confidence. Suggest a follow-up test
   packet or fold into `W1-LIFECYCLE-01` if Codex wants them before merge.

3. **Stop timeout asymmetry (D1, informational)**: Worth a one-line comment
   in `lifecycle.ts` explaining why `DEFAULT_STOP_WAIT_MS` differs from
   `SHUTDOWN_DRAIN_TIMEOUT_MS`. Can be done in a cleanup pass.
