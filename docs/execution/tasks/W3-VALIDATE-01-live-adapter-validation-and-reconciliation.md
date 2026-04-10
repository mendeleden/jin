# W3-VALIDATE-01: Live Adapter Validation And Store Reconciliation

## Role

Codex worker packet.

## Goal

Create and run a repeatable live-data validation harness against the current
machine's real Cursor, Claude Code, and Codex data so we stop discovering
adapter/runtime failures only when trying to dogfood v2 locally.

This lane should produce:

- a disposable harness that targets live adapter directories
- a temp SQLite store populated through the real v2 path
- a reconciliation report comparing source-layer counts against stored counts
- an audit that identifies any obvious mismatches or missing classes of data

## Depends On

- `docs/execution/tasks/W3-PERF-03-repeatable-v2-performance-harness.md`
- `docs/execution/tasks/W3-ADAPTER-07-claude-code-path-precedence-and-live-hardening.md`
- `docs/execution/audits/2026-04-08-W3-PERF-03-repeatable-v2-performance-harness.md`
- `docs/solutions/2026-04-08-adapter-default-path-selection-must-prefer-populated-sources.md`

## Unblocks

- live adapter confidence before local dogfood
- a reusable sanity check before releases
- faster diagnosis of source-vs-store drift

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/01-dispatch-protocol.md`
3. `docs/execution/04-frozen-contract-surface.md`
4. `docs/execution/05-live-control-plane.md`
5. `docs/blueprint/BP-02-data-flow.md`
6. `docs/blueprint/BP-04-adapter-contract.md`
7. `docs/blueprint/BP-05-store-and-migration.md`
8. `docs/blueprint/BP-10-performance-validation.md`
9. `docs/execution/tasks/W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
10. `docs/execution/tasks/W3-PERF-03-repeatable-v2-performance-harness.md`
11. `docs/execution/tasks/W3-ADAPTER-07-claude-code-path-precedence-and-live-hardening.md`
12. Current code:
   - `src/commands/benchmark.ts`
   - `src/adapters/codex.ts`
   - `src/adapters/claude-code.ts`
   - `src/adapters/cursor.ts`
   - `src/db/store.ts`
   - `src/db/query-surface.ts`
   - `test/perf-harness/**`

## Owned Files

- `scripts/live-validation/**`
- `test/live-validation/**`
- `docs/execution/audits/2026-04-08-W3-VALIDATE-01-live-adapter-validation-and-reconciliation.md`
- `.execution/agents/codex-WORKER-live-adapter-validation.md`

## Forbidden Files

- `src/contracts/**`
- `src/sinks/**`
- `src/commands/team-config.ts`
- service/version/PR/UI work
- broad adapter rewrites outside the minimal harness plumbing

## Frozen Contracts

- adapter v2 interface
- store revision and bundle-hash semantics
- push payload/result semantics
- lifecycle ownership semantics

## Deliverables

- one durable harness command or small script set that:
  - accepts live directory overrides for `cursor`, `claude-code`, and `codex`
  - creates a disposable config dir and SQLite store
  - runs the real v2 discover/load/write path
  - emits machine-readable reconciliation artifacts
- one live-machine audit against the current user's real data for:
  - `cursor`
  - `claude-code`
  - `codex`
- a reconciliation summary for each adapter that compares at minimum:
  - source files touched
  - refs discovered
  - bundles loaded
  - stored conversations
  - stored messages
  - stored tool calls if applicable
- a short list of obvious mismatches or confidence gaps that still need packet
  work

## Non-Goals

- fixing every adapter bug found by the audit
- adding release workflow CI wiring
- changing ontology/runtime/store contracts
- pushing to remote sinks

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| Validation uses the real v2 discover/load/write path, not legacy session/message APIs | BP-02, BP-04 | harness code + audit artifact |
| Reconciliation inspects the disposable SQLite store directly and compares it to source-layer counts | BP-05 | script output + audit artifact |
| The lane stays outside frozen adapter/store/sink contract changes | BP-04, BP-05, BP-06 | diff scope |
| The harness is reusable for future live-data spot checks before release | BP-10 | runbook + exact command citation |

## Acceptance Checks

- one documented command sequence runs against all three live adapters
- a disposable SQLite store is created and queried during validation
- the audit records exact counts and any mismatches per adapter
- completion report states clearly what remains uncovered

## Stop And Escalate

Stop if:

- the harness needs broad product-code changes outside the owned files
- safe live-data validation requires changing frozen adapter/store contracts
- a worktree split becomes mandatory instead of a temp-config/temp-store run

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

Validation run:
- exact live-data commands
- temp config/store paths
- artifact paths

BP acceptance matrix:
- <requirement> -> implemented in <file>, tested by <artifact or test>
- <requirement> -> deferred with Codex approval
- <requirement> -> out of scope per packet boundary

Adapter reconciliation:
- cursor: source vs store summary
- claude-code: source vs store summary
- codex: source vs store summary

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
