# W3-RUNTIME-01: Live Runtime and Store Cutover

## Role

Codex-owned integration packet.

## Goal

Cut the live daemon/runtime path over from the legacy watcher/store stack to
the v2 pipeline/store path that already exists in `src/pipeline/**` and
`src/db/**`.

This is the main remaining architectural gap between:

- "the v2 rewrite exists in the repo", and
- "the v2 rewrite is the live production runtime"

## Depends On

- `W3-STARTUP-01-protected-source-opt-in.md`
- `W3-TEAM-01-team-bootstrap-and-schema-escape-hatch.md`
- stable enough `W3-PRODUCT-01` command surface

## Unblocks

- honest claim that the v2 rewrite is the live runtime path
- cleaner release caveats before experimental preview
- persona E2E confidence against the real runtime/store path

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-01-module-map.md`
6. `docs/blueprint/BP-02-data-flow.md`
7. `docs/blueprint/BP-05-store-and-migration.md`
8. `docs/blueprint/BP-07-process-lifecycle.md`
9. `docs/blueprint/BP-08-routing-and-config.md`
10. Runtime drift evidence:
   - `.execution/blueprints.md`
   - `.execution/reviews/2026-04-04-AUDIT-bp-drift-claude.md`
   - `.execution/reviews/2026-04-04-AUDIT-v1-bridges-claude.md`
11. Current code:
   - `src/commands/start.ts`
   - `src/commands/watch.ts`
   - `src/commands/ingest.ts`
   - `src/commands/status.ts`
   - `src/commands/analyze.ts`
   - `src/tui/app.tsx`
   - `src/store.ts`
   - `src/adapters/types.ts`
   - `src/pipeline/**`
   - `src/db/**`
   - runtime- and store-focused tests under `test/`

## Owned Files

- `src/commands/start.ts`
- `src/commands/watch.ts`
- `src/commands/ingest.ts`
- `src/commands/status.ts`
- `src/commands/analyze.ts`
- `src/tui/app.tsx`
- `src/store.ts`
- `src/adapters/types.ts`
- `src/pipeline/**`
- `src/db/**`
- focused runtime/store/pipeline tests under `test/`

## Forbidden Files

- `src/contracts/**`
- `src/sinks/**` except read-only consumption
- unrelated product framing or team/bootstrap files
- broad CLI redesign outside the runtime/store cutover

## Frozen Contracts

- adapter v2 bundle/load contract
- sink push payload contract
- route matching semantics
- daemon single-owner lifecycle invariants

## Deliverables

- `jin start` and foreground runtime entry use the v2 pipeline coordinator
- live persistence goes through `src/db/store.ts`, not `src/store.ts`
- one-shot ingest is either moved to the same brain/store path or explicitly
  deferred with Codex approval
- residual read surfaces are migrated or explicitly called out if they block
  retirement of `src/store.ts`
- focused verification proving the live runtime/store path changed for real

## Non-Goals

- sink contract redesign
- adapter parser rewrites
- team/bootstrap product work
- pretending the cutover is complete if critical read surfaces still depend on
  the v1 store

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| `jin start` / foreground runtime path uses the BP-02 pipeline coordinator instead of the v1 watcher brain | BP-01, BP-02, BP-07 | `src/commands/start.ts`, `src/commands/watch.ts`, `src/pipeline/**`, focused runtime tests |
| Live runtime writes use the BP-05 store spine in `src/db/**`, not `src/store.ts` | BP-05 | `src/db/store.ts`, `src/commands/watch.ts`, focused store/runtime tests |
| One-shot ingest does not bypass the single-brain invariant | BP-02, BP-07 | `src/commands/ingest.ts`, focused one-shot tests |
| Runtime/store cutover does not widen frozen adapter or sink contracts | BP-04, BP-06 | diff scope, focused tests, no contract edits |
| Read surfaces touched by the cutover either migrate cleanly or are explicitly deferred with boundary citations | BP-01, BP-05, BP-07 | `status.ts` / `analyze.ts` / `tui/app.tsx` citations in completion report |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

- compare the live `start -> watch -> store` path against the target
  `start -> pipeline/loop -> db/store` path
- record which user-visible runtime behaviors are preserved versus intentionally
  changed

## Acceptance Checks

- the live daemon path no longer depends on `src/store.ts` for writes
- the live daemon path reaches `runPipeline(...)` or an equivalent BP-02-owned
  coordinator path
- focused tests prove the cutover instead of only validating the dormant v2
  modules
- the completion report states clearly whether the repo can now honestly claim
  the v2 rewrite is the live runtime

## Stop And Escalate

Stop if:

- the cutover requires frozen contract changes
- the packet must absorb unrelated product/team work to land
- the smallest safe slice is still too large for one packet and needs a
  narrower split recommendation

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
- parity kept / intentional BP-backed change / deferred cutover

BP alignment:
- BP-02/BP-05/BP-07: live runtime path now matches the v2 coordinator/store story

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
