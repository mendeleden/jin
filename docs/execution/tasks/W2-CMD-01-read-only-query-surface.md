# W2-CMD-01: Read-Only Query Surface

## Role

Worker packet.

## Goal

Port the read-only query commands to the v2 store and conversation model so
users can inspect conversations, traces, and search results without requiring a
daemon.

## Depends On

- `W1-DB-01-store-spine.md`
- `W1-LIFECYCLE-01-runtime-boundary.md`

## Unblocks

- user-visible validation of BP-03 and BP-07
- read-only operational usability during migration

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-03-conversation-model.md`
3. `docs/blueprint/BP-05-store-and-migration.md`
4. `docs/blueprint/BP-07-process-lifecycle.md`
5. `docs/blueprint/BP-08-routing-and-config.md`
6. Current code:
   - `src/commands/show.ts`
   - `src/commands/list.ts`
   - `src/commands/search.ts`
   - `src/commands/export.ts`
   - `src/api/routes.ts`

## Owned Files

- `src/commands/show.ts`
- `src/commands/list.ts`
- `src/commands/search.ts`
- `src/commands/export.ts`
- any read-only query helpers under `src/db/**` explicitly needed for these
  commands
- read-only command tests under `test/`

## Forbidden Files

- `src/pipeline/**`
- `src/sinks/**`
- `src/adapters/**`
- `src/commands/start.ts`
- `src/commands/stop.ts`
- `src/commands/service.ts`

## Frozen Contracts

- conversation model
- store schema and revision semantics
- lifecycle ownership semantics

## Deliverables

- read-only commands on v2 store/query APIs
- trace-aware `show` behavior
- search and export behavior aligned to the v2 schema
- no hidden daemon start or write side effects

## Non-Goals

- write-capable commands
- sink mutation commands
- pipeline control behavior

## Acceptance Checks

- read-only commands work whether or not a long-lived runtime is active
- `show` can operate on a single conversation and full trace/tree semantics as
  supported by the command design
- commands do not start a hidden runtime
- tests cover stopped-runtime behavior

## Stop And Escalate

Stop if:

- the packet needs new store semantics
- command design choices imply new BP policy

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-03: read/query surface honors trace model
- BP-07: read-only commands work without daemon
- BP-05: query surface uses v2 store

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
