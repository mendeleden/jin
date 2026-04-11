Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-adapter-memory-contract-audit`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-07-W3-ADAPTER-05-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-ADAPTER-05-adapter-memory-contract-audit.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-ADAPTER-05.md`
- `.execution/packets/W3-PERF-01.md`
- `.execution/packets/W3-RECOVERY-01.md`
- `.execution/agents/codex-WORKER-adapter-memory-contract-audit.md`
- `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`
- `docs/execution/audits/2026-04-07-v2-runtime-bug-audit.md`

Then read only the packet-owned docs/code/tests:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/execution/audits/2026-04-07-adapter-memory-contract-audit.md`
- `src/pipeline/ingest.ts`
- `src/adapters/*.ts`
- `test/codex-reference-adapter.test.ts`
- `test/claude-code-reference-adapter.test.ts`
- `test/cursor-adapter.test.ts`
- `test/simple-adapters-bulk-port.test.ts`
- `test/pipeline-spec-gap-closure.test.ts`

Review goals:
- verify the audit cleanly distinguishes safe adapters, doc-gap-only adapters, and follow-on-packet adapters
- verify the BP-02 / BP-04 hardening is explicit, reviewable, and does not widen frozen contracts
- verify the claimed `claude-code` follow-on is justified by the packet-owned evidence
- confirm whether Codex can move `W3-ADAPTER-05` to `approved`

If useful, run only:
- `bun test test/codex-reference-adapter.test.ts test/claude-code-reference-adapter.test.ts test/cursor-adapter.test.ts test/simple-adapters-bulk-port.test.ts test/pipeline-spec-gap-closure.test.ts`

Write the review artifact at:
- `.execution/reviews/2026-04-07-W3-ADAPTER-05-codex.md`

Use this review structure:
- verdict
- scope of review
- blocking findings
- BP Acceptance Matrix verification
- cross-adapter findings
- blueprint hardening
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
