# W3-V2-01: Final Steps Before E2E and Experimental Preview

## Role

Codex-owned integration packet.

## Goal

Close the immediate same-day release-prep loop after the runtime/team/startup
lanes are settled enough to make a binary and run persona E2E.

This packet is not the true runtime/store cutover. It is the practical
pre-E2E/pre-preview checkpoint that turns the current packet stack into one
operator-usable sequence and one explicit go/no-go decision.

## Depends On

- `W3-TEAM-01-team-bootstrap-and-schema-escape-hatch.md`
- `W3-STARTUP-01-protected-source-opt-in.md`
- `W3-RUNTIME-01-live-runtime-store-cutover.md`
- `W3-E2E-01-persona-cuj-local-postgres.md`

## Unblocks

- local binary rebuild/install and smoke test
- local Docker/Postgres persona E2E run
- experimental preview go/no-go with explicit caveats

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/blueprints.md`
6. `.execution/packets/W3-TEAM-01.md`
7. `.execution/packets/W3-RUNTIME-01.md`
8. `.execution/reviews/2026-04-06-W3-TEAM-01-codex.md`
9. `.execution/reviews/2026-04-06-W3-TEAM-01-codex-recheck.md` if present
10. `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex.md`
11. `.execution/reviews/2026-04-07-W3-RUNTIME-01-codex-recheck.md`
12. `docs/execution/tasks/W3-E2E-01-persona-cuj-local-postgres.md`
13. `package.json`
14. `test/docker-compose.integration.yml`
15. `test/integration.test.ts`

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
  - the already-completed `W3-RUNTIME-01` approval/commit checkpoint in
    `45529f8`
  - local Docker/Postgres E2E prerequisites
  - binary rebuild/install prerequisite
  - preview release caveats
- a clear split between:
  - what must be done before E2E
  - what must be done before an experimental preview build
  - what is still deferred until runtime/store cutover

## Acceptance Checks

- the packet gives one concrete sequence from the approved `W3-RUNTIME-01`
  state to local E2E
- the packet makes the runtime/store cutover state explicit and current instead
  of assuming a stale pre-approval state
- the packet distinguishes local binary smoke testing from the Docker/Postgres persona E2E gate

## 2026-04-07 Execution Output

- concrete same-day checklist and readiness split:
  `docs/execution/audits/2026-04-07-W3-V2-01-final-steps.md`
- first checkpoint is the already-completed `W3-RUNTIME-01` approval/commit in
  `45529f8`; move directly to binary rebuild/install and persona E2E without a
  runtime re-review/commit loop

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
