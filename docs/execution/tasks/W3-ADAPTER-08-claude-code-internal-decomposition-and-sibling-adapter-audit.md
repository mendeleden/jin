# W3-ADAPTER-08: Claude Code Internal Decomposition And Sibling Adapter Audit

## Role

Codex worker packet.

## Goal

Reduce the structural complexity of the Claude Code adapter without changing
its public behavior, frozen contracts, or ontology semantics.

This lane exists because:

- `src/adapters/claude-code.ts` is now `1466` LoC
- the file currently mixes path selection, discovery, caching, parsing,
  relationship resolution, git lookup, and legacy-shim shaping
- future Claude follow-ups will be harder to review safely if every change
  lands in one monolithic file

This packet also requires a short read-only sibling assessment for `codex` and
`cursor`, which are similarly large (`1344` LoC and `1310` LoC respectively),
so Codex can decide whether to queue analogous refactor packets.

## Depends On

- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-05-store-and-migration.md`
- `docs/ontology.md`
- `docs/execution/tasks/W3-ADAPTER-07-claude-code-path-precedence-and-live-hardening.md`
- `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md`
- `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`

## Unblocks

- narrower Claude follow-up work with smaller review surfaces
- clearer BP-04 memory-contract review for Claude discovery/load paths
- Codex decisions on whether `codex` and `cursor` need the same internal split

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/blueprint/BP-05-store-and-migration.md`
8. `docs/ontology.md`
9. `docs/execution/tasks/W3-ADAPTER-08-claude-code-internal-decomposition-and-sibling-adapter-audit.md`
10. `docs/execution/audits/2026-04-08-W3-ADAPTER-07-claude-code-live-hardening.md`
11. `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
12. Current code:
   - `src/adapters/claude-code.ts`
   - `src/adapters/codex.ts`
   - `src/adapters/cursor.ts`
   - `test/claude-code-reference-adapter.test.ts`
   - `test/live-validation/run.test.ts`

## Owned Files

- `src/adapters/claude-code.ts`
- new Claude-only internal files under `src/adapters/claude-code/**`
- `test/claude-code-reference-adapter.test.ts`
- `test/live-validation/run.test.ts` only if needed for import-path or harness
  compatibility after the split
- packet-local audits under `docs/execution/audits/`

## Forbidden Files

- `src/contracts/**`
- `src/pipeline/**`
- `src/store/**`
- `src/db/**`
- `src/sinks/**`
- `src/adapters/codex.ts`
- `src/adapters/cursor.ts`
- product/team/user-identity surfaces
- service/version/PR/UI work

## Frozen Contracts

- adapter v2 interface
- BP-04 discover/load memory contract
- ontology conversation identity and relationship semantics
- pipeline/store/sink contracts

## Deliverables

- split `src/adapters/claude-code.ts` into a small public adapter shell plus
  Claude-only internal modules
- preserve all current Claude behavior from `W3-ADAPTER-07`, including:
  - populated-path precedence
  - child `agentId` handling
  - spawned/compacted trace semantics
  - bounded one-source cache / discovery-load behavior
- keep the external adapter surface stable:
  - `detect()`
  - `findChanged()`
  - `loadConversation()`
  - `watchPaths()`
  - retained legacy shim methods, if still present
- focused regression coverage proving the split did not change Claude behavior
- a short packet-local sibling audit stating whether `codex` and/or `cursor`
  should receive analogous decomposition packets next, with concrete reasons

## Non-Goals

- fixing Claude `messages.id` collisions or duplicate loaded conversation IDs
- refactoring `codex` or `cursor` in this lane
- changing adapter contracts or ontology semantics
- adding `userId` / workspace identity behavior
- changing pipeline, store, sink, or Team surfaces

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Claude keeps the same BP-04 public adapter contract after the split | BP-04 | diff scope + focused tests |
| Discovery/load memory behavior stays bounded and does not regress into multi-source full-bundle retention | BP-04, BP-02 | code citations + completion report |
| Ontology identity semantics (`id`, `traceId`, `parentId`, `relationship`, `forkPoint`) remain unchanged | ontology, BP-04 | focused tests + audit note |
| The lane stays inside Claude adapter internals and does not widen pipeline/store/sink contracts | BP-02, BP-04, BP-05, BP-06 | diff scope |
| Codex gets a clear sibling recommendation for `codex` and `cursor` based on current file shape, not intuition | BP-04 | packet-local audit |

## Acceptance Checks

- `bun test test/claude-code-reference-adapter.test.ts` passes
- any touched live-validation fixture tests still pass
- completion report includes a concise module map for the new Claude internal
  structure
- audit includes an explicit `codex` / `cursor` recommendation:
  - `needs similar packet now`
  - `should wait`
  - `does not need it`

## Stop And Escalate

Stop if:

- the safest split requires changing adapter interface semantics
- the split exposes a real functional bug whose smallest safe fix crosses into
  pipeline/store/ontology ownership
- the work starts turning into a shared rich-adapter framework rather than a
  Claude-local decomposition

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Module map:
- public adapter shell:
- discovery / indexing:
- parser / normalization:
- relationships / parent resolution:
- legacy shim:

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <test or artifact>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- parity kept / intentional BP-backed change / deferred regression
- or `no prior v1 surface`

Sibling adapter note:
- codex:
- cursor:

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
