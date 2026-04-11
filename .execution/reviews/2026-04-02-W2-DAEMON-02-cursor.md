# Review: W2-DAEMON-02 — Local Control Boundary

- reviewer: `cursor-REVIEWER-local-control-boundary`
- packet: `W2-DAEMON-02`
- date: `2026-04-02`
- verdict: **approved — no blocking findings**

---

## Scope of Review

Audited the new local control/status boundary in `src/api/control.ts`, the
route wiring in `src/api/routes.ts`, and the boundary test in
`test/local-control-boundary.test.ts` against:

- `docs/execution/tasks/W2-DAEMON-02-local-control-boundary.md` (task packet)
- `docs/blueprint/BP-07-process-lifecycle.md` (primary blueprint — daemon
  boundary, ownership, lifecycle commands, health model, Desktop-as-client)
- `docs/blueprint/BP-Product-Strategy.md` (Desktop is surface over daemon,
  no second runtime)
- `src/contracts/lifecycle.ts` (frozen types and constants)
- `src/lifecycle.ts` (lifecycle component state, used by control boundary)
- `src/runguard.ts` (runtime status, paths — read-only reference)

Files reviewed line-by-line:

- `src/api/control.ts` (223 lines, new)
- `src/api/routes.ts` lines 1–66 (control route wiring, modified)
- `test/local-control-boundary.test.ts` (207 lines, new)

Frozen contracts verified unchanged:

- `src/contracts/lifecycle.ts` — `RuntimeState`, `RuntimeMode`,
  `RuntimeOwnershipRecord`, `RuntimeIssue`, `RuntimeStatus` all consumed
  read-only ✓

Forbidden directories verified untouched:

- `src/pipeline/**` ✓
- `src/db/**` ✓
- `src/adapters/**` ✓
- `src/sinks/**` ✓
- Desktop or dashboard UI code ✓

Tests run:

- `bun test test/local-control-boundary.test.ts` — 4 pass, 0 fail, 24 expect()

---

## Blocking Findings

None.

---

## Aligned

### BP-07: Daemon ↔ Desktop Boundary — What Belongs

BP-07 §"Daemon ↔ Desktop Boundary" specifies the boundary should expose:

| Required on boundary | Implementation | Evidence |
|---------------------|----------------|----------|
| Lifecycle control: start, stop, restart | ✓ | `routes.ts:52-65` — `POST /api/control/{start,stop,restart}` |
| Runtime status: mode, pid, uptime, state | ✓ | `control.ts:108-142` — `getLocalControlStatus()` returns `runtime.state`, `runtime.owner` (mode, pid, startedAt), uptime via components |
| Health summary: active adapters, adapter errors, sink readiness, queue/backlog | Partial ✓ | `control.ts:121-138` — `health.status`, `health.ingest`, `health.push`, `health.issueCount`, `health.issueSubsystems`, `health.paused`, component counts |

The health summary covers ingest/push subsystem status and component
readiness. Per-adapter and per-sink detail is not exposed — this is
appropriate because the boundary sources from `RuntimeIssue[]` which
provides subsystem-level granularity. Deeper adapter/sink introspection
would require pipeline imports (forbidden for this packet).

### BP-07: What Does NOT Belong on the Boundary

| Must NOT be on boundary | Verified absent |
|------------------------|-----------------|
| Duplicate ingestion logic | ✓ — no adapter or ingest imports |
| Second watcher implementation | ✓ — no watcher imports |
| Direct sink control inside Desktop | ✓ — no sink imports |
| Backend-specific Team migration | ✓ — no team/migration code |

### BP-07: Control Actions Delegate Through CLI

The critical design choice: `control.ts:144-161` delegates lifecycle actions
by spawning the jin CLI binary (`Bun.spawnSync(buildLifecycleCommand(action))`).
This means:

1. All ownership checks in `start.ts`, `stop.ts` are reused — not duplicated ✓
2. The API boundary never becomes a second runtime ✓
3. Service precedence messaging flows through the CLI entrypoints ✓

`buildLifecycleCommand()` at `control.ts:163-177` correctly handles both
compiled binary and `bun run` development paths.

### BP-07: Status Works While Stopped

`getLocalControlStatus()` reads from `getRuntimeStatus()` (runguard) and
`getAllState()` (lifecycle) — both are read-only filesystem inspections that
work regardless of daemon state. No daemon process is required for status
reporting. Test: `"reports stopped runtime status without starting a hidden runtime"` ✓

### BP-07: Runtime Health Model (5 States)

The `LocalControlHealthStatus` type maps to the 5-state BP-07 model:

| BP-07 State | Control Boundary | Evidence |
|-------------|-----------------|----------|
| `stopped` | `"stopped"` | `summarizeHealthStatus()` case `"stopped"` |
| `starting` | `"starting"` | `summarizeHealthStatus()` case `"starting"` |
| `running` | `"healthy"` | `summarizeHealthStatus()` — `running` + no issues → `healthy` |
| `degraded` | `"degraded"` | `summarizeHealthStatus()` — `degraded` or `running` + issues |
| `stopping` | `"stopping"` | `summarizeHealthStatus()` case `"stopping"` |

The boundary renames `running` → `healthy` for the health summary level.
This is a reasonable DTO distinction — the runtime state itself is preserved
verbatim in `status.runtime.state`. Not a drift.

### BP-07: Subsystem-Level Degradation

BP-07 §"Runtime Health Model" requires: "status reporting should distinguish
ingest-side degradation, push-side degradation, both."

`control.ts:197-212` — `summarizeSubsystem()` filters `RuntimeIssue[]` by
`subsystem` field and returns `"inactive"` / `"healthy"` / `"degraded"` /
`"paused"` per subsystem. Test: `"reports degraded runtime health with
subsystem detail"` verifies `push: "paused"`, `ingest: "healthy"` ✓

