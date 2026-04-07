# W3-TEAM-01: Team Bootstrap and Schema Escape Hatch

## Role

Claude Code worker packet.

## Goal

Define and, where coherent inside this repo, implement the first explicit local
CLI surface for Team/bootstrap work so the product is no longer limited to a
sink-shaped onboarding code plus compatibility flags, without pulling normal
developer onboarding into the operator namespace.

This packet should answer the concrete gap now visible in the repo:
- what `jin team` should own locally
- what remote Postgres/bootstrap path exists for self-hosted or operator-driven
  setups
- how to keep `jin connect --team=<code>` as the developer path while moving
  operator-only actions under `jin team`

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
4. `docs/blueprint/BP-09-cli-split.md`
5. `docs/blueprint/BP-05-store-and-migration.md`
6. `docs/blueprint/BP-06-sink-contract.md`
7. `docs/blueprint/BP-08-routing-and-config.md`
7. Current code:
- `src/index.ts`
- `src/commands/team-config.ts`
- `src/commands/connect.ts`
- `src/commands/init.ts`
- optional new `src/commands/team.ts`
- `src/sinks/postgres.ts`
- any existing tests covering team/config/bootstrap surfaces under `test/`

## Owned Files

- `src/index.ts`
- `src/commands/team-config.ts`
- `src/commands/connect.ts`
- `src/commands/init.ts`
- optional new `src/commands/team.ts`
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
- the operator schema escape hatch belongs under `jin team schema ...`, not as
  a top-level developer command
- current BP-06 sink push semantics and runtime ownership rules remain frozen

## Deliverables

- explicit inventory of the current team/bootstrap gap in the local CLI
- coherent command-surface proposal or implementation for:
  - `jin connect --team=<code>` as the developer onboarding path
  - `jin team bridge` as the operator onboarding-code path
  - `jin team schema ...` as the operator schema escape hatch
- if implementation is viable inside repo scope:
  - command dispatch in `src/index.ts`
  - command help text
  - focused tests
- do not introduce `jin team connect` as the primary developer path
- do not introduce `jin team status` / `jin team disconnect` unless explicitly
  deferred and left out of the live help surface
- if implementation is not yet viable without wider product/backend policy:
  - a concrete split recommendation with exact next packet boundaries

## Non-Goals

- inventing the Team backend, auth model, or hosted control plane
- implementing a remote API server
- changing BP-06 sink delivery semantics
- conflating Team bootstrap with generic sink creation
- inventing workspace identity heuristics and then treating them as a stable
  Team control plane

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Team remains a distinct product plane in the local CLI surface, not a renamed Postgres sink flow | BP-Product | `src/index.ts`, team-related command files, focused help/tests |
| Developer onboarding stays at top-level `jin connect --team=<code>` rather than moving under `jin team` | BP-09, BP-Product | `src/index.ts`, `src/commands/connect.ts`, focused help/tests |
| Any remote Postgres bootstrap path is explicit operator/admin surface under `jin team schema ...`, not the default onboarding story | BP-09, BP-Product, BP-01 | command/help text, optional `team`/`schema` command files, focused tests |
| Existing workspace onboarding (`team-config`, `connect --team`, `init --team`) does not regress | BP-08, BP-Product | `src/commands/team-config.ts`, `src/commands/connect.ts`, `src/commands/init.ts`, focused tests |
| Generic sink wiring stays separate from Team/product framing | BP-08, BP-Product | command/help text, focused tests |
| `jin team init` / `jin team status` remain deferred unless workspace identity is real and non-heuristic | BP-09, BP-Product | explicit defer in help/tests/packet notes |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

- compare the current compatibility team/bootstrap path (`team-config`,
  `connect --team`, `init --team`) against any new explicit Team/admin surface
- record whether the schema escape hatch is implemented under `jin team schema`
  or deferred again

## Acceptance Checks

- the repo has a clearer local CLI story for Team/bootstrap than the current
  sink-shaped onboarding-code flow alone
- developer onboarding still reads as `jin connect --team=<code>`, not
  `jin team connect`
- any schema bootstrap command lives under `jin team schema ...`, not top-level
  `jin schema`
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
