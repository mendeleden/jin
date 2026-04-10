# W3-BIN-01: Rebuild and Local Binary Smoke

## Role

Codex worker packet.

## Goal

Rebuild the current repo binary and run a bounded local smoke set against the
current local config while `W3-PERF-01` review is running.

This lane exists to answer a narrow operational question:

- does the current worktree still build into a runnable `jin` binary?
- do the core local CLI surfaces still respond from the rebuilt binary?

It is not a release-approval lane and it must not overclaim beyond the bounded
commands it actually runs.

## Depends On

- `W3-RUNTIME-01-live-runtime-store-cutover.md`
- `W3-V2-01-final-steps-before-e2e.md`

## Unblocks

- immediate local confidence that the current worktree still builds and runs as
  a binary while perf review continues

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/execution/tasks/W3-BIN-01-rebuild-and-local-binary-smoke.md`
6. Current code:
   - `package.json`
   - `src/index.ts`
   - `src/commands/status.ts`
   - `src/commands/connect.ts`
   - `src/commands/schema.ts`

## Owned Files

- `docs/execution/audits/2026-04-08-W3-BIN-01-local-binary-smoke.md`

## Forbidden Files

- product source edits
- `.execution/reviews/**`
- any packet docs outside this lane

## Frozen Contracts

- no product or contract changes are allowed in this lane
- this is build/smoke only

## Deliverables

- rebuilt `./jin` binary from the current repo state
- durable audit artifact listing the exact commands run and what each command
  returned
- clear statement whether the bounded local smoke passed, partially passed, or
  is blocked

## Smoke Command Set

Run, in order:

1. `bun run build`
2. `./jin version`
3. `./jin team schema version`
4. `./jin status --json`
5. `./jin connections`

Optional:

- if a bounded foreground startup is attempted, it must be explicitly marked as
  optional in the audit and include the exact stop condition used
- do not use `jin service install`, `jin start --service`, or launchd in this
  packet

## Acceptance Checks

- `bun run build` succeeds
- the rebuilt binary responds to the listed local smoke commands
- the audit artifact records exact command strings and outcomes without
  overclaiming runtime/perf approval

## Stop And Escalate

Stop if:

- the build itself fails
- the rebuilt binary does not start enough to answer the bounded smoke commands
- the smallest next step would require changing product code rather than
  reporting the smoke outcome

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- no product BP change; smoke-only packet

V1 comparison:
- no prior v1 surface

BP alignment:
- no blueprint state change; operational smoke only

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
