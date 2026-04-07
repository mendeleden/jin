Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-runtime-store-cutover-recheck`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex-recheck.md`
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
- `.execution/agents/codex-WORKER-runtime-store-evidence-gap.md`
- `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex.md`
- `.execution/reviews/2026-04-04-AUDIT-bp-drift-claude.md`
- `.execution/reviews/2026-04-04-AUDIT-v1-bridges-claude.md`

Then read only the packet-owned BP/code/tests:
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
- first review already accepted the live runtime/write cutover
- this recheck is narrow: verify whether the packet-local read-surface evidence gap is now closed
- `src/tui/app.tsx` is still the explicit `LegacyStore` defer unless the packet changed that intentionally

Review goals:
- verify the previous blocker is resolved
- verify packet-local test evidence now directly covers the v2 `analyze.ts` read path
- verify packet-local test evidence now directly covers the `status.ts` store-stat path strongly enough for the matrix row
- re-check that no new scope was widened beyond the narrow evidence-gap fix
- confirm whether Codex can move `W3-RUNTIME-01` to `approved`

If useful, run only:
- `bun test test/runtime-store-cutover.test.ts`
- `bun test test/init.test.ts`
- `bun test test/lifecycle-boundary.test.ts`
- `bun test test/config-mutation-control.test.ts`

Write the review artifact at:
- `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex-recheck.md`

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
- focus on whether the old blocker is resolved
- if there are no blockers, say that explicitly
- update `.execution/blueprints.md`
- do not edit `.execution/program.md` or `.execution/packets/*.md`
