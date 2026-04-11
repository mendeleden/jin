# W3-ADAPTER-10: Cursor Live Layer3 Decode And Revalidation

## Role

Codex worker packet.

## Goal

Fix the remaining live Cursor correctness failures from `W3-VALIDATE-01`:

1. real local Cursor refs all load as null bundles
2. the shared global Cursor DB at
   `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
   cannot be opened by the current adapter/runtime path

This lane exists because the validation audit and fresh local probes now show a
narrow, likely adapter-local mismatch:

- live layer3 `store.db` files are readable
- the current layer3 loader assumes `blobs.data` is JSON text
- the documented Cursor format and current live sample both show mixed JSON and
  protobuf-framed blob rows

## Depends On

- `.execution/packets/W2-ADAPTER-03.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`

## Unblocks

- clean Cursor live validation on the real local dataset
- honest sequencing before sink reconciliation
- workspace-member / `userId` work on a cleaner multi-adapter ingestion baseline

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-ADAPTER-10-cursor-live-layer3-decode-and-revalidation.md`
6. `docs/adapters/cursor/index.md`
7. `docs/adapters/cursor/overview.md`
8. `docs/adapters/cursor/investigation.md`
9. `docs/adapters/cursor/orchestration.md`
10. `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
11. Current code:
   - `src/adapters/cursor.ts`
   - `test/cursor-adapter.test.ts`
   - `scripts/live-validation/run.ts`
   - `test/live-validation/run.test.ts`

## Owned Files

- `src/adapters/cursor.ts`
- `test/cursor-adapter.test.ts`
- `scripts/live-validation/run.ts` only if needed for narrower Cursor-only proof
- `test/live-validation/run.test.ts` only if the harness behavior changes
- packet-local audits under `docs/execution/audits/`

## Forbidden Files

- `src/contracts/**`
- `src/pipeline/**`
- `src/sinks/**`
- non-Cursor adapter files
- workspace identity / `userId` design work
- structural adapter decomposition unless Codex explicitly widens the lane

## Frozen Contracts

- adapter v2 interface
- parsed output shapes
- relationship semantics
- store / sink / pipeline contracts

## Deliverables

- root-cause why live layer3 Cursor refs currently load as null bundles
- fix the live layer3 decode path if the smallest safe fix remains adapter-local
- decide whether the unreadable layer1 global DB is:
  - a non-blocking degraded path that should warn and continue, or
  - a real packet blocker for live Cursor confidence
- add focused regression tests for the discovered live layer3 format mismatch
- rerun the live validation harness for `cursor` on the real local dataset
- write a packet-local audit with exact commands, counts, and residual issues

## Non-Goals

- solving OS-level TCC / Full Disk Access outside Jin if the file is simply not
  readable from Bun on this workstation
- sink or release workflow changes
- `userId` / team identity work
- broad `cursor` adapter maintainability refactors

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Live Cursor layer3 refs on the real local dataset no longer collapse into null bundles because of an adapter-local decode mismatch | BP-04 | code diff + focused tests + live audit |
| Unreadable layer1 global DB does not falsely prevent clean layer3 validation; the adapter either degrades honestly or fixes the open path without widening contracts | BP-02, BP-04 | code diff + live audit |
| The lane stays inside Cursor adapter/harness owned files and does not widen into store/sink/contracts | BP-02, BP-04, BP-05, BP-06 | diff scope |
| Cursor-only live validation records exact discovered / loaded / null / written counts and states clearly whether the layer1 DB-open issue still matters | BP-04, BP-10 | packet-local audit |

## Acceptance Checks

- a focused regression test reproduces the live layer3 decode mismatch or the
  closest fixture-scale analogue
- completion report states whether the layer1 global DB-open failure is still a
  packet blocker after the layer3 fix
- the Cursor-only live validation rerun records exact counts for:
  - refs discovered
  - bundles loaded
  - null bundles
  - unique conversations loaded
  - write attempts / write errors
  - stored conversations / messages / tool calls

## Stop And Escalate

Stop if:

- the smallest safe fix requires store/sink/contract changes
- the real layer3 format requires a new external dependency or parser strategy
  that changes repo-level policy
- the only way to pass the lane is an operator-level OS permission change
  outside Jin and there is no honest degraded-path design inside packet scope

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation run:
- exact live/local commands
- layer3 decode outcome
- layer1 DB-open outcome

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test or artifact>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
