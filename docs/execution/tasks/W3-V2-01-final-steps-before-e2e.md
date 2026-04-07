# W3-V2-01: Final Steps Before E2E and Experimental Preview

## Role

Codex-owned integration packet.

## Goal

Close the immediate same-day release-prep loop before running the persona E2E
validation.

This packet is not the true runtime/store cutover. It is the practical
pre-E2E/pre-preview checkpoint that makes the repo ready for a local end-to-end
validation pass and an honest experimental-preview decision.

## Depends On

- `W3-TEAM-01-team-bootstrap-and-schema-escape-hatch.md`
- `W3-E2E-01-persona-cuj-local-postgres.md`

## Unblocks

- clean `W3-TEAM-01` approval + commit
- local Docker/Postgres persona E2E run
- experimental preview go/no-go with explicit caveats

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/blueprints.md`
6. `.execution/packets/W3-TEAM-01.md`
7. `.execution/reviews/2026-04-06-W3-TEAM-01-codex.md`
8. `.execution/reviews/2026-04-06-W3-TEAM-01-codex-recheck.md` if present
9. `docs/execution/tasks/W3-E2E-01-persona-cuj-local-postgres.md`
10. `package.json`
11. `test/docker-compose.integration.yml`
12. `test/integration.test.ts`

## Owned Files

- `docs/execution/tasks/W3-V2-01-final-steps-before-e2e.md`
- `docs/execution/prompts/W3-V2-01-worker.md`
- optional release/E2E audit notes under `docs/execution/audits/`

This packet is primarily orchestration and validation guidance. It should not
be used for broad product edits.

## Forbidden Files

- `src/contracts/**`
- broad architectural rewrites
- unrelated packet scopes

## Deliverables

- explicit same-day final-steps checklist covering:
  - `W3-TEAM-01` reconcile / approve / commit
  - local Docker/Postgres E2E prerequisites
  - binary rebuild/install prerequisite
  - preview release caveats
- a clear split between:
  - what must be done before E2E
  - what must be done before an experimental preview build
  - what is still deferred until runtime/store cutover

## Acceptance Checks

- the packet gives one concrete sequence from `W3-TEAM-01` review to local E2E
- the packet makes the runtime/store cutover caveat explicit
- the packet does not pretend the v2 pipeline/store is already the live runtime

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Release readiness split:
- before E2E:
- before experimental preview:
- still deferred:

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
