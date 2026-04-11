# W2-SINK-03: S3 Reference Sink

## Role

Worker packet.

## Goal

Implement the S3-compatible sink as the reference object-sink family for
BP-06.

## Depends On

- `W0-CODEX-01-contract-freeze.md`
- preferably `W1-SINK-01-webhook-reference.md`

## Unblocks

- BP-06 validation for object sinks
- archive/export integration scenarios

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-06-sink-contract.md`
3. `docs/blueprint/BP-02-data-flow.md`
4. Current code:
   - `src/sinks/s3.ts`
   - `src/sinks/types.ts`
   - relevant sink tests under `test/`

## Owned Files

- `src/sinks/s3.ts`
- S3 sink tests under `test/`

## Forbidden Files

- `src/sinks/types.ts`
- `src/sinks/webhook.ts`
- `src/sinks/postgres.ts`
- `src/db/**`
- `src/pipeline/**`
- `src/config.ts`

## Frozen Contracts

- sink interface
- push payload semantics
- no remote provisioning rule

## Deliverables

- `healthCheck()` for bucket/credentials readiness
- full-snapshot object upload behavior
- stable key-path strategy aligned to BP-06
- no bucket creation or policy mutation behavior

## Non-Goals

- provisioning buckets
- remote lifecycle management
- route matching or pipeline retry logic

## Acceptance Checks

- uploaded object shape contains full snapshots
- stable key path is derived per BP-06
- no provisioning is attempted
- tests cover readiness failure and object key generation

## Stop And Escalate

Stop if:

- the sink needs new payload semantics
- provisioning behavior seems required to make tests pass

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-06: object sink family implemented
- BP-02: pipeline-owned scheduling preserved

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
