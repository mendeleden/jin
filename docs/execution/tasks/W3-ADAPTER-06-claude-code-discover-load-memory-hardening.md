# W3-ADAPTER-06: Claude Code Discover/Load Memory Hardening

## Role

Codex worker packet.

## Goal

Bring the Claude Code adapter back into the hardened BP-02/BP-04 memory
contract by removing retained full-bundle discovery behavior.

This packet exists because `W3-ADAPTER-05` found that `claude-code` is the one
remaining adapter-side memory hazard:

- `findChanged()` forces `getFileModel(filePath, true)` for changed files
- `getFileModel()` retains `FileModel` objects with full `bundles` in
  `parsedFileCache`
- `loadConversation()` then serves clones from that retained cache
- parent resolution can also pull parent bundles into memory during
  discovery/load

The target is not a broad adapter rewrite. The target is a narrow shift back to
the intended cost split:

- discovery computes bounded refs / metadata / parent linkage and releases
  source-heavy state
- load materializes full bundles on demand with bounded local reuse

## Depends On

- `W3-ADAPTER-05-adapter-memory-contract-audit.md`
- `W3-PERF-01-codex-ingest-rss-budget.md`

## Unblocks

- `BP-04` returning to `aligned`
- `BP-02` returning to `aligned` once the Codex RSS evidence lane also closes
- cross-adapter confidence after the Codex RSS regression

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/execution/tasks/W3-ADAPTER-06-claude-code-discover-load-memory-hardening.md`
8. `docs/execution/audits/2026-04-07-adapter-memory-contract-audit.md`
9. Current code/tests:
   - `src/adapters/claude-code.ts`
   - `test/claude-code-reference-adapter.test.ts`
   - any focused packet-local adapter memory tests you add

## Owned Files

- `src/adapters/claude-code.ts`
- focused Claude Code adapter tests under `test/`
- packet-local docs/audits needed to prove the representative validation path

## Forbidden Files

- `src/contracts/**`
- `src/pipeline/loop.ts`
- `src/sinks/**`
- Team/bootstrap/runtime/store/recovery code
- broad blueprint rewrites outside packet-owned evidence

## Frozen Contracts

- adapter v2 bundle contract
- BP-02 runtime guard semantics
- BP-04 discover/load contract
- deterministic IDs, parent linkage, compaction semantics, and current bundle
  output shape

## Deliverables

- `claude-code` discovery no longer retains full bundles across many changed
  files
- `loadConversation()` still returns the same deterministic bundle shape for
  existing focused tests
- packet-local validation demonstrates bounded representative memory behavior or
  bounded retained state, with the measurement path stated explicitly
- completion report cites the exact code and tests for each acceptance row

## Non-Goals

- generic multi-adapter refactors
- pipeline-wide policy changes
- sink/store/runtime lifecycle work
- conversation naming or trace-topology cleanups unless strictly required by
  this packet

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Claude Code discovery obeys the hardened BP-04 memory contract: bounded structural scan only, no retained full-bundle discovery cache across changed files | BP-04 | `src/adapters/claude-code.ts`, focused tests |
| `loadConversation()` still preserves deterministic IDs, parent linkage, compaction/sub-agent semantics, and bundle shape | BP-04 | `src/adapters/claude-code.ts`, `test/claude-code-reference-adapter.test.ts` |
| The fix does not widen adapter/store/sink contracts or spill into runtime/store recovery lanes | BP-02, BP-04 | diff scope, no contract edits |
| Representative packet-local validation makes the memory improvement explicit enough to close the follow-on noted by `W3-ADAPTER-05` | BP-02, BP-04 | packet-local test/audit artifact |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## Acceptance Checks

- focused Claude Code adapter tests stay green
- the retained-bundle discovery path identified in `W3-ADAPTER-05` is removed
  or explicitly bounded to source-local reuse with eviction
- packet-local validation explains why this closes the follow-on for Claude
  Code specifically, not just by analogy to Codex

## Stop And Escalate

Stop if:

- the smallest safe fix requires widening the frozen adapter contract
- preserving deterministic Claude Code bundle semantics requires pipeline/store
  changes outside packet ownership
- representative validation cannot be made packet-local without a Codex
  decision on harness shape

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
- parity kept / intentional memory-only change / deferred regression

BP alignment:
- BP-02/BP-04: Claude Code discover/load split now honors the explicit memory contract

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
