# W1-ROUTING-01: Routing And Config Core

## Role

Worker packet.

## Goal

Implement the v2 config core and pure routing engine from BP-08 without mixing
in command-surface or onboarding churn.

## Depends On

- `W0-CODEX-01-contract-freeze.md`

## Unblocks

- `W1-PIPE-01-pipeline-spine.md`
- later command packets and status/reporting work

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-08-routing-and-config.md`
3. `docs/blueprint/BP-06-sink-contract.md`
4. `docs/blueprint/BP-07-process-lifecycle.md`
5. Current code:
   - `src/config.ts`
   - `src/routing.ts`
   - `test/routing.test.ts`

## Owned Files

- `src/config.ts`
- `src/routing.ts`
- routing/config tests under `test/`

## Forbidden Files

- `src/commands/**`
- `src/pipeline/**`
- `src/sinks/**`
- `src/db/**`
- `src/lifecycle.ts`

## Frozen Contracts

- sink payload semantics
- lifecycle config snapshot semantics
- product split between Team and generic sinks

## Deliverables

- v2 durable config schema
- discriminated sink config union
- pure route evaluator
- glob matching and field normalization per BP-08
- union-of-all-matches behavior
- safe zero-state behavior for unmatched conversations

## Non-Goals

- command UX
- team/workspace onboarding flows
- daemon reload implementation

## Acceptance Checks

- multiple fields use AND semantics
- multiple matching routes union sink IDs
- no route match returns an empty sink set
- v1 `project`, `directory`, `defaultSinks`, and `routeUnmatchedToAll`
  behavior is absent from the v2 path
- tests cover glob matching, union behavior, and safe zero-state

## Stop And Escalate

Stop if:

- the packet needs command-level design choices
- the packet needs lifecycle restart behavior redesigned
- the packet needs Team onboarding concepts mixed into generic sink config

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-08: config schema and routing semantics implemented
- BP-06: sink family boundary preserved

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
