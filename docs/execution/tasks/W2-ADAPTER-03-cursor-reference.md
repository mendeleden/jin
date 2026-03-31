# W2-ADAPTER-03: Cursor Reference Adapter

## Role

Worker packet.

## Goal

Port the Cursor adapter to the frozen v2 contract so the architecture is
validated on a shared-database, multi-layer adapter with nontrivial change
detection.

## Depends On

- `W0-CODEX-01-contract-freeze.md`

## Unblocks

- confidence that BP-04 works for shared-db adapters, not just file-based ones

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-04-adapter-contract.md`
3. `docs/blueprint/BP-03-conversation-model.md`
4. `docs/blueprint/BP-02-data-flow.md`
5. Supporting docs:
   - `docs/adapters/cursor/index.md`
   - `docs/adapters/cursor/investigation.md`
   - `docs/adapters/cursor/orchestration.md`
6. Current code:
   - `src/adapters/cursor.ts`
   - `src/adapters/types.ts`
   - Cursor-related tests and fixtures under `test/`

## Owned Files

- `src/adapters/cursor.ts`
- Cursor adapter tests under `test/`
- Cursor fixtures only if required for coverage

## Forbidden Files

- `src/adapters/types.ts`
- `src/adapters/registry.ts`
- `src/db/**`
- `src/pipeline/**`
- `src/sinks/**`
- `src/config.ts`
- `src/routing.ts`

## Frozen Contracts

- adapter interface
- parsed output shapes
- relationship semantics

## Deliverables

- v2 Cursor adapter implementation on frozen contracts
- shared-db appropriate change detection
- bundle loading without store coupling
- relationship and tool-call extraction to the extent the source supports it

## Non-Goals

- registry wiring
- pipeline orchestration
- sink or routing behavior

## Acceptance Checks

- change detection works without global pipeline cache assumptions
- repeated loads yield stable IDs
- shared-db storage model still obeys the two-phase discover/load contract
- tests cover change detection and representative relationship extraction

## Stop And Escalate

Stop if:

- shared contracts need to change
- a shared-db limitation requires a BP-level exception

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-04: shared-db adapter ported to v2 contract
- BP-03: relationship semantics emitted where supported

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
