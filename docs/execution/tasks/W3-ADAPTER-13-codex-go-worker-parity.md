# W3-ADAPTER-13: Codex Go Worker Parity

## Role

Worker packet and implementation PRD.

## Goal

Add an experimental Go-backed worker path for the `codex` adapter behind an
explicit flag, with parity proven against the current TS implementation before
any live defaulting decision.

This packet is not "make Codex faster at any cost." It is:

1. define the narrowest safe Codex Go-worker surface
2. prove exact parity at the unit / worker / persisted-result / hash levels
3. prove the experimental path does not regress end-to-end ingest on the
   current fixture set

## Problem Statement

The Claude Go-worker experiment proved that fixture parity alone is not enough.
The real contract includes:

- ref emission parity
- ref resolution parity
- JSON-RPC streaming behavior through the worker seam
- persisted bundle/message/tool-call parity
- end-to-end rebuild parity on realistic data

Codex has different source structure and different adapter semantics than
Claude. It uses rollout JSONL files under `~/.codex/sessions/**` and
`~/.codex/archived_sessions/**`, emits multiple local segments from one source
file, and already has special ingest batching and memory-sensitive behavior in
the runtime.

So the Codex Go-worker lane must start from a stricter TDD matrix than the
Claude lane did.

## Product Requirements

### Functional

1. Jin must support an experimental Go worker selection path for the `codex`
   adapter behind an explicit environment flag.
2. The initial experiment must preserve current TS Codex adapter semantics.
3. The selected Go worker path must successfully ingest Codex conversations via
   the existing JSON-RPC worker protocol without changing frozen pipeline/store
   contracts.
4. The experiment must preserve deterministic conversation/message/tool-call
   identity and normalized bundle hashes on the verified Codex fixtures.

### Validation

1. Unit tests must cover Codex parser semantics that are easy to regress:
   segment boundaries, relationship semantics, tool-call extraction, token
   accounting, naming, timestamps, and deterministic IDs.
2. Worker streaming tests must prove that the TS worker and Go worker emit the
   same persisted result through `ingestConversationViaWorker`.
3. Batch/hash tests must prove exact normalized bundle parity between the TS
   adapter and the Go path on representative Codex fixtures.
4. End-to-end validation must prove that enabling the Codex Go worker under the
   experiment flag does not change expected acceptance results except where the
   packet explicitly records an intentional difference.

### Rollout

1. The experiment must remain opt-in behind a Codex-specific flag.
2. The packet must not default the Codex adapter to Go.
3. If the safest first cut is `loadConversation`-only with `findChanged`
   remaining in TS, keep that boundary explicit and document why.
4. If the worker must move both `findChanged` and `loadConversation` to preserve
   Codex ref parity, stop and record that decision explicitly in the packet
   handoff.

## Depends On

- `W2-ADAPTER-02-codex-reference.md`
- `W3-SCALE-01-deterministic-scale-datasets.md`
- `W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
- `docs/solutions/2026-05-03-worker-parity-must-cover-ref-contracts-and-subagent-ids.md`

## Unblocks

- Codex-specific worker-path experimentation with a parity bar stronger than the
  original Claude spike
- future cross-adapter worker selection cleanup once both Claude and Codex have
  verified experimental seams
- clearer evidence on whether Go-worker gains are adapter-specific or systemic

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/05-live-control-plane.md`
4. `docs/blueprint/BP-02-data-flow.md`
5. `docs/blueprint/BP-03-conversation-model.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/blueprint/BP-05-store-and-migration.md`
8. `docs/blueprint/BP-10-performance-validation.md`
9. Codex reference docs:
   - `docs/adapters/codex/index.md`
   - `docs/adapters/codex/investigation.md`
   - `docs/adapters/codex/orchestration.md`
10. Current code:
   - `src/adapters/codex.ts`
   - `src/pipeline/worker-command.ts`
   - `src/pipeline/ingest-worker.ts`
   - `src/pipeline/ingest.ts`
   - `tools/parser-spike/go-parser/main.go`
11. Current tests and validation surfaces:
   - `test/worker-go-parity.test.ts`
   - `test/worker-command.test.ts`
   - `test/worker-ingest.test.ts`
   - `test/acceptance/verify.ts`
   - `test/discovery-cache.test.ts`
   - `test/runtime-store-cutover.test.ts`
   - `test/fixtures/codex/`

## Owned Files

- `docs/execution/tasks/W3-ADAPTER-13-codex-go-worker-parity.md`
- `docs/execution/prompts/W3-ADAPTER-13-worker-codex.md`
- `docs/execution/prompts/W3-ADAPTER-13-review-codex.md`
- `.execution/program.md`
- `.execution/packets/W3-ADAPTER-13.md`
- `.execution/agents/codex-WORKER-codex-go-worker.md`
- `.execution/agents/codex-REVIEWER-codex-go-worker.md`
- `src/pipeline/worker-command.ts`
- `src/pipeline/ingest-worker.ts`
- `src/pipeline/ingest.ts`
- `tools/parser-spike/go-parser/**`
- Codex Go-worker tests under `test/`
- Codex fixtures only if needed for coverage
- follow-up review/telemetry notes for this packet only

## Forbidden Files

