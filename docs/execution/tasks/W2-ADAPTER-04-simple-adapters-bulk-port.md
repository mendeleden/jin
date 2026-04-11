# W2-ADAPTER-04: Simple Adapters Bulk Port

## Role

Worker packet.

## Goal

Port the lower-complexity adapters onto the frozen v2 contract in one bounded
lane once the reference adapters have validated the contract.

## Depends On

- `W1-ADAPTER-01-claude-code-reference.md`
- `W2-ADAPTER-02-codex-reference.md`
- `W2-ADAPTER-03-cursor-reference.md`

## Unblocks

- broad BP-04 coverage across the remaining adapter set

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-04-adapter-contract.md`
3. `docs/blueprint/BP-03-conversation-model.md`
4. Current code:
   - `src/adapters/amp.ts`
   - `src/adapters/gemini-cli.ts`
   - `src/adapters/kiro.ts`
   - `src/adapters/opencode.ts`
   - `src/adapters/pi.ts`
   - `src/adapters/piagent.ts`
   - `src/adapters/warp.ts`

## Owned Files

- the simple adapter files listed above
- adapter tests for those adapters

## Forbidden Files

- `src/adapters/types.ts`
- `src/adapters/registry.ts`
- `src/db/**`
- `src/pipeline/**`
- `src/sinks/**`

## Frozen Contracts

- adapter interface
- parsed output shapes
- relationship semantics

## Deliverables

- v2 ports for the simpler adapters
- safe defaults where a source format lacks richer semantics
- deterministic IDs and bundle loading across the set

## Non-Goals

- advanced compaction or spawn support where the source does not justify it
- registry or pipeline wiring

## Acceptance Checks

- each adapter conforms to the frozen interface
- each adapter uses deterministic IDs
- tests prove repeated loads are stable
- adapters with limited source data still emit valid root conversations

## Stop And Escalate

Stop if:

- a supposedly simple adapter actually needs reference-lane treatment
- shared contracts need to change

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-04: simple adapters ported to frozen contract

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
