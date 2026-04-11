# W3-ADAPTER-05: Adapter Memory Contract Audit and Blueprint Hardening

## Role

Codex worker packet.

## Goal

Audit the full adapter surface for the same class of RSS/retention failure that
surfaced in Codex, then harden the blueprint/runtime guidance so future
adapters are reviewed against an explicit memory contract rather than an
implicit expectation.

This packet exists because `W3-PERF-01` fixed a concrete Codex bug, but the
root lesson appears broader: `BP-04` says `findChanged()` should be cheap and
`loadConversation()` expensive, yet the current blueprint does not make that
rule operational enough to catch duplicate parsing, ref fan-out, or timeout
retention hazards before they hit the live runtime.

## Depends On

- `W3-PERF-01-codex-ingest-rss-budget.md`
- `W3-RECOVERY-01-poisoned-local-store-reset-guidance.md`
- `docs/solutions/2026-04-08-rss-shutdown-poisons-local-sqlite-store.md`
- `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`
- `docs/execution/audits/2026-04-07-v2-runtime-bug-audit.md`

## Unblocks

- higher confidence that other adapters will not repeat the Codex RSS failure
- explicit BP-02 / BP-04 acceptance language for adapter memory behavior
- a reusable audit checklist for future rich adapters

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/execution/tasks/W3-ADAPTER-05-adapter-memory-contract-audit.md`
8. `docs/solutions/2026-04-08-adapter-memory-contract-gap.md`
9. `docs/execution/audits/2026-04-07-v2-runtime-bug-audit.md`
10. Current code:
   - `src/pipeline/ingest.ts`
   - `src/adapters/*.ts`
   - focused adapter/pipeline tests under `test/`

## Owned Files

- `docs/blueprint/BP-02-data-flow.md`
- `docs/blueprint/BP-04-adapter-contract.md`
- `docs/execution/README.md` only if needed for durable audit/process guidance
- a new adapter-memory audit artifact under `docs/execution/audits/`
- focused adapter/pipeline tests or audit helpers under `test/` only if needed
  to lock in a reusable guardrail

## Forbidden Files

- `src/sinks/**`
- `src/commands/team-config.ts`
- `src/commands/schema.ts`
- broad product/CLI/UI work
- one-off adapter rewrites that need their own packet

## Frozen Contracts

- v2 adapter interface shape
- v2 store/sink contracts
- BP-07 lifecycle semantics

## Deliverables

- an adapter-by-adapter audit covering:
  - whether `findChanged()` is metadata/index-only or does full parsing
  - whether `loadConversation()` reparses source already consumed by discovery
  - whether one source unit can fan out many refs and how reclamation happens
  - whether timeout wrappers or caches can retain successful large results
- a clear recommendation on which findings are:
  - already safe
  - documentation gaps only
  - follow-on packets
- BP-02 and/or BP-04 updates that make adapter memory constraints explicit and
  reviewable
- if warranted, one reusable test or checklist artifact that future adapter
  packets can cite

## Non-Goals

- fixing every adapter in one packet
- changing the adapter contract surface
- sink/runtime/store rewrites outside small packet-local guardrails
- re-litigating the Codex-specific RSS fix itself

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| The blueprint now states an explicit adapter memory contract, not just a qualitative discover/load split | BP-02, BP-04 | blueprint diff + audit citations |
| The audit classifies every active adapter against the memory-contract questions | BP-04 | audit artifact with per-adapter findings |
| The packet does not widen frozen adapter/store/sink interfaces | BP-04, BP-05, BP-06 | diff scope, no contract-type edits |
| The prevention path for future adapters is explicit enough to use in packet reviews | BP-02, BP-04 | checklist/test/doc update |

Every row must be resolved in the completion report as:
- implemented, with code + doc/test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## Acceptance Checks

- the completion report clearly distinguishes:
  - Codex-only bug
  - cross-adapter design gap
  - blueprint/process gap
- any adapters that need follow-on fixes are named explicitly with file
  citations and recommended packet ownership
- the packet leaves behind a durable review aid for future adapter work

## Stop And Escalate

Stop if:

- closing the gap requires changing the frozen adapter interface itself
- the packet would need broad multi-adapter code rewrites rather than audit +
  blueprint + narrow guardrails
- the best next step is obviously multiple narrower packets and the audit should
  stop at packetization

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

Cross-adapter findings:
- <adapter> -> safe / doc gap / follow-on packet, with file citation

Blueprint hardening:
- BP-02 / BP-04 changes and why they close the gap

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
