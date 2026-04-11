Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-cursor-live-layer3`.

This is a review-only lane. Do not edit product code. You may write only:

- `.execution/reviews/2026-04-09-W3-ADAPTER-10-codex.md`
- `.execution/blueprints.md`
- `.execution/agents/codex-REVIEWER-cursor-live-layer3.md`

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-ADAPTER-10-cursor-live-layer3-decode-and-revalidation.md`

Then read the live control plane:

- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-ADAPTER-10.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `.execution/agents/codex-WORKER-cursor-live-layer3.md`
- `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
- `docs/execution/audits/2026-04-09-W3-ADAPTER-10-cursor-live-layer3-decode-and-revalidation.md`
- `docs/solutions/2026-04-09-cursor-live-layer3-pointer-roots-and-content-addressed-ids.md`

Then read only the packet-owned BP/code/tests:

- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-10-release-validation.md`
- `src/adapters/cursor.ts`
- `test/cursor-adapter.test.ts`
- `scripts/live-validation/run.ts`

Review goals:

- verify the original `6/6` Cursor null-bundle live failure is fixed by
  adapter-local changes only
- verify layer3 pointer-root decoding and tool-result stitching are implemented
  honestly against the packet-local audit evidence
- verify the content-addressed layer3 ID collision class is fixed without
  widening into store or sink contracts
- verify layer1 / layer3 mixed discovery still behaves honestly, including the
  degraded warning path if `state.vscdb` cannot be opened
- confirm whether Codex can move `W3-ADAPTER-10` to `approved`

If useful, run only:

- `bun test test/cursor-adapter.test.ts`
- `bun scripts/live-validation/run.ts --adapters=cursor --output-dir=/tmp/jin-live-validation-cursor-review --cursor-chats-dir="$HOME/.cursor/chats" --cursor-db-path="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"`
- the exact packet-local read-only probe commands recorded in the worker audit

Write the review artifact at:

- `.execution/reviews/2026-04-09-W3-ADAPTER-10-codex.md`

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
- keep updating `.execution/agents/codex-REVIEWER-cursor-live-layer3.md` as you go
- do not edit `.execution/program.md` or `.execution/packets/*.md`
