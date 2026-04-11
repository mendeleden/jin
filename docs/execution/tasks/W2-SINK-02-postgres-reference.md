# W2-SINK-02: Postgres Reference Sink

## Role

Worker packet.

## Goal

Implement the Postgres sink as the reference table-sink family for BP-06,
including schema-version handshake and no-DDL behavior.

## Depends On

- `W0-CODEX-01-contract-freeze.md`
- preferably `W1-SINK-01-webhook-reference.md`

## Unblocks

- BP-06 validation for table sinks
- later enterprise/integration work that depends on table-sink semantics

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-06-sink-contract.md`
3. `docs/blueprint/BP-05-store-and-migration.md`
4. `docs/blueprint/BP-02-data-flow.md`
5. Current code:
   - `src/sinks/postgres.ts`
   - `src/sinks/postgres-search.ts`
   - `src/sinks/types.ts`
   - relevant sink tests under `test/`

## Owned Files

- `src/sinks/postgres.ts`
- Postgres sink tests under `test/`

## Forbidden Files

- `src/sinks/types.ts`
- `src/sinks/webhook.ts`
- `src/sinks/s3.ts`
- `src/db/**`
- `src/pipeline/**`
- `src/config.ts`

## Frozen Contracts

- sink interface
- push payload semantics
- no privileged remote provisioning rule

## Deliverables

- `healthCheck()` with schema/version handshake semantics
- full-snapshot `push(payloads)` for Postgres
- no DDL or provisioning behavior in normal push path
- per-conversation result reporting aligned to the sink contract

## Non-Goals

- productizing Team as a Postgres sink
- admin migration tooling
- search/query UX

## Acceptance Checks

- remote schema/version mismatch blocks or pauses pushes per BP-06
- no DDL is emitted during normal push behavior
- pushed plus failed equals payload count
- tests cover handshake success, mismatch, and no-schema scenarios

## Stop And Escalate

Stop if:

- implementing the sink requires schema ownership decisions outside BP-06
- Team-specific product behavior starts leaking into the generic sink

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-06: table sink family implemented
- BP-02: pipeline-owned scheduling and retry model preserved

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
