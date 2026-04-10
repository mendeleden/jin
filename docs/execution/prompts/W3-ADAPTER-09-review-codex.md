Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-claude-code-id-collision`.

This is a review-only lane. Do not edit product code. You may write only:

- `.execution/reviews/2026-04-09-W3-ADAPTER-09-codex.md`
- `.execution/blueprints.md`
- `.execution/agents/codex-REVIEWER-claude-code-id-collision.md`

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-ADAPTER-09-claude-code-duplicate-id-collision-fix-and-live-revalidation.md`

Then read the live control plane:

- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-ADAPTER-09.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `.execution/agents/codex-WORKER-claude-code-id-collision.md`
- `docs/execution/audits/2026-04-09-W3-ADAPTER-09-claude-code-duplicate-id-collision-fix-and-live-revalidation.md`
- `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`

Then read only the packet-owned BP/code/tests:

- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `src/adapters/claude-code.ts`
- `test/claude-code-reference-adapter.test.ts`
- `scripts/live-validation/run.ts`

Review goals:

- verify the live duplicate loaded conversation IDs are fixed with adapter-local scoped conversation IDs
- verify the `messages.id` collision class is fixed without widening into store or sink contract changes
- verify compaction and spawned/sub-agent linkage still hold under the new ID derivation
- verify the worker evidence and packet-local audit honestly support approval
- confirm whether Codex can move `W3-ADAPTER-09` to `approved`

If useful, run only:

- `bun test test/claude-code-reference-adapter.test.ts`
- the exact packet-local read-only probe commands recorded in the worker audit

Write the review artifact at:

- `.execution/reviews/2026-04-09-W3-ADAPTER-09-codex.md`

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
- keep updating `.execution/agents/codex-REVIEWER-claude-code-id-collision.md` as you go
- do not edit `.execution/program.md` or `.execution/packets/*.md`
