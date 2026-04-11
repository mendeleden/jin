# W3-ADAPTER-09: Claude Code Duplicate-ID Collision Fix And Live Revalidation

## Role

Codex worker packet.

## Goal

Fix the remaining live Claude Code correctness failures from
`W3-VALIDATE-01`:

1. duplicate loaded conversation IDs on the real Claude dataset
2. `UNIQUE constraint failed: messages.id` write failures during disposable
   store validation

This lane exists because `W3-ADAPTER-07` fixed default-path precedence and the
live child-recursion / stack-overflow failure, but the later live validation
still showed an adapter identity bug on real local data.

## Depends On

- `.execution/packets/W3-ADAPTER-07.md`
- `.execution/packets/W3-VALIDATE-01.md`
- `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md`
- `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`

## Unblocks

- clean Claude Code live validation on the real local dataset
- honest sequencing for the Cursor follow-up and remaining sink proof
- workspace-member / `userId` work on a cleaner ingestion baseline

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/execution/tasks/W3-ADAPTER-09-claude-code-duplicate-id-collision-fix-and-live-revalidation.md`
8. `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md`
9. `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
10. Current code:
   - `src/adapters/claude-code.ts`
   - `test/claude-code-reference-adapter.test.ts`
   - `scripts/live-validation/run.ts`
   - `test/live-validation/run.test.ts`
   - `src/db/schema.ts` read-only for the `messages.id` uniqueness boundary

## Owned Files

- `src/adapters/claude-code.ts`
- `test/claude-code-reference-adapter.test.ts`
- `scripts/live-validation/run.ts` only if needed for narrower Claude-only proof
- `test/live-validation/run.test.ts` only if the harness behavior changes
- packet-local audits under `docs/execution/audits/`

## Forbidden Files

- `src/contracts/**`
- `src/pipeline/**`
- `src/sinks/**`
- non-Claude adapter files
- structural adapter split work unless Codex decides it is required
- workspace identity / `userId` design work

## Frozen Contracts

- adapter v2 interface
- pipeline/store/sink contracts
- ontology conversation model

## Deliverables

- root-cause the live duplicate loaded conversation IDs
- fix the live `messages.id` collision class if the smallest safe fix remains
  adapter-local
- add focused regression tests for the discovered identity bug
- rerun the live validation harness for `claude-code` on the real local dataset
- write a packet-local audit with exact commands, counts, and residual issues

## Non-Goals

- general adapter decomposition for maintainability
- Cursor follow-up work
- sink/release workflow changes
- changing store schema or frozen runtime contracts

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Claude live conversation identity is stable across refs loaded from the real local dataset | BP-04 | code diff + focused tests + live audit |
| Disposable-store validation no longer fails on `messages.id` uniqueness for the Claude live run if the fix remains adapter-local | BP-02, BP-04 | live audit + focused regression tests |
| The lane stays inside Claude adapter/harness owned files and does not widen into sink/store contracts | BP-02, BP-04, BP-05, BP-06 | diff scope |
| Remaining duplicate loaded conversation IDs are either eliminated or explicitly explained as expected overlap with Codex approval | BP-04 | audit explanation + reviewable evidence |

## Acceptance Checks

- a focused regression test reproduces the identity collision class or the
  exact fallback if a fixture cannot mirror the live transcript shape
- completion report states whether the duplicate loaded conversation IDs were a
  real adapter bug or expected overlap
- the Claude-only live validation rerun records exact counts for:
  - refs discovered
  - unique conversations loaded
  - duplicate loaded conversation IDs
  - write attempts / write errors
  - stored conversations / messages / tool calls

## Stop And Escalate

Stop if:

- the smallest safe fix requires store schema or contract changes
- the root cause is a shared harness/store bug outside the Claude adapter
- the lane must widen into `W3-ADAPTER-08` maintainability refactoring before a
  safe functional fix can land

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation run:
- exact live/local commands
- duplicate-ID outcome
- disposable-store outcome

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test or artifact>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
