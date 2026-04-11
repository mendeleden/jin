# W3-BP-01: Performance Validation Blueprint Hardening

## Role

Codex worker packet.

## Goal

Codify repeatable performance validation as a blueprint-level contract. This
lane should decide whether existing BPs are enough once hardened, or whether a
new performance-validation blueprint is warranted.

## Depends On

- `docs/execution/tasks/W3-ADAPTER-05-adapter-memory-contract-audit.md`
- `docs/execution/tasks/W3-PERF-02-full-runtime-rss-shutdown-flush.md`
- `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`
- `docs/solutions/2026-04-08-runtime-rss-needs-streamed-discovery-and-small-push-batches.md`

## Unblocks

- explicit release-gate expectations for perf
- stronger future adapter/runtime packet reviews
- a coherent decision on whether persisted adapter state belongs in scope later

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-01-module-map.md`
6. `docs/blueprint/BP-02-data-flow.md`
7. `docs/blueprint/BP-03-conversation-model.md`
8. `docs/blueprint/BP-04-adapter-contract.md`
9. `docs/blueprint/BP-05-store-and-migration.md`
10. `docs/execution/performance-persona-council.md`
11. `docs/execution/tasks/W3-BP-01-performance-validation-blueprint-hardening.md`
12. `docs/execution/tasks/W3-ADAPTER-05-adapter-memory-contract-audit.md`
13. `docs/execution/tasks/W3-PERF-02-full-runtime-rss-shutdown-flush.md`

## Owned Files

- `docs/blueprint/BP-01-module-map.md`
- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/blueprint/README.md`
- `docs/blueprint/BP-10-performance-validation.md` only if the best answer is a
  new dedicated blueprint
- packet-local audit/decision artifact under `docs/execution/audits/`

## Forbidden Files

- `src/**`
- `test/**`
- service/version/PR/UI work

## Frozen Contracts

- ontology conversation model
- adapter/store/sink runtime interfaces

## Deliverables

- blueprint hardening that makes performance validation operational, not
  implicit
- a clear decision on:
  - harden BP-01/BP-02/BP-04 only, or
  - add `BP-10` for performance validation
- explicit guidance on:
  - stage budgets
  - repeatable artifacts
  - local vs CI validation
  - when lightweight persisted adapter state is acceptable
- a short persona-council synthesis using the lenses in
  `docs/execution/performance-persona-council.md`

## Non-Goals

- implementing the perf harness itself
- implementing dataset generation
- revisiting the ontology relationship model
- broad runtime rewrites

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Rich-adapter discovery/load budget expectations are explicit and reviewable | BP-01, BP-04 | blueprint diff |
| Release perf validation is defined as a repeatable program step, not tribal knowledge | BP-02 and/or BP-10 | blueprint diff + decision artifact |
| The blueprint states when persisted adapter state is allowed and what may be persisted | BP-04, BP-05 | blueprint diff |
| The packet does not change the ontology model or runtime interfaces | BP-03, BP-04, BP-05 | diff scope |

## Acceptance Checks

- completion report clearly states whether `BP-10` was added or intentionally
  avoided
- any rewrite to prior BP language is justified with citations to the recent
  runtime failures
- future packets can cite one blueprint section for release perf validation

## Stop And Escalate

Stop if:

- the right answer obviously requires code prototypes before blueprint edits
- the packet would need to change frozen runtime or ontology contracts
- there is no coherent blueprint split and a product decision is required

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Validation run:
- exact docs reviewed
- blueprint decision reached

BP acceptance matrix:
- <requirement> -> implemented in <file>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

Blueprint decision:
- harden existing BPs / add BP-10
- why

Persisted-state guidance:
- what may be persisted
- what must remain ephemeral

Persona council:
- telemetry-agent lens:
- streaming-reliability lens:
- sqlite/local-state lens:
- release-engineer lens:

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
