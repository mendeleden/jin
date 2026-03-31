# W1-ADAPTER-01: Claude Code Reference Adapter

## Role

Worker packet.

## Goal

Port the Claude Code adapter to the v2 adapter contract so it serves as the
reference rich adapter for the new architecture.

## Depends On

- `W0-CODEX-01-contract-freeze.md`

## Unblocks

- realistic end-to-end pipeline validation on a feature-rich adapter
- later ports of other adapters using the same contract

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-04-adapter-contract.md`
3. `docs/blueprint/BP-03-conversation-model.md`
4. `docs/blueprint/BP-02-data-flow.md`
5. Supporting docs:
   - `docs/adapters/ADAPTER_INVESTIGATION_PLAYBOOK.md`
   - `docs/architecture/adapter-claude-code.md`
6. Current code:
   - `src/adapters/claude-code.ts`
   - `src/adapters/types.ts`
   - Claude Code fixtures under `test/fixtures/claude-code/`

## Owned Files

- `src/adapters/claude-code.ts`
- Claude Code adapter tests under `test/`
- Claude Code fixtures only if required for new test coverage

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
- parsed conversation/message/tool-call shapes
- relationship semantics

## Deliverables

- `detect()`
- `findChanged(hint?)`
- `loadConversation(ref)`
- `watchPaths()`
- deterministic IDs
- compaction splitting
- sub-agent detection where source data supports it
- tool-call extraction
- thinking extraction

## Non-Goals

- registry wiring
- store writes
- sink awareness

## Acceptance Checks

- loading the same ref twice yields identical IDs
- compacted conversations become linked conversations, not one flattened blob
- spawned relationships emit `trace_id`, `parent_id`, and `relationship`
- adapter returns full bundles without touching the store
- tests cover deterministic IDs, compaction, and tool-call extraction

## Stop And Escalate

Stop if:

- the packet needs shared type changes
- the packet needs store-specific logic to express adapter output
- the packet needs routing or sink knowledge

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-04: adapter contract implemented
- BP-03: relationship semantics emitted in adapter output

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
