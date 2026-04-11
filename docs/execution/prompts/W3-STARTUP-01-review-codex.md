Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-protected-source-opt-in`.

This is a review-only lane. Do not edit product code. You may write only:

- `.execution/reviews/2026-04-06-W3-STARTUP-01-codex.md`
- `.execution/blueprints.md`

Read in order:

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-STARTUP-01-protected-source-opt-in.md`

Then read the live control plane:

- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-STARTUP-01.md`
- `.execution/agents/codex-WORKER-protected-source-opt-in.md`
- `.execution/packets/W3-PRODUCT-01.md`
- `.execution/reviews/2026-04-04-W3-PRODUCT-01-claude.md`

Then read only the packet-owned code and tests:

- `docs/execution/04-frozen-contract-surface.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `src/config.ts`
- `src/adapters/registry.ts`
- `src/adapters/cursor.ts`
- `src/adapters/kiro.ts`
- `src/adapters/opencode.ts`
- `src/adapters/warp.ts`
- `src/adapters/claude-code.ts`
- `src/adapters/codex.ts`
- `src/commands/start.ts`
- `src/commands/watch.ts`
- `src/commands/init.ts`
- packet-owned startup/detection tests under `test/`

Review goals:

- audit startup adapter discovery against the packet's protected-source opt-in policy
- verify the BP Acceptance Matrix row by row against code and test citations
- verify daemon startup no longer probes protected/app-private sources without explicit opt-in
- verify startup no longer auto-enables disabled adapters or writes config
- verify any per-OS policy language is explicit and coherent
- confirm whether Codex can move `W3-STARTUP-01` to `approved`

If useful, run only the packet-owned tests or exact commands the worker reports.

Write the review artifact at:

- `.execution/reviews/2026-04-06-W3-STARTUP-01-codex.md`

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

