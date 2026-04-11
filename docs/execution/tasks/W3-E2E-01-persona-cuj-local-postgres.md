# W3-E2E-01: Persona CUJ and Local Postgres E2E Validation

## Role

Codex or Claude worker packet.

## Goal

Define and execute the first explicit end-to-end validation pass for the Team
and local daemon flow using named personas and a local Postgres instance running
under Docker.

This packet exists because the blueprints describe the developer/operator split,
but they do not yet provide a concrete named current-user-journey matrix such
as:

- `team admin A`
- `dev A`
- `dev B`

The packet should turn that gap into a repeatable local validation flow that
proves the current repo can:

1. bootstrap a remote Postgres workspace locally
2. generate a workspace onboarding code
3. connect multiple developers to that workspace
4. run local daemon ingest/push
5. verify end-to-end visibility through the current CLI/query surfaces

## Depends On

- `W3-STARTUP-01-protected-source-opt-in.md`
- `W3-TEAM-01-team-bootstrap-and-schema-escape-hatch.md`

## Unblocks

- a real demo flow for Team/bootstrap
- local E2E verification against Dockerized Postgres
- a persona-based CUJ matrix that future reviews can reuse

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-Product-Strategy.md`
3. `docs/blueprint/BP-07-process-lifecycle.md`
4. `docs/blueprint/BP-08-routing-and-config.md`
5. `docs/blueprint/BP-09-cli-split.md`
6. `docs/blueprint/BP-06-sink-contract.md`
7. Existing local integration assets:
- `package.json`
- `test/docker-compose.integration.yml`
- `test/integration.test.ts`
- `test-harness/docker-compose.yml`
- `src/index.ts`
- `src/commands/connect.ts`
- `src/commands/team-config.ts`
- `src/commands/schema.ts`
- `src/commands/start.ts`
- `src/commands/status.ts`
- `src/sinks/postgres.ts`

## Owned Files

- `docs/blueprint/BP-09-cli-split.md` only if a small CUJ appendix or pointer is
  the cleanest place to record the persona matrix
- `docs/execution/tasks/W3-E2E-01-persona-cuj-local-postgres.md`
- optional new execution prompt/runbook docs under `docs/execution/prompts/`
- focused E2E validation docs under `docs/execution/audits/`
- optional new or updated integration tests under `test/` if the packet expands
  the current automated local E2E harness
- optional `test/docker-compose.integration.yml` or adjacent harness files if
  needed to support the persona flow

## Forbidden Files

- `src/contracts/**`
- `src/db/**`
- `src/pipeline/**`
- `src/adapters/**`
- broad product-surface redesign unrelated to the persona E2E flow

## Frozen Contracts

- `jin` remains the developer/local daemon CLI
- `jin team` remains the operator/workspace CLI
- `jin connect --team=<code>` remains the developer onboarding path
- remote Postgres bootstrap remains explicit operator/admin surface, not the
  default developer story

## Deliverables

- a concrete persona matrix for the first Team/local E2E flow with:
  - `team admin A`
  - `dev A`
  - `dev B`
- a repeatable local Docker-backed test/runbook for Postgres workspace setup
- explicit step-by-step CLI flow covering:
  - operator schema bootstrap
  - operator bridge generation
  - developer onboarding
  - daemon start/status
  - query/read verification
- a clear statement of what is manually verified vs automated
- if viable, a focused automated integration test or harness extension that
  covers the critical path

## Non-Goals

- hosted Team backend or auth implementation
- production deployment automation
- rewriting the full generic integration test harness
- mixing Desktop product behavior into the operator/developer CLI validation

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| There is a concrete persona-based CUJ for operator + multiple developers | BP-Product, BP-09 | packet content, runbook, optional BP pointer |
| The operator flow stays under `jin team ...` | BP-09, BP-Product | runbook steps, help output, focused tests |
| The developer flow stays under `jin connect --team=<code>` and local daemon commands | BP-07, BP-08, BP-09 | runbook steps, help output, focused tests |
| Local Docker Postgres can validate the schema/bootstrap/push path without inventing a hosted backend | BP-06, BP-09 | `docker compose` harness usage, verification notes, optional automated test |
| Manual vs automated validation is explicit | BP-Product | audit/runbook output |

Every row must be resolved in the completion report as:
- implemented, with code/test/doc citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

- compare this persona-based E2E path against the current generic integration
  harness and any older sink-shaped team onboarding flow
- record what is newly clarified versus what is newly automated

## Acceptance Checks

- the repo has a concrete operator/developer persona matrix, not just abstract
  role language
- a local operator can bring up Postgres via Docker and run the operator
  bootstrap flow
- two developers can follow the documented onboarding path locally without
  needing `jin team ...`
- the resulting flow verifies real daemon-to-Postgres end-to-end behavior

## Stop And Escalate

Stop if:

- the packet requires hosted Team/backend behavior the repo does not implement
- the current `W3-TEAM-01` surface is still too unstable to validate against
- the only viable E2E path would require broad product-surface redesign

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test or runbook step>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- parity kept / intentional clarification / deferred automation

BP alignment:
- BP-Product: operator and developer personas are explicit in one testable flow
- BP-09: operator bootstrap and developer onboarding stay separated

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