- `docs/blueprint/**`
- `src/contracts/**`
- `src/db/**`
- `src/store.ts`
- non-Codex adapter implementations except read-only reference
- unrelated release / sink / service / UI surfaces

## Frozen Contracts

- conversation identity and relationship semantics
- adapter contract semantics
- worker JSON-RPC method names and notification semantics
- local-store revision / bundle-hash semantics

## Implementation Guidance

1. Preserve TS Codex as ground truth. Do not silently "fix" Codex semantics in
   the Go path unless the TS behavior is provably wrong and Codex approval is
   recorded.
2. Prefer the narrowest safe experiment surface.
   - Default assumption: `loadConversation` moves first, `findChanged` remains
     TS until Codex ref parity is proven.
   - If that assumption fails, stop and document why the split is unsafe.
3. Keep worker selection adapter-specific.
   - Do not widen the Claude experiment flags.
   - Add Codex-specific env vars and log messages if a Codex Go path is added.
4. Reuse the existing worker protocol.
   - Do not invent a second streaming protocol.
   - Extend the Go worker server only as needed to support Codex request/response
     behavior through the existing JSON-RPC seam.
5. Make parity measurable.
   - exact persisted result equality
   - exact normalized bundle-hash equality
   - explicit fixture names
   - explicit acceptance commands in the handoff

## TDD Order

Implement in this order and keep the tests green at each step:

1. unit-level Codex parser / normalization coverage
2. worker command selection coverage for Codex flagging and fallback
3. JSON-RPC worker streaming parity tests
4. persisted-result parity tests through `ingestConversationViaWorker`
5. batch / normalized bundle-hash parity tests on real Codex fixtures
6. end-to-end acceptance validation with the Codex Go worker experiment enabled

## Required Validation Artifacts

Before this packet can be approved, it must produce:

1. a worker completion report with explicit code/test citations for every BP row
2. a review artifact verifying those rows against code and tests
3. a reviewable validation artifact under `docs/execution/audits/` that records:
   - exact commands run
   - fixture / dataset scope
   - whether the run was local, CI, or both
   - persisted-result parity status
   - normalized bundle-hash parity status
   - e2e acceptance status
   - any measured runtime / RSS observations, clearly marked as secondary to correctness

## Acceptance Checks

- Codex Go worker remains opt-in behind a Codex-specific flag
- worker selection logs make it clear whether Codex uses TS or Go
- focused unit tests cover Codex segment / tool / ID semantics
- `test/worker-command.test.ts` covers Codex experiment selection and fallback
- worker parity tests prove TS vs Go persisted-result equality on real Codex
  fixtures
- any worker event comparison ignores only explicitly non-deterministic sample
  telemetry fields; all semantic notifications must match
- normalized bundle hashes match between TS and Go on the verified Codex
  fixture set
- acceptance/e2e validation passes with the Codex Go worker flag enabled
- `docs/execution/audits/` contains a reviewable Codex Go-worker validation note
  with exact commands and outcomes
- any residual mismatch is documented as `deferred` or `blocked`, not ignored

## BP Acceptance Matrix

- `BP-02` data flow and staging parity -> implement via existing worker seam in
  `src/pipeline/worker-command.ts` / `src/pipeline/ingest-worker.ts`, tested by
  worker parity and acceptance coverage in this packet
- `BP-03` conversation identity / relationship semantics -> preserve TS Codex
  output exactly; test by unit and hash parity coverage; any drift requires
  Codex escalation
- `BP-04` adapter contract parity -> Go path must emit the same normalized
  `ConversationBundle` content as the TS Codex adapter, tested by fixture hash
  equality and persisted-result parity
- `BP-05` local-store write semantics -> prove the parent store sees equivalent
  streamed conversation/message/tool-call results through
  `ingestConversationViaWorker`
- `BP-10` performance/validation discipline -> produce a reviewable validation
  artifact under `docs/execution/audits/` with exact commands, dataset scope,
  local/CI status, and parity outcomes; performance claims are allowed only
  after correctness is green

## V1 Comparison

- prior surface exists: the current TS Codex worker path
- required outcome: parity preserved across these explicit surfaces:
  - worker command selection and fallback behavior
  - `findChanged` / `loadConversation` routing split
  - JSON-RPC notification semantics
  - persisted store results through `ingestConversationViaWorker`
  - normalized bundle hashes on verified Codex fixtures
  - acceptance/e2e outcomes when the experiment flag is enabled
- no intentional V1 behavior change is authorized by this packet

## Stop And Escalate

Stop if:

- moving only `loadConversation` is unsafe because Codex `findChanged` refs
  cannot be resolved by the Go path
- Codex source semantics cannot be represented through the current worker
  protocol without contract changes
- exact hash parity fails in a way that requires changing TS Codex semantics
- the work expands into cross-adapter worker unification rather than Codex-only
  execution

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP acceptance matrix:
- BP-02 -> implemented in <file>, tested by <test>
- BP-03 -> implemented in <file>, tested by <test>
- BP-04 -> implemented in <file>, tested by <test>
- BP-05 -> implemented in <file>, tested by <test>
- BP-10 -> implemented in <file>, tested by <test>

V1 comparison:
- parity preserved with the current TS Codex worker path
- or deferred regression with explicit Codex approval

BP alignment:
- BP-02: ...
- BP-03: ...
- BP-04: ...
- BP-05: ...
- BP-10: ...

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
