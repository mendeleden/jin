Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-codex-ingest-rss-budget`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-08-W3-PERF-01-codex-recheck.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-PERF-01-codex-ingest-rss-budget.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-PERF-01.md`
- `.execution/packets/W3-E2E-01.md`
- `.execution/agents/codex-WORKER-codex-ingest-rss-budget.md`
- `.execution/reviews/2026-04-07-W3-PERF-01-codex.md`
- `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md`
- `docs/execution/audits/2026-04-07-W3-E2E-01-persona-local-postgres.md`
- `docs/solutions/2026-04-07-codex-ingest-timeouts-pin-bundles.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`

Then read only the packet-owned BP/code/tests:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `src/adapters/codex.ts`
- `src/pipeline/ingest.ts`
- `src/pipeline/loop.ts`
- `src/commands/benchmark.ts`
- `test/codex-reference-adapter.test.ts`
- `test/pipeline-spec-gap-closure.test.ts`

Review goals:
- verify the Codex RSS regression is addressed without raising or weakening the BP-02 hard limit
- verify the new durable real-dataset RSS artifact closes the prior evidence gap
- verify the timeout-retention fix and discovery/load memory changes stay within packet scope
- confirm whether Codex can move `W3-PERF-01` to `approved`

If useful, run only:
- `bun test test/codex-reference-adapter.test.ts test/pipeline-spec-gap-closure.test.ts`

Write the review artifact at:
- `.execution/reviews/2026-04-08-W3-PERF-01-codex-recheck.md`

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
