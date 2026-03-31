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

BP alignment:
- BP-01: module layout and ownership aligned

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
