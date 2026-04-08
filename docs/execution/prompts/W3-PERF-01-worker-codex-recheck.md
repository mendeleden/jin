Work in `/Users/edenmendel/Documents/GitHub/jin`.

Use session name `codex-WORKER-codex-ingest-rss-budget-recheck`.

You are not alone in the shared canonical workspace. Other workers may be
active. Stay strictly inside this packet's owned files, do not revert anyone
else's edits, and do not absorb recovery, adapter-audit, sink, Team/bootstrap,
or unrelated product work.

This is a narrow `W3-PERF-01` evidence-gap pass.

Read in order:
1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-PERF-01-codex-ingest-rss-budget.md`
6. `.execution/reviews/2026-04-07-W3-PERF-01-codex.md`

Then read the shared control plane:
- `.execution/program.md`
- `.execution/blueprints.md`
- `.execution/packets/W3-PERF-01.md`
- `.execution/agents/codex-WORKER-codex-ingest-rss-budget.md`
- `docs/solutions/2026-04-07-codex-ingest-timeouts-pin-bundles.md`
- `docs/execution/audits/2026-04-07-W3-E2E-01-persona-local-postgres.md`

Before coding, create or update your heartbeat at `.execution/agents/codex-WORKER-codex-ingest-rss-budget.md` with:
- preferred session name: `codex-WORKER-codex-ingest-rss-budget`
- packet id: `W3-PERF-01`
- status: `in_progress`
- current focus: `Attach a durable representative-memory validation artifact for the approved code path`

Only then read the exact packet-owned files needed for this narrow pass:
- `src/adapters/codex.ts`
- `src/pipeline/ingest.ts`
- `test/codex-reference-adapter.test.ts`
- `test/pipeline-spec-gap-closure.test.ts`

Current review blocker:
- the code diff is review-clean
- approval is blocked only because the real `~/.codex` RSS validation exists only in the heartbeat, not in a durable artifact

Constraints:
- do not widen the code diff unless the evidence run exposes a minimal packet-local defect
- prefer adding a durable audit/validation note under `docs/execution/audits/`
- if you must touch tests/docs, keep it packet-local and narrow

Target deliverable:
- a durable reviewable artifact that records:
  - exact validation command or harness
  - dataset scope
  - measurement method
  - loaded-ref count
  - peak RSS
  - explicit confirmation that the `256 MB` hard-limit log no longer appears
  - whether this is sufficient to rerun installed-binary E2E

Acceptance checks:
- the durable artifact is enough for the existing review to move from `needs_codex` to `approved`
- any rerun command is explicit and reproducible

Return the completion report in the exact format from `docs/execution/00-global-rules.md`.
