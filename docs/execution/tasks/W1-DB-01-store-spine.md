# W1-DB-01: Store Spine

## Role

Worker packet.

## Goal

Implement the v2 store spine from BP-05 so the system has a durable local
buffer, revision model, and bundle-write path to build on.

## Depends On

- `W0-CODEX-01-contract-freeze.md`

## Unblocks

- `W1-PIPE-01-pipeline-spine.md`
- any sink or query path that needs v2 store reads

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/04-frozen-contract-surface.md`
3. `docs/blueprint/BP-05-store-and-migration.md`
4. `docs/blueprint/BP-03-conversation-model.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. Frozen contract files:
   - `src/contracts/conversations.ts`
   - `src/contracts/store.ts`
   - `src/contracts/sinks.ts`
7. Current code:
   - `src/store.ts`
   - `src/pricing.ts`
   - relevant tests under `test/`

## Owned Files

- `src/db/**`
- store-focused tests under `test/`

## Forbidden Files

- `src/adapters/**`
- `src/contracts/**`
- `src/sinks/**`
- `src/pipeline/**`
- `src/routing.ts`
- `src/config.ts`
- `src/commands/**`
- `src/store.ts` except for a minimal bridge explicitly approved by Codex

## Frozen Contracts

- parsed conversation/message/tool-call shapes
- `ConversationBundle`
- revision and bundle-hash semantics
- push payload semantics

## Deliverables

- SQLite open path and migration entrypoint using `PRAGMA user_version`
- v2 schema modules split by entity
- `_jin_sync` and `_jin_push_state`
- `writeBundle()` composition path with hash-gated revision bump
- FTS maintenance path
- integrity/status queries for orphan and sync checks

## Non-Goals

- pipeline orchestration
- sink implementations
- route matching logic

## Acceptance Checks

- unchanged bundle does not bump revision
- changed bundle bumps revision exactly once
- push eligibility is revision-based, not timestamp-based
- child rows can exist before parent rows without breaking writes
- tests cover bundle hash determinism and full replacement semantics

## Stop And Escalate

Stop if:

- the packet needs to change parsed types
- the packet needs to redefine `attemptedRevision`
- the packet needs to edit any frozen file under `src/contracts/**`
- the packet needs pipeline changes just to make the store internally coherent

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-05: schema, write semantics, sync state, integrity helpers
- BP-03: relationship storage assumptions preserved

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
