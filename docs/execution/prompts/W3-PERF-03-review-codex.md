Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-v2-performance-harness`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-08-W3-PERF-03-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-PERF-03-repeatable-v2-performance-harness.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-PERF-03.md`
- `.execution/packets/W3-SCALE-01.md`
- `.execution/agents/codex-WORKER-v2-performance-harness.md`
- `docs/execution/audits/2026-04-08-W3-PERF-03-repeatable-v2-performance-harness.md`
- `docs/execution/audits/2026-04-08-W3-SCALE-01-deterministic-scale-datasets.md`
- `docs/execution/performance-persona-council.md`

Then read only the packet-owned BP/code/tests:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `src/commands/benchmark.ts`
- `test/perf-harness/README.md`
- `test/perf-harness/run-v2-benchmark.sh`
- `test/perf-harness/benchmark-v2.test.ts`
- `test/self-observation.test.ts`

Review goals:
- verify the harness measures the real v2 phases rather than legacy session/message surfaces
- verify the machine-readable artifact contract is durable enough for pre-release use
- verify the lane stays outside adapter/runtime contract widening
- confirm whether Codex can move `W3-PERF-03` to `approved`

If useful, run only:
- `bun test test/perf-harness/benchmark-v2.test.ts test/self-observation.test.ts`

Write the review artifact at:
- `.execution/reviews/2026-04-08-W3-PERF-03-codex.md`

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
