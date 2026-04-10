Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-scale-datasets`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-08-W3-SCALE-01-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-SCALE-01-deterministic-scale-datasets.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-SCALE-01.md`
- `.execution/agents/codex-WORKER-scale-datasets.md`
- `docs/execution/audits/2026-04-08-W3-SCALE-01-deterministic-scale-datasets.md`
- `docs/execution/performance-persona-council.md`

Then read only the packet-owned BP/code/tests:
- `docs/blueprint/BP-03-conversation-model.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `scripts/perf-datasets/generate.ts`
- `scripts/perf-datasets/validate.ts`
- `scripts/perf-datasets/clean.ts`
- `test/perf-datasets/README.md`
- `test/perf-datasets/scale-datasets.test.ts`

Review goals:
- verify the dataset generators are deterministic and consume committed seeds rather than giant checked-in blobs
- verify the manifests preserve ontology-relevant structure for the target rich adapters
- verify the lane stays outside runtime/adapter contract edits
- confirm whether Codex can move `W3-SCALE-01` to `approved`

If useful, run only:
- `bun test test/perf-datasets/scale-datasets.test.ts`

Write the review artifact at:
- `.execution/reviews/2026-04-08-W3-SCALE-01-codex.md`

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
