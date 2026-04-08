Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-claude-code-memory-hardening`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-08-W3-ADAPTER-06-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-ADAPTER-06-claude-code-discover-load-memory-hardening.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-ADAPTER-06.md`
- `.execution/packets/W3-ADAPTER-05.md`
- `.execution/agents/codex-WORKER-claude-code-memory-hardening.md`
- `.execution/reviews/2026-04-07-W3-ADAPTER-05-codex.md`
- `docs/execution/audits/2026-04-07-adapter-memory-contract-audit.md`
- `docs/execution/audits/2026-04-08-claude-code-memory-hardening-validation.md`

Then read only the packet-owned BP/code/tests:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `src/adapters/claude-code.ts`
- `test/claude-code-reference-adapter.test.ts`

Review goals:
- verify Claude Code discovery no longer retains full bundles across changed files
- verify `loadConversation()` still preserves deterministic IDs, parent linkage, compaction/sub-agent semantics, and bundle shape
- verify the packet-local validation is strong enough to close the explicit `W3-ADAPTER-05` follow-on
- confirm whether Codex can move `W3-ADAPTER-06` to `approved`

If useful, run only:
- `bun test test/claude-code-reference-adapter.test.ts`

Write the review artifact at:
- `.execution/reviews/2026-04-08-W3-ADAPTER-06-codex.md`

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
