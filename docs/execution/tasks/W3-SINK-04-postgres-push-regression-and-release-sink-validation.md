# W3-SINK-04: Postgres Push Regression and Release Sink Validation

## Role

Codex worker packet.

## Goal

Fix the current Postgres push regression exposed by the clean-start litmus and
leave behind a repeatable validation path that proves sink delivery to both a
local Postgres destination and a remote Postgres destination.

This lane exists because the current runtime can bootstrap sinks, build a clean
SQLite store, and still deliver zero rows to every configured Postgres sink.

## Depends On

- `docs/blueprint/BP-06-sink-contract.md`
- `docs/execution/audits/2026-04-08-clean-start-postgres-push-regression.md`
- `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
- `docs/execution/audits/2026-04-08-W3-PERF-02-full-runtime-rss-shutdown-flush.md`

## Unblocks

- actual local+remote Postgres row delivery from a fresh-start config
- honest release validation for sink health
- future extension of the same release gate to other sink families

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-05-store-spine.md`
7. `docs/blueprint/BP-06-sink-contract.md`
8. `docs/blueprint/BP-10-performance-validation.md`
9. `docs/execution/tasks/W3-SINK-04-postgres-push-regression-and-release-sink-validation.md`
10. `docs/execution/audits/2026-04-08-clean-start-postgres-push-regression.md`
11. `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
12. Current code:
   - `src/sinks/postgres.ts`
   - `src/pipeline/push.ts`
   - `src/db/store.ts`
   - `test/postgres-reference-sink.test.ts`
   - any focused release/sink validation tests you add

## Owned Files

- `src/sinks/postgres.ts`
- `test/postgres-reference-sink.test.ts`
- `src/pipeline/push.ts` only if the proven fix requires a packet-local
  pipeline call-site adjustment
- `src/db/store.ts` only if required for `_jin_push_state` correctness under
  the proven fix
- packet-local audits under `docs/execution/audits/`

## Forbidden Files

- `src/contracts/**`
- adapter files
- Team/bootstrap command surface
- version bump / PR / UI work
- broad runtime RSS redesign outside the proven sink fix

## Frozen Contracts

- BP-06 sink interface and ownership
- BP-05 store revision / push-state contract
- BP-02 serial pipeline ownership of retry and eligibility

## Deliverables

- root cause for the current Postgres push failure:
  - `Only use sql.begin, sql.reserved or max: 1`
- the smallest safe fix that restores row delivery to both:
  - local Docker Postgres
  - remote Railway Postgres
- focused regression coverage for the discovered failure mode
- durable validation artifact that starts from a disposable config and records:
  - local store counts
  - local sink row counts
  - remote sink row counts
  - `_jin_push_state` outcome
- explicit note on whether outbound identity fields such as `userId` were
  relevant to the fix or remain a separate contract question

## Non-Goals

- generic sink redesign
- non-Postgres sink family changes
- adapter/store reconciliation beyond what is necessary to prove sink delivery
- product decisions on user/developer identity unless directly required by the
  proven fix

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Postgres sink still obeys BP-06 ownership: pipeline chooses what to push; sink formats/transmits only | BP-06 | diff scope + completion report |
| The clean-start local store can push rows successfully into local and remote Postgres destinations | BP-06, BP-10 | durable audit artifact + exact commands |
| `_jin_push_state` records success/failure correctly after the fix | BP-05 | focused validation + code citation |
| The fix does not widen frozen contracts or hide the current failure behind looser validation | BP-02, BP-05, BP-06 | tests + completion report |

## Acceptance Checks

- focused sink tests pass
- a clean-start validation artifact shows non-zero remote rows in both local
  Docker Postgres and Railway, or explains exactly why one environment is
  unavailable
- completion report states whether `userId` / identity fields were required for
  the fix or remain unresolved product work

## Stop And Escalate

Stop if:

- the smallest safe fix requires widening BP-06 or BP-05
- the root cause is actually an adapter/store data-integrity bug rather than a
  Postgres push bug
- the remote failure turns out to depend on missing product identity fields
  that require a contract decision

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation run:
- exact clean-start commands
- local store counts
- local Postgres row counts
- Railway row counts
- representative _jin_push_state rows

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test or artifact>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

Identity note:
- required / not required / still open, with rationale

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