### BP-Product-Strategy: Desktop is Client, Not Runtime

The entire boundary is read-only inspection + delegated CLI invocations.
No pipeline logic, no store mutations, no adapter parsing. A Desktop app
consuming these endpoints would be a pure client of the daemon boundary,
exactly as BP-Product-Strategy §5 requires.

### Frozen Contract Compliance

`control.ts` imports from `contracts/lifecycle`:
- `RuntimeIssue` (type only) ✓
- `RuntimeOwnershipRecord` (type only) ✓
- `RuntimeState` (type only) ✓

No frozen contract files modified.

### Boundary Discipline

Only packet-owned files created/modified:

- `src/api/control.ts` (new) ✓
- `src/api/routes.ts` (modified — added control route wiring + imports) ✓
- `test/local-control-boundary.test.ts` (new) ✓

No forbidden files touched. `src/lifecycle.ts` and `src/runguard.ts` are
imported but not modified.

### Test Coverage vs Acceptance Checks

| # | Acceptance Check (from packet) | Test | Status |
|---|-------------------------------|------|--------|
| 1 | Boundary exposes lifecycle/status without duplicating ingestion | `"reports stopped runtime status without starting a hidden runtime"` — status works with no runtime; `"control routes delegate lifecycle actions instead of becoming a runtime"` — actions shell out to CLI | ✓ |
| 2 | Client-triggered control flows respect ownership rules | `"control routes delegate lifecycle actions"` — start against service-owned runtime returns 409 with service owner info | ✓ |
| 3 | Tests cover stopped status reporting | `"reports stopped runtime status"` — verifies `stopped`, `inactive` subsystems, paths | ✓ |
| 4 | Tests cover running status reporting | `"reports running runtime health for local clients"` — verifies `running`, `healthy`, component counts | ✓ |
| 5 | Tests cover degraded status reporting | `"reports degraded runtime health with subsystem detail"` — verifies `degraded`, `paused` push, issue subsystems | ✓ |

All five acceptance checks are covered by the 4 tests.

---

## Drift

### I1 — `routes.ts` still accepts a legacy `store: unknown` first parameter (informational)

- **File:** `routes.ts:37-41`
- **Finding:** `createRoutes()` takes `store: unknown` as its first
  parameter and immediately `void`s it. The actual query store comes from
  `options.queryStore ?? getStore(configDir())`. This is a bridge from the
  v1 `server.ts` call site (`createRoutes(store)` at `server.ts:46`). The
  control boundary correctly uses the `options` path, so this does not
  affect the new code.
- **Severity:** Informational. Expected bridge — will be cleaned up when
  `server.ts` is updated to the v2 pattern. Not blocking.

### I2 — `ComponentState` type duplicated between `lifecycle.ts` and `control.ts` (informational)

- **File:** `lifecycle.ts:22-31`, `control.ts:25-34`
- **Finding:** `LocalControlComponentDto` in `control.ts` mirrors
  `ComponentState` in `lifecycle.ts` field-for-field. The DTO spreads
  component state via `getAllState().map(c => ({ ...c }))` at
  `control.ts:111`. This works because the shapes are identical, but it's
  a structural coupling rather than a type import. If `ComponentState` adds
  a field, the DTO silently includes it without the type system catching
  the change.
- **Severity:** Informational. The shallow copy approach is pragmatic for
  now and avoids adding a cross-boundary type dependency. A future cleanup
  could either re-export the type or add an explicit mapping function. Not
  blocking.

### I3 — `executeLifecycleAction` uses synchronous `Bun.spawnSync` in an async route handler (informational)

- **File:** `control.ts:148-161`
- **Finding:** `executeLifecycleAction()` calls `Bun.spawnSync()` which
  blocks the event loop for the duration of the CLI command. For `stop`
  with a default 2s wait and `restart` with a potential 15s wait, this
  could block the API server's ability to handle other requests (including
  concurrent status polls from a Desktop client).
- **Severity:** Informational. For the initial boundary this is acceptable —
  lifecycle commands are infrequent and the API server has no other
  long-running handlers. A future improvement could use `Bun.spawn()`
  (async) with stdout/stderr collection. Not blocking.

---

## Unowned Spread

None.

All new code is under `src/api/` and `test/`. No forbidden files touched.
The boundary imports from `src/lifecycle.ts` and `src/runguard.ts` but does
not modify them.

---

## Progress

### BP Alignment Summary

- **BP-07**: `mostly_aligned` (strengthened) — the Daemon ↔ Desktop boundary
  section is now directly implemented. Lifecycle control delegation,
  status-while-stopped, 5-state health model with subsystem detail, and
  the "no second runtime" invariant are all in place and tested.
  Deferred: per-adapter/per-sink detail in health summary (requires pipeline
  integration, out of scope for this boundary packet).

- **BP-Product-Strategy**: `frozen` (unchanged) — Desktop-as-client boundary
  preserved. The control boundary is a pure read + delegate surface.

---

## Codex Decisions Needed

1. **No blocking decisions remain.** The implementation is clean, tested,
   and aligned to BP-07 and BP-Product-Strategy. Codex can move
   `W2-DAEMON-02` to `approved`.

2. **Follow-up items (informational, not blocking):**
   - I1: Remove the legacy `store: unknown` first parameter from
     `createRoutes()` when `server.ts` is updated to v2.
   - I2: Consider re-exporting `ComponentState` from `lifecycle.ts` to
     replace the structurally-coupled `LocalControlComponentDto`, or add
     an explicit mapping function.
   - I3: Replace `Bun.spawnSync()` with async `Bun.spawn()` in
     `executeLifecycleAction()` to avoid blocking the event loop during
     restart (up to 15s). Low priority for initial boundary.
