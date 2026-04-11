Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-v2-performance-harness-recheck`.

You are the narrow codex recheck worker for `W3-PERF-03`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-PERF-03-repeatable-v2-performance-harness.md`
6. `.execution/reviews/2026-04-08-W3-PERF-03-codex.md`
7. `.execution/packets/W3-PERF-03.md`
8. `.execution/program.md`

Then read only the packet-owned files needed for the fix:
- `src/commands/benchmark.ts`
- `test/perf-harness/benchmark-v2.test.ts`
- `test/perf-harness/README.md`
- `test/perf-harness/run-v2-benchmark.sh`
- `docs/execution/audits/2026-04-08-W3-PERF-03-repeatable-v2-performance-harness.md`

Scope:
- fix only the review blockers in `W3-PERF-03`
- do not widen the packet into adapter/runtime redesign

Required outcome:
- requested adapters must not disappear silently from the harness
- normalize the peak-RSS artifact contract so `highWaterMarkBytes` is trustworthy
- add focused coverage for both fixes
- refresh the packet audit only where needed to reflect the final approved shape

Owned files for this recheck:
- `src/commands/benchmark.ts`
- `test/perf-harness/benchmark-v2.test.ts`
- `test/perf-harness/README.md`
- `test/perf-harness/run-v2-benchmark.sh`
- `docs/execution/audits/2026-04-08-W3-PERF-03-repeatable-v2-performance-harness.md`
- `.execution/agents/codex-WORKER-v2-performance-harness.md`

Completion report:
- Completed
- Files changed
- Tests run
- BP acceptance matrix delta
- Remaining risks / follow-ups
