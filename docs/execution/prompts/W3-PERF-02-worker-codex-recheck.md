Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-full-runtime-rss-shutdown-flush-recheck`.

You are the narrow codex recheck worker for `W3-PERF-02`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-PERF-02-full-runtime-rss-shutdown-flush.md`
6. `.execution/reviews/2026-04-08-W3-PERF-02-codex.md`
7. `.execution/packets/W3-PERF-02.md`
8. `.execution/program.md`

Then read only the packet-owned files needed for the fix:
- `src/commands/watch.ts`
- `test/runtime-store-cutover.test.ts`
- `docs/execution/audits/2026-04-08-W3-PERF-02-full-runtime-rss-shutdown-flush.md`

Scope:
- fix only the review blocker in `W3-PERF-02`
- do not widen the packet
- do not touch adapter/store/sink contracts

Required outcome:
- remove the `JIN_RSS_WARNING_MB` / `JIN_RSS_HARD_LIMIT_MB` runtime passthrough from the product runtime path
- keep the small runtime push-batch fix intact
- update focused coverage if needed
- refresh the packet audit only where needed to reflect the final approved shape

Owned files for this recheck:
- `src/commands/watch.ts`
- `test/runtime-store-cutover.test.ts`
- `docs/execution/audits/2026-04-08-W3-PERF-02-full-runtime-rss-shutdown-flush.md`
- `.execution/agents/codex-WORKER-full-runtime-rss-shutdown-flush.md`

Completion report:
- Completed
- Files changed
- Tests run
- BP acceptance matrix delta
- Remaining risks / follow-ups
