# W4-CONFIG-02 - Runtime Reload And Queue Status

Status: queued
Owner: worker
Branch: fix/config-mutation-boundary-19

## Role

Expose durable, immutable runtime status for config reload and pipeline queue state through Jin's daemon-owned status boundary.

## Goal

Operators, CLI commands, Desktop, and tests need to know whether a config reload was accepted, is pending, completed, failed, or is waiting behind other work. Add a stable status snapshot rather than exposing mutable queue internals or relying on log scraping.

## Depends On

- `docs/ontology.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- W4-CONFIG-01 reload control route shape
- Current branch `config-reload` pipeline work item

## Unblocks

- Clear CLI messaging after config mutation
- Desktop runtime status without direct store or process introspection
- Better debugging for slow reload/backfill/sink push behavior
- Future `jin sink repush` progress visibility

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/ontology.md`
5. `docs/blueprint/BP-07-process-lifecycle.md`
6. `docs/blueprint/BP-08-routing-and-config.md`
7. `src/pipeline/types.ts`
8. `src/pipeline/queue.ts`
9. `src/pipeline/loop.ts`
10. `src/commands/watch.ts`
11. `src/commands/status.ts`
12. `src/api/control.ts`
13. `src/api/routes.ts`
14. `test/pipeline-spine.test.ts`
15. `test/local-control-boundary.test.ts`

## Owned Files

- `src/pipeline/types.ts`
- `src/pipeline/queue.ts`
- `src/pipeline/loop.ts`
- `src/commands/watch.ts`
- `src/commands/status.ts`
- `src/api/control.ts`
- `src/api/routes.ts`
- `src/contracts/desktop.ts` if status DTOs are shared with Desktop
- `test/pipeline-spine.test.ts`
- `test/local-control-boundary.test.ts`
- A new focused test file under `test/` if needed
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`

## Forbidden Boundaries

- Do not change config mutation command behavior; W4-CONFIG-01 owns that.
- Do not expose mutable queue objects or sink instances.
- Do not add Desktop-only status contracts for runtime data that the CLI also needs.
- Do not alter sink push, adapter ingestion, or store schema behavior.
- Do not introduce polling-only correctness where the daemon can provide a direct accepted/completed signal.

## Required Design

- Add an immutable runtime snapshot API for pipeline state.
- Snapshot should include enough information to answer: current work item type, queued work item counts/types, last config reload attempt, last config reload success/failure, active config generation or observed config mtime/hash if available, and whether a reload is pending.
- The snapshot must be safe to serialize through the local API and `jin status --json`.
- The snapshot must not leak secrets from config or sink connection strings.
- The snapshot must be compatible with W4-CONFIG-01 reload acknowledgements.
- Prefer small typed DTOs over ad hoc `Record<string, unknown>` payloads.
- Treat W4-CONFIG-01 `202` responses as accepted/enqueued/coalesced only; completed/succeeded/failed belongs to this snapshot.

## Recommended Snapshot Fields

- `generatedAt`
- `stopping`
- `currentWork`
- `queue.pendingCount`
- `queue.pendingByKind`
- `queue.pending`
- `config.generation`
- `config.loadedAt`
- `config.configMtimeMs`
- `configReload.state`
- `configReload.pending`
- `configReload.current`
- `configReload.lastAttempt`
- `configReload.lastSuccess`
- `configReload.lastFailure`

Omit raw config, sink connection strings, webhook headers, S3 credentials, auth tokens, and filesystem change paths. If a config fingerprint is added, it must be generated from a redacted canonical representation.

## Acceptance Checks

- `bun run typecheck`
- `bun test test/pipeline-spine.test.ts test/local-control-boundary.test.ts`
- A focused test proving queue snapshots are immutable copies.
- A focused test proving config reload state transitions are visible after enqueue and after success/failure.
- A focused test proving status output does not leak sink connection strings or config secrets.

## BP Acceptance Matrix

| BP | Requirement | Evidence |
| --- | --- | --- |
| BP-07 | Desktop reads runtime state through daemon-owned APIs. | Status snapshot is available through local API contracts. |
| BP-07 | Runtime status is platform-neutral except transport details. | Snapshot DTO is not Unix-socket-specific. |
| BP-08 | Config reload is coordinator-owned and observable. | Snapshot reports pending/current/last reload state from pipeline loop. |
| BP-08 | Config secrets remain private. | Snapshot omits raw config and sink credentials. |

## V1 Comparison

V1-era status was largely process/config/store oriented. This packet adds explicit runtime operation state as a v2 capability. That is an intentional extension because live config reload, Desktop, and future repush flows need a reliable control-plane status surface.

## Stop And Escalate

Stop if the status shape needs to become a public stable API beyond local daemon clients. That requires a BP-07/BP-08 contract decision before implementation.

## Completion Report

Report changed files, acceptance checks, BP matrix result, V1 comparison, and any status fields intentionally deferred.
