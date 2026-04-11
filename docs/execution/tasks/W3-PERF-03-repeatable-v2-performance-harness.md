# W3-PERF-03: Repeatable V2 Performance Harness and Release Gate

## Role

Codex worker packet.

## Goal

Build the repeatable v2 performance harness that should run before every
release candidate, not as a one-off after a production-like failure.

This lane exists because the current `jin benchmark` command does not exercise
the real v2 discover/load/write/push/runtime path with phase-level RSS
attribution, and recent regressions only surfaced on the live workload after
multiple approved packets had already landed.

## Depends On

- `docs/execution/tasks/W3-PERF-02-full-runtime-rss-shutdown-flush.md`
- `docs/execution/tasks/W3-SCALE-01-deterministic-scale-datasets.md`
- `docs/execution/audits/2026-04-07-W3-PERF-01-codex-rss-validation.md`
- `docs/execution/audits/2026-04-08-W3-PERF-02-full-runtime-rss-shutdown-flush.md`
- `docs/solutions/2026-04-08-runtime-rss-needs-streamed-discovery-and-small-push-batches.md`

## Unblocks

- repeatable pre-release perf validation
- phase-level RSS attribution for future regressions
- CI/local gating for adapter/runtime changes

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/execution/performance-persona-council.md`
8. `docs/execution/tasks/W3-PERF-03-repeatable-v2-performance-harness.md`
9. `docs/execution/tasks/W3-SCALE-01-deterministic-scale-datasets.md`
10. Current code:
   - `src/commands/benchmark.ts`
   - `src/pipeline/loop.ts`
   - `src/pipeline/ingest.ts`
   - `src/pipeline/push.ts`
   - `test/perf-harness/**`

## Owned Files

- `src/commands/benchmark.ts`
- `test/perf-harness/**`
- `docs/execution/README.md` only if needed for a durable runbook entry
- packet-local audits under `docs/execution/audits/`

## Forbidden Files

- `src/adapters/**`
- `src/contracts/**`
- `src/sinks/**`
- `docs/blueprint/**`
- `test/perf-datasets/**`
- service/version/PR/UI work

## Frozen Contracts

- v2 adapter interface
- v2 store/sink contracts
- BP-02 runtime ownership and RSS guard semantics

## Deliverables

- a repeatable harness that exercises the real v2 path in phases:
  - discovery
  - load
  - load + write
  - push
  - full runtime / foreground path
  - shutdown flush
- phase-level JSON artifacts with:
  - wall time
  - OS RSS / high-water mark
  - `process.memoryUsage()` snapshot
  - refs / bundles / source units touched
- a documented local invocation that can be run before each release
- a short persona-council synthesis using the lenses in
  `docs/execution/performance-persona-council.md`
- if the lightest path is to upgrade `jin benchmark`, do so; otherwise leave
  behind a packet-local harness under `test/perf-harness/`

## Non-Goals

- fixing current runtime RSS bugs
- rewriting adapters
- committing giant generated fixtures
- changing release/version/service code

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| The harness measures the real v2 discover/load/write/push path rather than legacy session/message surfaces | BP-02, BP-04 | code diff + audit artifact |
| Phase-level RSS attribution is explicit and repeatable | BP-02 | harness output + runbook |
| The lane does not widen frozen adapter/store/sink contracts | BP-04, BP-05, BP-06 | diff scope |
| Future release candidates have a durable command/runbook to execute this harness | BP-02 | docs + exact command citation |

## Acceptance Checks

- one command or documented command sequence runs the harness end to end
- output artifacts are machine-readable JSON and include stage names
- the harness can target dataset scale tiers supplied by `W3-SCALE-01`
- completion report states whether the harness replaced `jin benchmark` or
  intentionally coexists with it

## Stop And Escalate

Stop if:

- the smallest viable harness requires changing frozen runtime contracts
- this lane would need to own dataset generation instead of consuming a stable
  dataset contract from `W3-SCALE-01`
- the correct move is a new first-class blueprint before any harness code

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation run:
- exact harness command(s)
- artifact paths
- observed phase list

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test or artifact>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

Release-gate outcome:
- what can now run before each release
- what still depends on future packets

Persona council:
- telemetry-agent lens:
- streaming-reliability lens:
- storage/release lens:

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
