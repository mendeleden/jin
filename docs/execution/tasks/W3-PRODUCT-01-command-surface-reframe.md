# W3-PRODUCT-01: Command Surface Reframe

## Role

Codex-owned integration packet.

## Goal

Finish aligning the command surface and user framing to BP-Product-Strategy so
the product story is daemon-first, local-first, and clearly separated from
generic integrations and Team concepts.

## Depends On

- `W2-CONFIG-02-mutation-and-control-commands.md`
- `W2-DAEMON-02-local-control-boundary.md`
- `W3-MODULE-01-layout-alignment.md` or stable enough equivalent

## Unblocks

- final product-surface coherence for v2

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-Product-Strategy.md`
3. `docs/blueprint/BP-07-process-lifecycle.md`
4. `docs/blueprint/BP-08-routing-and-config.md`
5. Current code:
   - `src/index.ts`
   - relevant command files in `src/commands/`
   - any operator/admin surface still centered on old product framing

## Owned Files

- cross-command help and framing files
- `src/index.ts`
- command entrypoint/help text files as needed

## Forbidden Files

- deep runtime internals unless required for command wiring
- backend/team product code outside the repo's local surface

## Frozen Contracts

- generic sinks remain integrations
- Team is a distinct product plane
- Desktop is a client of the daemon boundary

## Deliverables

- command/help framing aligned to BP-Product
- removal or demotion of product-hostile framing such as Postgres-first stories
- clearer separation of local daemon, generic integrations, and Team/workspace
  concepts

## Non-Goals

- inventing Team backend behavior
- changing already-frozen runtime or routing semantics

## Acceptance Checks

- core user story reads as local daemon first
- generic integration commands stay available without becoming the product
- Team/workspace framing is not collapsed into generic sink wiring

## Stop And Escalate

This is a Codex integration packet because it is cross-cutting and user-facing.

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-Product-Strategy: command surface and product framing aligned
- BP-07/BP-08: local daemon and config semantics preserved

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
