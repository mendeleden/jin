# W3-PERF-01: Codex Ingest RSS Budget

## Role

Codex worker packet.

## Goal

Bring the live Codex ingest path back under the BP-02 RSS budget on a real
local dataset without weakening the hard-limit guard.

This packet exists because installed-binary validation showed the runtime
repeatedly exceeding the `256 MB` hard limit during Codex ingest:

- `RSS 960 MB exceeded the 256 MB hard limit during ingest batch for adapter codex`
- `RSS 976 MB exceeded the 256 MB hard limit during ingest batch for adapter codex`

That is the current release-blocking runtime bug.

## Depends On

- `W3-RUNTIME-01-live-runtime-store-cutover.md`
- `W3-E2E-01-persona-cuj-local-postgres.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`

## Unblocks

- successful foreground/service runtime on a real Codex local dataset
- honest experimental dogfood of the installed binary
- meaningful daemon-to-Postgres E2E validation

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-07-process-lifecycle.md`
7. `docs/execution/tasks/W3-PERF-01-codex-ingest-rss-budget.md`
8. `docs/execution/audits/2026-04-07-W3-E2E-01-persona-local-postgres.md`
9. `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
10. Current code:
   - `src/adapters/codex.ts`
   - `src/pipeline/ingest.ts`
   - `src/pipeline/loop.ts`
   - `src/commands/benchmark.ts`
   - focused runtime/perf tests under `test/`

## Owned Files

- `src/adapters/codex.ts`
- `src/pipeline/ingest.ts`
- `src/pipeline/loop.ts`
- `src/commands/benchmark.ts` only if needed for packet-local validation
- focused Codex/pipeline/perf tests under `test/`

## Forbidden Files

- `src/contracts/**`
- `src/sinks/**`
- `src/commands/team-config.ts`
- `src/commands/schema.ts`
- `src/commands/connect.ts`
- broad product/UI work

## Frozen Contracts

- BP-02 pipeline ownership and shutdown semantics
- adapter v2 bundle contract
- sink push payload/result contract
- BP-07 single-owner lifecycle semantics

## Deliverables

- Codex ingest no longer trips the `256 MB` hard limit on the representative
  packet-local validation path
- the fix reduces peak memory by changing batching / parsing / retention
  behavior, not by simply raising the limit or disabling the guard
- focused regression coverage or benchmark evidence proving the memory profile
  improvement
- a clear statement of what representative data path was used to validate the
  fix

## Non-Goals

- raising the RSS hard limit
- removing the BP-02 kill switch
- Team/Postgres onboarding work
- generic adapter rewrites outside Codex

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Pipeline checks still enforce the BP-02 RSS warning/hard-limit behavior | BP-02 | `src/pipeline/loop.ts`, focused tests |
| Codex ingest work is batched or streamed so peak RSS stays within the budget on representative validation input | BP-02 | `src/adapters/codex.ts`, `src/pipeline/ingest.ts`, focused tests/benchmark |
| The fix does not widen adapter or sink contracts | BP-04, BP-06 | diff scope, no contract edits |
| Runtime lifecycle semantics remain the same apart from avoiding kill-switch shutdown on normal ingest | BP-07 | completion report + focused validation |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

- compare the pre-fix Codex ingest behavior against the fixed path:
  - whether the same refs/conversations still load
  - whether the only intended change is peak-memory behavior and shutdown
    avoidance

## Acceptance Checks

- packet-local validation no longer logs the RSS hard-limit failure during the
  representative Codex ingest path
- the hard limit is still enforced if intentionally exceeded in focused
  validation
- the completion report states clearly whether this is sufficient to rerun the
  installed-binary E2E path

## Stop And Escalate

Stop if:

- the only viable fix requires changing frozen contracts
- the smallest safe fix requires widening into store-recovery or sink-internal
  work
- representative validation cannot be made packet-local and needs a different
  harness decision from Codex

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
- parity kept / intentional perf-only change / deferred regression

BP alignment:
- BP-02/BP-07: Codex ingest stays inside the runtime budget without changing lifecycle rules

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
