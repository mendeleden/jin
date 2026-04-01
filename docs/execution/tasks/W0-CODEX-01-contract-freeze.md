# W0-CODEX-01: Contract Freeze

## Role

Codex only. Do not dispatch this packet to a worker.

## Goal

Freeze the shared v2 contracts so Wave 1 packets can execute without semantic
drift or accidental cross-lane redesign.

## Depends On

- `docs/execution/00-global-rules.md`
- `docs/execution/01-dispatch-protocol.md`
- all reviewed BP docs

## Unblocks

- every Wave 1 worker packet

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/blueprint/BP-01-module-map.md`
4. `docs/blueprint/BP-02-data-flow.md`
5. `docs/blueprint/BP-03-conversation-model.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/blueprint/BP-05-store-and-migration.md`
8. `docs/blueprint/BP-06-sink-contract.md`
9. `docs/blueprint/BP-07-process-lifecycle.md`
10. `docs/blueprint/BP-08-routing-and-config.md`
11. Current code:
   - `src/adapters/types.ts`
   - `src/sinks/types.ts`
   - `src/config.ts`
   - `src/routing.ts`
   - `src/store.ts`
   - `src/commands/watch.ts`
   - `src/lifecycle.ts`

## Owned Files

- cross-cutting shared type files
- narrow verification tests for the frozen contract surface
- packet files under `docs/execution/tasks/` if ownership or stop conditions
  need to be updated after freeze
- any minimal contract publication docs needed to make Wave 1 safe

## Forbidden Files

- broad adapter implementation rewrites
- broad sink implementation rewrites
- dashboard, site, or UI code
- broad CLI surface rewrites

## Contracts To Freeze

Freeze and publish these:

- parsed conversation, message, and tool-call shapes
- conversation relationship semantics
- `ConversationRef` and `ConversationBundle`
- adapter contract
- push payload and push result contract
- store write bundle and revision semantics
- routing and config semantics
- lifecycle ownership and shutdown semantics

## Deliverables

- a stable v2 contract surface
- narrow verification coverage for the frozen contract surface
- explicit note of any temporary shims that are allowed during migration
- updated Wave 1 packets if contract freeze changes ownership or stop rules

## Non-Goals

- full implementation of adapters, sinks, pipeline, or commands
- broad refactors that should live in Wave 1 worker packets

## Acceptance Checks

- every Wave 1 packet can point to a frozen contract instead of inventing one
- no worker packet requires a shared contract rewrite to make progress
- Codex can explain the owned file boundaries for each Wave 1 lane

## Stop And Escalate

This packet is the escalation endpoint for the program. If the blueprints
disagree with each other, Codex resolves the conflict before dispatching
workers.

## Completion Report

```md
Completed:
- shared v2 contracts frozen
- Wave 1 packets reconciled to frozen contracts

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-01 through BP-08: shared contract surface frozen

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
