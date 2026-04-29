# Packet State

- packet: `W3-PERF-03`
- title: `Repeatable V2 Performance Harness and Release Gate`
- status: `approved`
- assigned agent: `codex-WORKER-v2-performance-harness`
- branch: `feat/rewrite-ontology`
- worktree/container: `canonical repo workspace` / `local`
- depends on: `W3-PERF-02`, `W3-SCALE-01`
- unblocks: `repeatable pre-release perf validation`, `phase-level RSS attribution`, `CI/local perf gating for future adapter and runtime changes`
- last transition: `2026-04-08`
- next Codex action: `use the harness as the repeatable pre-release measurement surface while BP-10 owns release-budget policy`
- latest review: `2026-04-08-W3-PERF-03-codex.md`

## Notes

- the current `jin benchmark` path still uses legacy surfaces and does not gate
  the real v2 runtime contract
- recent failures showed that packet-local adapter validation is not enough; we
  need repeatable stage-level instrumentation for release candidates
- this lane should not widen runtime/product contracts; it should build the
  harness and runbook needed to measure them consistently
