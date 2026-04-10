Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-REVIEWER-full-runtime-rss-shutdown-flush`.

This is a review-only lane. Do not edit product code. You may write only:
- `.execution/reviews/2026-04-08-W3-PERF-02-codex.md`
- `.execution/blueprints.md`

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/execution/tasks/W3-PERF-02-full-runtime-rss-shutdown-flush.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-PERF-02.md`
- `.execution/packets/W3-E2E-01.md`
- `.execution/agents/codex-WORKER-full-runtime-rss-shutdown-flush.md`
- `docs/execution/audits/2026-04-08-W3-PERF-02-full-runtime-rss-shutdown-flush.md`
- `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md`
- `docs/execution/audits/2026-04-07-W3-E2E-01-persona-local-postgres.md`
- `docs/solutions/2026-04-08-runtime-rss-needs-streamed-discovery-and-small-push-batches.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`

Then read only the packet-owned BP/code/tests:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `src/adapters/codex.ts`
- `src/commands/watch.ts`
- `src/db/bundle.ts`
- `src/pipeline/loop.ts`
- `src/pipeline/ingest.ts`
- `test/runtime-store-cutover.test.ts`
- `test/db-store-spine.test.ts`

Review goals:
- verify the real-workload runtime RSS fix stays inside packet scope
- verify the BP-02 hard limit is preserved rather than raised or weakened
- verify the durable audit closes the full-runtime evidence gap
- verify the remaining Railway push error is correctly treated as out of scope for this packet
- confirm whether Codex can move `W3-PERF-02` to `approved`

If useful, run only:
- `bun test test/runtime-store-cutover.test.ts test/db-store-spine.test.ts`

Write the review artifact at:
- `.execution/reviews/2026-04-08-W3-PERF-02-codex.md`

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
