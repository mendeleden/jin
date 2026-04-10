Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-live-adapter-validation`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-08-W3-VALIDATE-01-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `.execution/packets/W3-ADAPTER-07.md`
- `.execution/packets/W3-PERF-03.md`
- `.execution/agents/codex-WORKER-live-adapter-validation.md`
- `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
- `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md`
- `docs/execution/audits/2026-04-08-W3-PERF-03-repeatable-v2-performance-harness.md`

Then read only the packet-owned BP/code/tests:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/blueprint/BP-10-performance-validation.md`
- `scripts/live-validation/run.ts`
- `test/live-validation/run.test.ts`

Review goals:
- verify the harness uses the real v2 discover/load/write path, not legacy session/message APIs
- verify the disposable SQLite reconciliation is direct and machine-readable
- verify the lane stays inside packet-owned files and frozen contracts
- verify the audit is honest about Cursor and Claude failures without overclaiming success
- confirm whether Codex can move `W3-VALIDATE-01` to `approved`

If useful, run only:
- `bun test test/live-validation/run.test.ts`

Write the review artifact at:
- `.execution/reviews/2026-04-08-W3-VALIDATE-01-codex.md`

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
