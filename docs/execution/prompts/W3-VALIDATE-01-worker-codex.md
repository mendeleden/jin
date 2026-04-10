Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-live-adapter-validation`.

You are the Codex worker for `W3-VALIDATE-01`.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/blueprint/BP-05-store-and-migration.md`
8. `docs/blueprint/BP-10-performance-validation.md`
9. `docs/execution/tasks/W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
10. `docs/execution/tasks/W3-PERF-03-repeatable-v2-performance-harness.md`
11. `docs/execution/tasks/W3-ADAPTER-07-claude-code-path-precedence-and-live-hardening.md`

Then read the live control plane:
- `.execution/program.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `.execution/packets/W3-PERF-03.md`
- `.execution/packets/W3-ADAPTER-07.md`

Then inspect only the files you need from:
- `src/commands/benchmark.ts`
- `src/adapters/codex.ts`
- `src/adapters/claude-code.ts`
- `src/adapters/cursor.ts`
- `src/db/store.ts`
- `src/db/query-surface.ts`
- `test/perf-harness/**`

Boundaries:
- You may edit only:
  - `scripts/live-validation/**`
  - `test/live-validation/**`
  - `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
  - `.execution/agents/codex-WORKER-live-adapter-validation.md`
- Do not edit product code unless you find a minimal harness-only change is
  strictly necessary, and if so stop and report instead of widening the lane.

Execution requirements:
- Use real local data for:
  - Cursor
  - Claude Code
  - Codex
- Use a disposable config dir and SQLite store
- Avoid remote sinks
- Emit machine-readable artifacts if practical

Deliver:
- reusable harness/run command(s)
- temp-store reconciliation output per adapter
- one durable audit note with exact commands, counts, mismatches, and follow-ups

Validation target:
- prove we can run a real live-data sanity pass before release instead of
  waiting for a full local dogfood attempt to fail

Completion report format:
- Completed
- Files changed
- Tests run
- Validation run
- BP acceptance matrix
- Adapter reconciliation
- Risks / follow-ups
- Blocked / needs Codex
