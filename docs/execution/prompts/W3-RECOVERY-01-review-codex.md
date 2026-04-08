Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-poisoned-local-store-recovery`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-07-W3-RECOVERY-01-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-RECOVERY-01-poisoned-local-store-reset-guidance.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-RECOVERY-01.md`
- `.execution/packets/W3-E2E-01.md`
- `.execution/agents/codex-WORKER-poisoned-local-store-recovery.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
- `docs/execution/experimental-v2-reset-and-install.md`

Then read only the packet-owned BP/code/tests:
- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `src/db/store.ts`
- `src/commands/start.ts`
- `src/commands/ingest.ts`
- `test/poisoned-local-store-recovery.test.ts`
- `test/runtime-store-cutover.test.ts`
- `test/db-store-spine.test.ts`

Review goals:
- verify poisoned-store signatures now map to explicit reset guidance instead of raw SQLite failures
- verify the fix stays inside the recovery boundary and does not widen into unrelated runtime/store work
- verify the runbook and runtime messages are aligned
- confirm whether Codex can move `W3-RECOVERY-01` to `approved`

If useful, run only:
- `bun test test/poisoned-local-store-recovery.test.ts test/runtime-store-cutover.test.ts test/db-store-spine.test.ts`

Write the review artifact at:
- `.execution/reviews/2026-04-07-W3-RECOVERY-01-codex.md`

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
- if there are no blockers, say that explicitly
- update `.execution/blueprints.md`
- do not edit `.execution/program.md` or `.execution/packets/*.md`
