# W3-RECOVERY-01: Poisoned Local Store Detection and Reset Guidance

## Role

Codex worker packet.

## Goal

Detect the unrecoverable local SQLite failure signature exposed by the E2E run
and replace raw SQLite errors with explicit experimental-reset guidance.

This packet exists because the runtime can currently leave local state in a
broken condition after the RSS hard shutdown:

- `SQLiteError: attempt to write a readonly database`
- `SQLiteError: unable to open database file`

For experimental v2, the right product behavior is to tell the user to hard
reset local state, not to attempt in-place migration or silent repair.

## Depends On

- `W3-RUNTIME-01-live-runtime-store-cutover.md`
- `W3-E2E-01-persona-cuj-local-postgres.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`

## Unblocks

- understandable recovery behavior after RSS-triggered local-store failure
- cleaner experimental dogfood instructions
- less time wasted debugging poisoned local SQLite state

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/blueprint/BP-05-store-and-migration.md`
5. `docs/blueprint/BP-07-process-lifecycle.md`
6. `docs/execution/tasks/W3-RECOVERY-01-poisoned-local-store-reset-guidance.md`
7. `docs/execution/experimental-v2-reset-and-install.md`
8. `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
9. Current code:
   - `src/db/store.ts`
   - `src/db/schema.ts`
   - `src/commands/start.ts`
   - `src/commands/ingest.ts`
   - `src/commands/status.ts`
   - focused store/runtime tests under `test/`

## Owned Files

- `src/db/**`
- `src/commands/start.ts`
- `src/commands/ingest.ts`
- `src/commands/status.ts` only if needed to surface the issue cleanly
- focused recovery/store tests under `test/`
- `docs/execution/experimental-v2-reset-and-install.md`

## Forbidden Files

- `src/contracts/**`
- `src/sinks/**`
- adapter parser rewrites
- Team/bootstrap/product-surface redesign
- automatic destructive reset commands

## Frozen Contracts

- BP-05 store shape
- BP-07 lifecycle ownership semantics
- the experimental policy that local state is disposable but not silently
  deleted by the daemon

## Deliverables

- detect the packet-defined poisoned-store signature on startup and one-shot
  ingest paths
- emit a clear reset message that tells the user to remove `~/.config/jin`
  instead of surfacing raw SQLite stack traces
- focused tests proving the mapped recovery guidance
- update the existing reset/install runbook only as needed to match the new
  runtime messaging

## Non-Goals

- in-place SQLite repair
- automatic WAL/SHM cleanup
- a new `jin reset-local` command
- changing the local store schema

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Experimental v2 local-store recovery behavior is explicit and actionable | BP-05 | `src/db/**`, `src/commands/start.ts`, `src/commands/ingest.ts`, focused tests |
| Lifecycle commands surface actionable next steps instead of raw low-level errors | BP-07 | command output/tests |
| The packet does not silently delete local state or introduce automatic repair magic | BP-05, BP-07 | diff scope, completion report |
| Reset guidance stays aligned with the runbook in `docs/execution/experimental-v2-reset-and-install.md` | execution docs | code + doc citation |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

- no prior v1 surface

## Acceptance Checks

- poisoned-store startup or one-shot ingest emits a clear reset message
- the output tells the user exactly what local path to remove
- the command exits cleanly without a raw Bun/SQLite stack trace

## Stop And Escalate

Stop if:

- the smallest safe fix requires automatic destructive actions
- the runtime can only recover by changing BP-05 store semantics
- the bug turns out to require packet-external lifecycle redesign

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- no prior v1 surface

BP alignment:
- BP-05/BP-07: poisoned local state now produces explicit experimental reset guidance

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
