# W3-MODULE-01: Layout Alignment

## Role

Codex-owned integration packet.

## Goal

Align the repository structure and imports to BP-01 once the core v2 lanes are
implemented and validated.

## Depends On

- the Wave 1 spine
- enough Wave 2 coverage to prove the new seams

## Unblocks

- removal of temporary bridges
- clean BP-01 alignment

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-01-module-map.md`
3. all packets that created temporary bridges or dual-path modules
4. current module layout in `src/`

## Owned Files

- cross-cutting module layout and bridge files across `src/`

## Forbidden Files

- product-surface decisions that belong in `W3-PRODUCT-01`

## Frozen Contracts

- v2 shared contracts
- lifecycle, routing, store, and sink semantics

## Deliverables

- final module placement aligned to BP-01
- import cleanup
- retirement of temporary migration bridges where safe

## Non-Goals

- changing architecture semantics
- redesigning the command surface

## Acceptance Checks

- module boundaries reflect BP-01 ownership rules
- temporary bridges are removed or explicitly justified
- import graph is cleaner, not more tangled

## BP Acceptance Matrix

| Requirement | Status | Evidence |
|-------------|--------|----------|
| BP-01 daemon ownership lives under `daemon/` | implemented | `src/daemon/process-state.ts`, `src/daemon/runtime-state.ts`, `src/daemon/daemonize.ts`; verified by `bun test test/lifecycle-boundary.test.ts` and `bun test test/config-mutation-control.test.ts` |
| BP-01 / BP-02 watcher implementation lives under `pipeline/` | implemented | `src/pipeline/file-watcher.ts`, `src/pipeline/watcher.ts`; verified by `bun test test/pipeline-spine.test.ts` |
| BP-08 routing stays pure conversation-based without the legacy wrapper | implemented | `src/routing.ts`, `src/commands/watch.ts`; verified by `bun test test/routing.test.ts` |
| BP-07 / BP-08 API route factory uses the v2 options path only | implemented | `src/api/routes.ts`, `src/api/server.ts`; verified by `bun test test/local-control-boundary.test.ts` and `bun test test/read-only-query-surface.test.ts` |
| BP-Product command/help reframing | out of scope | deferred to `W3-PRODUCT-01` per packet boundary |
| BP-04 / BP-06 removal of live adapter and sink compatibility shims | out of scope | deferred because current v1 command surfaces still depend on those shims |

## Stop And Escalate

This is a Codex integration packet because it is intentionally cross-cutting.

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- parity kept / intentional BP-backed change / deferred regression
- or `no prior v1 surface`

BP alignment:
- BP-01: module layout and ownership aligned

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
