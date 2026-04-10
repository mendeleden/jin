# W3-PERF-02: Full Runtime RSS / Shutdown Flush Budget

## Role

Codex worker packet.

## Goal

Fix the remaining real-workload runtime RSS failure that still kills the local
`0.8.3` daemon/service even after `W3-PERF-01`.

This packet exists because the approved Codex-only ingest fix was necessary but
not sufficient. The real daemon on this machine still dies during the full
runtime path:

- `RSS 260 MB exceeded the 256 MB hard limit during ingest batch for adapter codex (149/186)`
- `RSS 290 MB exceeded the 256 MB hard limit during pipeline work item ingest-adapter`
- `RSS 290 MB exceeded the 256 MB hard limit during pipeline work item shutdown-flush`

Disabling the uninitialized local Postgres sink did not change the outcome.
This is now a real runtime/shutdown/perf blocker, not a sink bootstrap issue.

## Depends On

- `docs/execution/tasks/W3-PERF-01-codex-ingest-rss-budget.md`
- `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md`
- `docs/execution/audits/2026-04-07-W3-E2E-01-persona-local-postgres.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`

## Unblocks

- stable local foreground/service runtime on the real workload
- actual daemon-to-Postgres validation against Railway
- honest `0.8.3` experimental dogfood

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-07-process-lifecycle.md`
7. `docs/execution/tasks/W3-PERF-02-full-runtime-rss-shutdown-flush.md`
8. `docs/execution/tasks/W3-PERF-01-codex-ingest-rss-budget.md`
9. `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md`
10. `docs/execution/audits/2026-04-07-W3-E2E-01-persona-local-postgres.md`
11. `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
12. Current code:
   - `src/pipeline/loop.ts`
   - `src/pipeline/ingest.ts`
   - `src/pipeline/push.ts`
   - `src/commands/watch.ts`
   - `src/db/bundle.ts`
   - `src/db/store.ts`
   - `src/adapters/codex.ts`
   - `src/adapters/gemini-cli.ts`
   - focused runtime/perf tests under `test/`

## Owned Files

- `src/pipeline/loop.ts`
- `src/pipeline/ingest.ts`
- `src/pipeline/push.ts`
- `src/commands/watch.ts`
- `src/db/bundle.ts`
- `src/db/store.ts`
- `src/adapters/codex.ts`
- `src/adapters/gemini-cli.ts` only if required by the proven fix
- focused runtime/perf tests under `test/`
- packet-local audit evidence under `docs/execution/audits/`

## Forbidden Files

- `src/contracts/**`
- `src/sinks/**`
- `src/commands/team-config.ts`
- `src/commands/schema.ts`
- `src/commands/connect.ts`
- product/UI/TUI cleanup
- version bump / service plist / PR prep work

## Frozen Contracts

- BP-02 serial coordinator, queue, bounded shutdown, and RSS guard ownership
- adapter v2 bundle contract
- sink push payload/result contract
- BP-07 single-owner lifecycle semantics

## Deliverables

- full RCA for why the real daemon still exceeds the RSS budget after
  `W3-PERF-01`
- the smallest safe fix that keeps the live runtime below the `256 MB`
  hard limit on the representative local workload
- durable validation artifact for the real workload, not only a packet-local
  `ingestOne(...)` harness
- focused regression coverage for the discovered retention path
- explicit statement whether the fix restores real push-to-Postgres validation

## Non-Goals

- raising the RSS hard limit
- weakening or removing the BP-02 kill switch
- broad adapter rewrites beyond the proven retention path
- sink bootstrap or Team/operator work
- repairing the poisoned local store beyond the already-approved reset guidance

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Runtime still enforces BP-02 warning/hard-limit semantics | BP-02 | `src/pipeline/loop.ts`, focused tests |
| Real workload no longer trips the hard limit during `ingest-adapter` / `shutdown-flush` on the installed/local runtime path | BP-02, BP-07 | durable audit artifact + focused validation |
| The fix does not widen frozen adapter or sink contracts | BP-04, BP-06 | diff scope, no contract edits |
| Single-owner daemon/service lifecycle semantics remain intact | BP-07 | completion report + focused validation |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

- compare the pre-fix real-daemon behavior against the fixed path:
  - startup and watcher ownership unchanged
  - only memory retention / shutdown behavior changes
  - no intended change to sink routing or Team/bootstrap semantics

## Acceptance Checks

- representative local-runtime validation no longer logs the RSS hard-limit
  failure for `ingest-adapter` or `shutdown-flush`
- the BP-02 hard limit is still enforced when intentionally exceeded in
  focused validation
- completion report states clearly whether Railway push rows were observed after
  the fix

## Stop And Escalate

Stop if:

- the smallest safe fix requires changing frozen contracts
- the root cause is inside sink internals rather than runtime/adapter/store
  retention
- the real-workload validation requires product-surface changes outside the
  owned files

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation run:
- exact local-runtime / installed-binary commands
- observed RSS / log outcome
- observed remote Postgres row counts

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- parity kept / intentional runtime-retention fix / deferred regression

BP alignment:
- BP-02/BP-07: ...

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
