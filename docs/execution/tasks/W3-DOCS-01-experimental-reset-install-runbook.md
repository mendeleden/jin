# W3-DOCS-01: Experimental V2 Reset And Install Runbook

## Role

Codex-owned docs packet.

## Goal

Write one committed runbook that explains how to move a user to the current
experimental v2 build without carrying forward local v1 state.

The runbook should support the actual experimental policy:

- local state is disposable
- source files are the source of truth
- if the local store shape is old, we ask the user to reset and start fresh
- we do not add a `jin reset-local` command yet

## Depends On

- `W3-TEAM-01-team-bootstrap-and-schema-escape-hatch.md`
- `W3-STARTUP-01-protected-source-opt-in.md`

## Unblocks

- repeatable operator guidance in chat
- dogfood onboarding
- eventual removal of local legacy-store compatibility shims

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `.execution/program.md`
5. `.execution/blueprints.md`
6. `docs/blueprint/BP-05-store-and-migration.md`
7. `docs/blueprint/BP-07-process-lifecycle.md`
8. `docs/blueprint/BP-09-cli-split.md`
9. `package.json`
10. `src/db/schema.ts`
11. `src/index.ts`
12. `src/commands/schema.ts`
13. `src/commands/connect.ts`
14. `src/commands/start.ts`

## Owned Files

- `docs/execution/experimental-v2-reset-and-install.md`

## Forbidden Files

- product code
- scripts or new CLI commands
- blueprint files

## Deliverables

- one committed runbook with:
  - exact copy-paste reset commands
  - a soft reset path
  - a hard reset path
  - fresh install commands for the current repo binary
  - the basic team/postgres follow-up path
  - a short explanation of why the reset is required for experimental v2
- keep the language direct and operational
- do not promise backward-compatible local DB migration

## Acceptance Checks

- document is concise and operator-usable
- commands are explicit and shell-ready
- no `jin reset-local` command is introduced
- the runbook clearly distinguishes local reset from team/postgres bootstrap

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- none (docs-only)

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
