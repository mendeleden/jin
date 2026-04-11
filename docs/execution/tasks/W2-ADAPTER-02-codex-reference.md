# W2-ADAPTER-02: Codex Reference Adapter

## Role

Worker packet.

## Goal

Port the Codex adapter to the frozen v2 adapter contract so the architecture is
validated on a second high-value source format with different storage quirks.

## Depends On

- `W0-CODEX-01-contract-freeze.md`
- preferably `W1-ADAPTER-01-claude-code-reference.md`

## Unblocks

- higher confidence in BP-04 beyond a single adapter
- realistic validation of compaction and orchestration behavior across tools

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-04-adapter-contract.md`
3. `docs/blueprint/BP-03-conversation-model.md`
4. `docs/blueprint/BP-02-data-flow.md`
5. Supporting docs:
   - `docs/adapters/codex/index.md`
   - `docs/adapters/codex/investigation.md`
   - `docs/adapters/codex/orchestration.md`
6. Current code:
   - `src/adapters/codex.ts`
   - `src/adapters/types.ts`
   - Codex fixtures under `test/fixtures/codex/`

## Owned Files

- `src/adapters/codex.ts`
- Codex adapter tests under `test/`
- Codex fixtures only if needed for coverage

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

- v2 Codex adapter implementation on frozen contracts
- deterministic IDs
- `findChanged(hint?)`
- `loadConversation(ref)`
- relationship and tool-call extraction consistent with BP-03 and BP-04

## Non-Goals

- registry wiring
- store writes
- sink behavior

## Acceptance Checks

- deterministic IDs across repeated loads
- adapter returns bundles, not session/message split state
- any compaction or spawn semantics supported by the source are emitted via the
  frozen relationship model
- tests cover tool-call extraction and relationship correctness

## Stop And Escalate

Stop if:

- shared type changes are required
- source data cannot be represented by the frozen contract without Codex
  approval

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-04: Codex adapter ported to v2 contract
- BP-03: relationship semantics emitted where source data supports them

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
