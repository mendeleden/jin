Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-performance-blueprint`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-08-W3-BP-01-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-BP-01-performance-validation-blueprint-hardening.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-BP-01.md`
- `.execution/packets/W3-PERF-02.md`
- `.execution/agents/codex-WORKER-performance-blueprint.md`
- `docs/execution/audits/2026-04-08-W3-BP-01-performance-validation-blueprint-decision.md`
- `docs/execution/performance-persona-council.md`
- `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`
- `docs/solutions/2026-04-08-release-workflow-needs-a-pre-tag-performance-gate.md`

Then read only the packet-owned BP/docs:
- `docs/blueprint/BP-01-module-map.md`
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-10-performance-validation.md`
- `docs/blueprint/README.md`

Review goals:
- verify the blueprint hardening makes release performance validation explicit and reviewable
- verify the BP-10 decision is coherent and does not widen ontology or runtime contracts
- verify the persisted-state guidance stays appropriately narrow
- confirm whether Codex can move `W3-BP-01` to `approved`

If useful, run only:
- `git diff --check -- docs/blueprint/BP-01-module-map.md docs/blueprint/BP-02-data-flow.md docs/blueprint/BP-04-adapter-contract.md docs/blueprint/BP-10-performance-validation.md docs/blueprint/README.md docs/execution/audits/2026-04-08-W3-BP-01-performance-validation-blueprint-decision.md`

Write the review artifact at:
- `.execution/reviews/2026-04-08-W3-BP-01-codex.md`

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
