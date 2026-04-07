# W3-TEAM-01: Team Bootstrap and Schema Escape Hatch

## Role

Claude Code worker packet.

## Goal

Define and, where coherent inside this repo, implement the first explicit local
CLI surface for Team/bootstrap work so the product is no longer limited to a
sink-shaped onboarding code plus compatibility flags.

This packet should answer the concrete gap now visible in the repo:
- what `jin team` should own locally
- what remote Postgres/bootstrap path exists for self-hosted or operator-driven
  setups
- whether `jin schema apply` belongs as the operator escape hatch inside this
  repo, without turning it into the main onboarding story

## Depends On

- `W3-PRODUCT-01-command-surface-reframe.md`

## Unblocks

- clearer `jin team` demo story
- explicit local/operator path for remote Postgres workspace bootstrap
- separation of Team product surfaces from generic sink wiring

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-Product-Strategy.md`
3. `docs/blueprint/BP-01-module-map.md`
4. `docs/blueprint/BP-05-store-and-migration.md`
5. `docs/blueprint/BP-06-sink-contract.md`
6. `docs/blueprint/BP-08-routing-and-config.md`
7. Current code:
   - `src/index.ts`
   - `src/commands/team-config.ts`
   - `src/commands/connect.ts`
   - `src/commands/init.ts`
   - `src/sinks/postgres.ts`
   - any existing tests covering team/config/bootstrap surfaces under `test/`

## Owned Files

- `src/index.ts`
- `src/commands/team-config.ts`
- `src/commands/connect.ts`
- `src/commands/init.ts`
- optional new command entrypoints under `src/commands/` for explicit team or
  schema/admin surfaces
- focused team/bootstrap tests under `test/`

## Forbidden Files

- `src/contracts/**`
- `src/db/**`
- `src/pipeline/**`
- `src/adapters/**`
- sink internals beyond read-only consumption of current Postgres readiness
  semantics unless Codex explicitly approves widening scope

## Frozen Contracts

- Team is a product plane, not a sink flavor
- generic sinks remain integrations
- `jin schema apply` may be an operator/admin escape hatch, not the core
  onboarding path
- current BP-06 sink push semantics and runtime ownership rules remain frozen

## Deliverables

- explicit inventory of the current team/bootstrap gap in the local CLI
- coherent command-surface proposal or implementation for `jin team` and/or
  `jin schema apply`
- if implementation is viable inside repo scope:
  - command dispatch in `src/index.ts`
  - command help text
  - focused tests
- if implementation is not yet viable without wider product/backend policy:
  - a concrete split recommendation with exact next packet boundaries

## Non-Goals

- inventing the Team backend, auth model, or hosted control plane
- implementing a remote API server
- changing BP-06 sink delivery semantics
- conflating Team bootstrap with generic sink creation

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Team remains a distinct product plane in the local CLI surface, not a renamed Postgres sink flow | BP-Product | `src/index.ts`, team-related command files, focused help/tests |
| Any remote Postgres bootstrap path is explicit operator/admin surface, not the default onboarding story | BP-Product, BP-01 | command/help text, optional `schema` or `team` command files, focused tests |
| Existing workspace onboarding (`team-config`, `connect --team`, `init --team`) does not regress | BP-08, BP-Product | `src/commands/team-config.ts`, `src/commands/connect.ts`, `src/commands/init.ts`, focused tests |
| Generic sink wiring stays separate from Team/product framing | BP-08, BP-Product | command/help text, focused tests |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

- compare the current compatibility team/bootstrap path (`team-config`,
  `connect --team`, `init --team`) against any new explicit Team/admin surface
- record whether `jin schema apply` stays absent, appears as an operator escape
  hatch, or is deferred again

## Acceptance Checks

- the repo has a clearer local CLI story for Team/bootstrap than the current
  sink-shaped onboarding-code flow alone
- any new command/help surface keeps Team distinct from generic sink wiring
- focused tests cover command dispatch/help and preserve existing onboarding
  behavior where retained

## Stop And Escalate

Stop if:

- the packet would require backend/team API implementation beyond this repo
- the packet would require changing frozen sink or runtime contracts
- the right answer is clearly a product/policy decision rather than a repo
  command-surface change

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- parity kept / intentional BP-backed change / deferred regression

BP alignment:
- BP-Product: Team remains a product plane
- BP-01/BP-08: operator/admin bootstrap is explicit without collapsing into generic sink wiring

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```

