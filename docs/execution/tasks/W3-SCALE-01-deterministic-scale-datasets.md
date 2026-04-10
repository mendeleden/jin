# W3-SCALE-01: Deterministic 1x / 10x / 100x Scale Datasets

## Role

Codex worker packet.

## Goal

Create deterministic, on-demand scale datasets for rich adapters so performance
and memory validation can run at `1x`, `10x`, and `100x` without depending on
one engineer's live tool directories.

## Depends On

- `docs/execution/tasks/W3-ADAPTER-05-adapter-memory-contract-audit.md`
- `docs/execution/tasks/W3-ADAPTER-06-claude-code-discover-load-memory-hardening.md`
- `docs/execution/audits/2026-04-07-adapter-memory-contract-audit.md`
- representative fixture inputs already under `test/fixtures/`

## Unblocks

- `W3-PERF-03`
- repeatable adapter/runtime scale testing
- CI/local regression reproduction without live private data

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-03-conversation-model.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/execution/performance-persona-council.md`
8. `docs/execution/tasks/W3-SCALE-01-deterministic-scale-datasets.md`
9. Current code:
   - `test/fixtures/**`
   - `test/perf-harness/**`
   - rich adapter reference tests

## Owned Files

- `test/perf-datasets/**`
- `scripts/perf-datasets/**`
- packet-local audits under `docs/execution/audits/`

## Forbidden Files

- `src/**`
- `docs/blueprint/**`
- `src/commands/benchmark.ts`
- sinks/service/version/PR/UI work

## Frozen Contracts

- ontology relationship model
- adapter v2 interface
- runtime/store/sink contracts

## Deliverables

- deterministic dataset generator(s) for at least:
  - Codex-heavy scale
  - Claude Code-heavy scale
  - one mixed-adapter scenario if it fits cleanly
- a manifest format describing:
  - scale tier (`1x`, `10x`, `100x`)
  - expected files
  - expected refs
  - expected conversation relationships retained
- local commands to generate and clean datasets on demand
- a short persona-council synthesis using the lenses in
  `docs/execution/performance-persona-council.md`
- no giant committed generated blobs; generators and small seed fixtures only

## Non-Goals

- changing adapter logic
- release-gate code
- large checked-in fixture directories
- rewriting the ontology model

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Generated datasets preserve ontology-relevant structure like compacted chains and spawned children | BP-03 | generator manifest + focused validation |
| Dataset generation is deterministic from committed seeds | BP-04 | repeated run output / manifest |
| Scale tiers are consumable by future perf harnesses without live private data | BP-04 | runbook + generated layout |
| The packet does not widen runtime or adapter contracts | BP-04, BP-05 | diff scope |

## Acceptance Checks

- repeated generation with the same seed yields the same manifests
- scale tiers exist at `1x`, `10x`, and `100x`
- at least one focused validation proves the generated layout is parseable by
  the intended adapter(s)
- completion report includes exact generation commands

## Stop And Escalate

Stop if:

- deterministic generation cannot preserve the ontology structure we need
- the packet would need to check in huge generated blobs to be useful
- adapter-specific logic changes are required to make generated datasets work

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation run:
- exact generation commands
- manifest paths
- parseability checks

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test or artifact>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

Dataset contract:
- supported adapters
- supported scales
- known limits

Persona council:
- telemetry-agent lens:
- storage-engine lens:
- release-engineer lens:

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
