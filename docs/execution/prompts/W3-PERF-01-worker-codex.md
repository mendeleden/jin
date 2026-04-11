Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-codex-ingest-rss-budget`.

You are not alone in the shared canonical workspace. Other workers may be active. Stay strictly inside this packet's owned files, do not revert anyone else's edits, and do not absorb store-recovery, sink-internal, Team/bootstrap, or unrelated product work.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-PERF-01-codex-ingest-rss-budget.md`

Then execute the packet exactly.

Read the shared control plane first:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-PERF-01.md`
- `.execution/packets/W3-E2E-01.md`
- `.execution/packets/W3-RUNTIME-01.md`
- `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex-recheck.md`

Before coding, create or update your heartbeat at `.execution/agents/codex-WORKER-codex-ingest-rss-budget.md` with:
- preferred session name: `codex-WORKER-codex-ingest-rss-budget`
- packet id: `W3-PERF-01`
- branch / worktree / container: `feat/rewrite-ontology` / `canonical repo workspace` / `local`
- status: `in_progress`

Only then read the exact BP docs and code files named in the packet:
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/execution/audits/2026-04-07-W3-E2E-01-persona-local-postgres.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
- `src/adapters/codex.ts`
- `src/pipeline/ingest.ts`
- `src/pipeline/loop.ts`
- `src/commands/benchmark.ts`
- focused Codex/pipeline/perf tests under `test/`

Current program context:
- installed-binary validation showed repeated RSS hard-limit shutdowns on the real Codex dataset
- do not "fix" this by raising the hard limit or disabling the guard
- the current experimental release blocker is the Codex ingest memory profile

Constraints:
- only edit packet-owned files
- do not edit `src/contracts/**`
- do not edit sink or Team/bootstrap code
- keep the hard-limit behavior intact
- if the smallest safe fix requires widening into store recovery, stop and escalate

Target deliverables:
- Codex ingest stays within the BP-02 RSS budget on the packet-local validation path
- focused regression coverage or benchmark evidence proves the improvement
- completion report states whether the installed-binary E2E path should be rerun immediately

Acceptance checks:
- packet-local validation no longer trips the RSS hard limit during representative Codex ingest
- the hard limit is still enforced when actually exceeded
- completion report cites code + tests for each BP Acceptance Matrix row

Return the completion report in the exact format from `docs/execution/00-global-rules.md`.
