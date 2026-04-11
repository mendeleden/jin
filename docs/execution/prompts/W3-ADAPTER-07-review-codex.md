Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-claude-code-live-hardening`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-08-W3-ADAPTER-07-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-ADAPTER-07-claude-code-path-precedence-and-live-hardening.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-ADAPTER-07.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `.execution/agents/codex-WORKER-claude-code-live-hardening.md`
- `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md`
- `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
- `docs/solutions/2026-04-08-adapter-default-path-selection-must-prefer-populated-sources.md`

Then read only the packet-owned BP/code/tests:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `src/adapters/claude-code.ts`
- `test/claude-code-reference-adapter.test.ts`
- `test/integration.test.ts`

Review goals:
- verify default path precedence now prefers populated real sources over empty preferred directories
- verify the live child recursion / stack-overflow failure is fixed inside packet scope
- verify the lane stays outside frozen pipeline/store/sink contract widening
- verify the remaining `~812 MB` full-dataset pressure is documented honestly as a follow-up rather than overclaimed as fixed
- confirm whether Codex can move `W3-ADAPTER-07` to `approved`

If useful, run only:
- `bun test test/claude-code-reference-adapter.test.ts`

Write the review artifact at:
- `.execution/reviews/2026-04-08-W3-ADAPTER-07-codex.md`

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
