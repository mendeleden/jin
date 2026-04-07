Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-runtime-store-cutover`.

This is a review-only lane. Do not edit product code. You may write only:

- `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex.md`
- `.execution/blueprints.md`

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-RUNTIME-01-live-runtime-store-cutover.md`

Then read the live control plane:

- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-RUNTIME-01.md`
- `.execution/agents/codex-WORKER-live-runtime-store-cutover.md`
- `.execution/reviews/2026-04-04-AUDIT-bp-drift-claude.md`
- `.execution/reviews/2026-04-04-AUDIT-v1-bridges-claude.md`

Then read only the packet-owned BP docs, code, and tests:

- `docs/blueprint/BP-01-module-map.md`
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
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
- `test/runtime-store-cutover.test.ts`
- `test/init.test.ts`
- `test/lifecycle-boundary.test.ts`
- `test/config-mutation-control.test.ts`

Current Codex context:

- This is the first review pass for `W3-RUNTIME-01`
- The worker claims:
  - foreground runtime now launches `runPipeline(...)`
  - live runtime writes now use the v2 store path
  - one-shot ingest now uses the v2 ingest/push/store path
  - `status.ts` and `analyze.ts` now read from the v2 db/query surfaces
  - a focused cutover test was added
  - `tui/app.tsx` remains compatibility-wired and is explicitly deferred

Review goals:

- verify whether the live daemon/runtime path actually reaches the v2 coordinator/store path
- verify whether the packet truly closes the main BP-05 runtime drift without widening frozen contracts
- verify the BP Acceptance Matrix row by row against code and test citations
- verify the V1 Comparison claims are accurate
- verify any remaining legacy-store dependencies are explicitly deferred rather than silently left live
- confirm whether Codex can move `W3-RUNTIME-01` to `approved`

If useful, run only:

- `bun test test/runtime-store-cutover.test.ts`
- `bun test test/init.test.ts`
- `bun test test/lifecycle-boundary.test.ts`
- `bun test test/config-mutation-control.test.ts`

Write the review artifact at:

- `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex.md`

Use this review structure:

- verdict
- scope of review
- blocking findings
- BP Acceptance Matrix verification
- V1 comparison
- aligned
- drift
- unowned spread
- progress
- Codex decisions needed

Important:

- findings first, ordered by severity
- omitted in-scope requirements are blocking, not informational
- if there are no blockers, say that explicitly
- update `.execution/blueprints.md`
- do not edit `.execution/program.md` or `.execution/packets/*.md`
