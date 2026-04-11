# Wave 3 State And Next Session Start

- date: `2026-04-08`
- author: `codex-BRAIN`
- purpose: fresh-session handoff for the current Wave 3 runtime / sink / live-validation state

## Current Approved State

- `W3-PERF-02` approved
- `W3-PERF-03` approved
- `W3-SCALE-01` approved
- `W3-BP-01` approved
- `W3-ADAPTER-07` approved
- `W3-VALIDATE-01` is `review_ready`
- `W3-SINK-04` is the active execution lane

## Current Release-Facing Reality

- a clean-start install and ingest path works well enough to populate local SQLite
- local and remote Postgres sink delivery still fails on fresh-start validation
- the current sink-side error is:
  - `Only use sql.begin, sql.reserved or max: 1`
- live adapter reconciliation now has a real audit on disk:
  - Codex reconciles cleanly
  - Claude Code still shows `messages.id` collisions and duplicate loaded conversation IDs
  - Cursor still has null-bundle / DB-open issues

## Current Active Lanes

- `W3-SINK-04`
  - title: `Postgres push regression and release sink validation`
  - goal: restore local and remote Postgres sink delivery on the clean-start path
  - current worker shape: external `codex exec` log exists, but the tmux session did not persist
  - log: `.execution/logs/codex-WORKER-postgres-push-regression.jsonl`
  - notable finding already recorded in the log:
    - `checkSchemaCompatibility()` is using root-client `unsafe` on `postgres://` and triggering the exact Bun SQL runtime error before row writes

- `W3-VALIDATE-01`
  - title: `Live adapter validation and reconciliation`
  - status: `review_ready`
  - worker heartbeat: `.execution/agents/codex-WORKER-live-adapter-validation.md`
  - audit: `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
  - review log: `.execution/logs/codex-REVIEWER-live-adapter-validation.jsonl`

## First Reads For The Next Session

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/blueprints.md`
6. `docs/tmp-diagram/current-program-state.mmd`
7. `.execution/packets/W3-SINK-04.md`
8. `docs/execution/tasks/W3-SINK-04-postgres-push-regression-and-release-sink-validation.md`
9. `docs/execution/audits/2026-04-08-clean-start-postgres-push-regression.md`
10. `.execution/logs/codex-WORKER-postgres-push-regression.jsonl`
11. `.execution/packets/W3-VALIDATE-01.md`
12. `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
13. `.execution/logs/codex-REVIEWER-live-adapter-validation.jsonl`

## Immediate Next Actions

1. Normalize the control plane.
   - `.execution/program.md` still lists the old internal `codex-WORKER-postgres-push-regression` agent entry even though that worker was closed.
   - replace it with the external `codex exec` worker/log reference, and add the live validate reviewer reference if the review is still running.

2. Check whether `W3-VALIDATE-01` review finished.
   - if approved, reconcile the packet and keep the resulting follow-ups narrow:
     - Claude `messages.id` collisions / duplicate loaded conversation IDs
     - Cursor null bundles / DB-open failure

3. Continue `W3-SINK-04`.
   - inspect the sink worker log first
   - if the worker is done, queue review
   - if the worker stalled or needs relaunch, use `tmux + codex exec`, not `spawn_agent`

4. Do not treat current local runtime behavior as release-stable yet.
   - E2E and service follow-up still depend on sink delivery being real

## Operator Preference

- use `tmux + codex exec` for new worker/review lanes
- prefer reviewable artifacts and explicit logs under `.execution/logs/`
- do not silently switch back to opaque internal workers unless there is a hard reason

## Control Plane Note

The live control plane remains `.execution/`.
This file is a durable handoff snapshot so the next session can start from one note instead of reconstructing state from scattered logs.
