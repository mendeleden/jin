# W3-TEAM-03: Canonical Export User Identity Implementation

## Role

Codex worker packet.

## Goal

Implement the BP-approved hard cut from legacy sink/export identity
(`developerId`, `developer_id`) to canonical sink-scoped `userId`.

This packet is the first implementation lane after `W3-TEAM-02` doc approval.

## Depends On

- `W3-TEAM-02-canonical-export-user-identity.md`

## Business Need

External systems need per-user analytics on exported conversations.
The first concrete customer path is Jin Team + Postgres, but the identity
surface must be coherent across generic sinks.

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/proposals/canonical-export-user-identity.md`
3. `docs/blueprint/BP-06-sink-contract.md`
4. `docs/blueprint/BP-08-routing-and-config.md`
5. `docs/blueprint/BP-09-cli-split.md`
6. `docs/ontology.md`
7. Current code:
   - `src/contracts/config.ts`
   - `src/config.ts`
   - `src/index.ts`
   - `src/commands/sink.ts`
   - `src/commands/team-bridge.ts`
   - `src/commands/connect.ts`
   - `src/commands/schema.ts`
   - `src/sinks/postgres.ts`
   - `src/sinks/s3.ts`
   - `src/sinks/webhook.ts`
   - `src/sinks/types.ts`
   - focused tests and perf-harness scripts touching sink/export identity

## Owned Files

- `src/contracts/config.ts`
- `src/config.ts`
- `src/index.ts`
- `src/commands/sink.ts`
- `src/commands/team-bridge.ts`
- `src/commands/connect.ts`
- `src/commands/schema.ts`
- `src/sinks/postgres.ts`
- `src/sinks/s3.ts`
- `src/sinks/webhook.ts`
- `src/sinks/types.ts`
- focused tests under `test/`
- focused perf-harness scripts under `test/perf-harness/`

## Forbidden Files

- `src/contracts/sinks.ts`
- `src/db/**`
- `src/pipeline/**`
- `src/adapters/**`

## Frozen Contracts

- `userId` is sink-scoped export metadata, not conversation payload identity
- `PushPayload` shape remains unchanged
- Postgres integration schema is `jin_*`, not legacy `jin_sessions`
- object sinks may project export metadata only through top-level `_meta`
- delivery sinks may project export metadata only through integration headers
- this lane is a hard cut; do not preserve `developerId` / `developer_id`
  compatibility in live sink/export paths

## Deliverables

- config and sink contracts preserve canonical `userId`
- `jin sink add` / `jin team bridge` / `jin connect --team=<code>` preserve
  `teamId` / `userId`
- Postgres schema/write/read surfaces use `user_id` and `jin_conversations`
- webhook uses `X-Jin-User` only
- S3 `_meta` uses `userId` only
- legacy sink/export `developerId` / `developer_id` refs are removed from live
  code paths
- tests that still validate live v2 behavior are migrated to `userId`
- tests that only protect dead legacy sink/export paths are deleted

## Non-Goals

- changing local conversation/store ontology
- adding top-level global identity config
- automatic OS-derived identity
- preserving a compatibility alias from `developerId` to `userId`

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| `userId` stays sink-scoped export metadata | BP-06, BP-08 | config + sink code/tests |
| `PushPayload` remains unchanged | BP-06 | sink implementation/tests only project metadata externally |
| `jin connect --team=<code>` preserves bridge-carried export metadata | BP-09 | `src/commands/connect.ts`, focused tests |
| `jin sink add` / `jin team bridge` support canonical `--user-id` | BP-08, BP-09 | CLI parsing/help + focused tests |
| Postgres uses `team_id` / `user_id` on `jin_conversations` only | BP-06, ontology | schema, sink writer, read/search tests |
| S3 `_meta` and webhook headers use canonical projection names | BP-06 | sink implementations/tests |
| legacy `developerId` / `developer_id` live sink/export paths are removed | proposal + BP-approved hard cut | code + tests/harness updates |

## V1 Comparison

- intentional BP-backed change:
  - legacy `developerId` / `developer_id` sink-export vocabulary is removed
  - legacy `jin_sessions` remote assumptions are removed from live v2 sink paths

## Acceptance Checks

- no live sink/export code path depends on `developerId`
- no live Postgres sink/export path depends on `jin_sessions`
- focused tests pass for config, connect, Postgres, S3, webhook
- perf harness verification scripts speak `userId` / `user_id`

## Stop And Escalate

Stop if:

- the change would require modifying `PushPayload`
- the change would require storing `userId` in local conversation/store models
- another blueprint contradiction appears that changes sink/export ownership

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
- intentional BP-backed hard cut from developerId/developer_id to userId/user_id

BP alignment:
- BP-06: sink-scoped export metadata only
- BP-08: canonical config schema and command surface
- BP-09: bridge/connect identity preservation
- ontology: Postgres integration metadata columns

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
