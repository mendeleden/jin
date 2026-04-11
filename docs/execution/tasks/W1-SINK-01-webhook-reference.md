# W1-SINK-01: Webhook Reference Sink

## Role

Worker packet.

## Goal

Implement the v2 webhook sink as the first thin reference sink for the new
push contract.

## Depends On

- `W0-CODEX-01-contract-freeze.md`

## Unblocks

- reference sink behavior for full-snapshot pushes
- later Postgres and S3 sink ports

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/04-frozen-contract-surface.md`
3. `docs/blueprint/BP-06-sink-contract.md`
4. `docs/blueprint/BP-02-data-flow.md`
5. `docs/blueprint/BP-05-store-and-migration.md`
6. Frozen contract files:
   - `src/contracts/conversations.ts`
   - `src/contracts/sinks.ts`
   - `src/contracts/config.ts`
7. Current code:
   - `src/sinks/webhook.ts`
   - `src/sinks/types.ts`
   - relevant sink tests under `test/`

## Owned Files

- `src/sinks/webhook.ts`
- webhook sink tests under `test/`

## Forbidden Files

- `src/sinks/types.ts`
- `src/contracts/**`
- `src/sinks/postgres.ts`
- `src/sinks/s3.ts`
- `src/pipeline/**`
- `src/db/**`
- `src/config.ts`
- `src/routing.ts`

## Frozen Contracts

- `PushPayload`
- `PushResult`
- `attemptedRevision`
- full-snapshot push semantics

## Deliverables

- `healthCheck()`
- batch `push(payloads)`
- BP-06 webhook wire format
- `idempotencyKey` derived from `conversation.id` and `attemptedRevision`
- timeout and error mapping
- no internal retry loop

## Non-Goals

- pipeline retry policy
- route matching
- webhook configuration UX

## Acceptance Checks

- pushed plus failed equals payload count
- each failed conversation is reported explicitly
- request body contains full snapshots, not deltas
- timeout is treated as failure
- tests cover idempotency key generation and partial batch failure behavior

## Stop And Escalate

Stop if:

- the packet needs to change `PushPayload`
- retry policy must move from pipeline to sink
- the packet needs to edit any frozen file under `src/contracts/**`
- webhook config semantics are not frozen enough

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-06: webhook sink contract implemented
- BP-02: sink remains pipeline-driven

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
