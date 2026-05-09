# W3-BP-02: Live Config Cutover Blueprint Hardening

## Role

Codex worker packet.

## Goal

Freeze the blueprint contract for live config generation cutover before further
`#19` implementation. This lane should make the generation lifecycle,
fail-closed invalid-config behavior, status/diagnostic surface, and validation
CUJs explicit enough that follow-on runtime work can implement against one
coherent spec.

## Depends On

- `.execution/reviews/2026-05-03-config-reload-push-worker-tooling-council.md`
- `docs/solutions/2026-05-03-live-config-reload-needs-atomic-writes-and-coordinator-owned-apply.md`

## Unblocks

- a second council pass on live config cutover and interruptible push workers
- follow-on `#19` implementation for fail-closed reload and workerized push
- later validation packets for daemon/service invalid-config behavior

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `.execution/reviews/2026-05-03-config-reload-push-worker-tooling-council.md`
6. `docs/blueprint/BP-02-data-flow.md`
7. `docs/blueprint/BP-06-sink-contract.md`
8. `docs/blueprint/BP-07-process-lifecycle.md`
9. `docs/blueprint/BP-08-routing-and-config.md`
10. `docs/solutions/2026-05-03-live-config-reload-needs-atomic-writes-and-coordinator-owned-apply.md`
11. `docs/execution/audits/2026-05-03-W3-BP-02-live-config-cutover-cuj-matrix.md`
12. `docs/execution/tasks/W3-BP-02-live-config-cutover-blueprint-hardening.md`

## Owned Files

- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-06-sink-contract.md`
- `docs/blueprint/BP-07-process-lifecycle.md`
- `docs/blueprint/BP-08-routing-and-config.md`
- `docs/execution/audits/2026-05-03-W3-BP-02-live-config-cutover-cuj-matrix.md`
- packet-local follow-up docs under `docs/execution/audits/`

## Forbidden Files

- `src/**`
- `test/**`
- `docs/ontology.md`
- `docs/blueprint/BP-03-conversation-model.md`
- `.execution/program.md`
- `.execution/packets/*.md`

## Frozen Contracts

- ontology conversation model
- sink API surface remains unchanged; worker hosting stays an internal runtime
  policy
- `_jin_push_state` advances only from completed parent-confirmed
  `PushResult`s

## Deliverables

- explicit generation lifecycle terminology and stale-work retirement rules
- explicit fail-closed invalid-config semantics across daemon and service mode
- explicit status/diagnostic requirements for generations, interruptions, and
  abandoned delivery
- a concrete CUJ matrix that later validation packets can reuse
- a clear statement of what remains implementation work versus already-frozen
  contract

## Non-Goals

- implementing workerized push execution
- changing sink interfaces
- changing the ontology model
- broad service-manager redesign

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| One live config-generation cutover model is explicit across foreground, daemon, and service mode | BP-02, BP-07, BP-08 | blueprint diff + CUJ matrix |
| Invalid next config fails closed instead of serving stale config | BP-07, BP-08 | blueprint diff + CUJ matrix |
| Interrupted push work never advances `_jin_push_state` without a completed parent-confirmed `PushResult` | BP-02, BP-06 | blueprint diff |
| Status/diagnostics expose active generation, observed generation, reload state, fatal config detail, and interruption visibility | BP-06, BP-07, BP-08 | blueprint diff + CUJ matrix |
| Validation expectations cover stop/reload during push, invalid config in daemon/service mode, and replay recovery | BP-07, BP-08 | blueprint diff + CUJ matrix |

Every row must be resolved in the completion report as:
- implemented, with doc citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

- compare the old startup-snapshot-plus-manual-restart expectation against the
  new coordinator-owned live generation-cutover model
- record any places where v1 tolerated stale runtime continuation and v2
  intentionally does not
- record whether any older operator story depended on sink-specific control
  lanes that are now intentionally removed

## Acceptance Checks

- a reviewer can point to one exact section for generation states and stale-work
  retirement
- a reviewer can point to one exact section for fail-closed invalid-config
  semantics
- a reviewer can point to one exact section for required status/diagnostic
  visibility
- the packet remains doc-only and does not widen runtime interfaces

## Stop And Escalate

Stop if:

- the desired semantics require widening the sink API
- the packet would need to reopen the ontology model
- the right answer obviously requires product decisions about hosted control
  surfaces rather than local/service runtime behavior

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Validation run:
- exact docs reviewed
- any diff/format checks

BP acceptance matrix:
- <requirement> -> implemented in <file>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

V1 comparison:
- old behavior/expectation
- new behavior/expectation
- why the change is intentional

Council readiness:
- what the next review should verify
- what remains implementation work

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
