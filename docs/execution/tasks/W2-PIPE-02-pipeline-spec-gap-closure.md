# W2-PIPE-02: Pipeline Spec Gap Closure

## Role

Worker packet.

## Goal

Close the remaining in-scope BP-02 and BP-08 behaviors that `W1-PIPE-01`
left unimplemented without reopening the pipeline architecture or widening
the frozen contract surface.

## Depends On

- `W1-PIPE-01-pipeline-spine.md`
- `W2-CONFIG-02-mutation-and-control-commands.md`

## Unblocks

- full BP-02 compliance for the v2 pipeline path
- Wave 3 integration without known pipeline completeness gaps

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/execution/04-frozen-contract-surface.md`
3. `docs/blueprint/BP-02-data-flow.md`
4. `docs/blueprint/BP-08-routing-and-config.md`
5. `docs/blueprint/BP-07-process-lifecycle.md`
6. Frozen contract files:
   - `src/contracts/pipeline.ts`
   - `src/contracts/adapters.ts`
   - `src/contracts/sinks.ts`
   - `src/contracts/config.ts`
   - `src/contracts/lifecycle.ts`
7. Current code:
   - `src/pipeline/**`
   - `src/commands/watch.ts` (v1 comparison only)

## Owned Files

- `src/pipeline/**`
- pipeline-focused tests under `test/`

## Forbidden Files

- `src/contracts/**`
- `src/db/**`
- `src/sinks/**`
- `src/adapters/**`
- `src/config.ts`
- `src/routing.ts`
- `src/commands/**`
- `src/watcher.ts`

## Frozen Contracts

- adapter interface
- push payload semantics
- lifecycle ownership semantics
- pipeline timeout constants

## Deliverables

- per-call adapter timeout enforcement that consumes the frozen timeout
  constants from `src/contracts/pipeline.ts`
- RSS warning and hard-limit enforcement in the v2 pipeline path
- disabled-sink filtering in the push path without widening the frozen sink
  contract
- focused tests that prove timeout handling, RSS budget behavior, and disabled
  sink skipping

## Non-Goals

- service unit tuning such as `CPUQuota` in `src/commands/service.ts`
- new sink or adapter contract fields
- command-surface redesign
- unrelated pipeline cleanup

## BP Acceptance Matrix

| Requirement | Blueprint | Expected evidence |
|-------------|-----------|-------------------|
| `findChanged()` times out after the frozen default budget and the adapter is skipped for that cycle | BP-02 §Per-Adapter Timeout; `DEFAULT_FIND_CHANGED_TIMEOUT_MS` | `src/pipeline/ingest.ts` + focused timeout test |
| `loadConversation()` times out after the frozen default budget and only that ref is skipped | BP-02 §Per-Adapter Timeout; `DEFAULT_LOAD_CONVERSATION_TIMEOUT_MS` | `src/pipeline/ingest.ts` + focused timeout test |
| RSS warning/hard-limit checks run inside the v2 pipeline path between ingest batches; hard limit triggers bounded shutdown handling | BP-02 §Resource Budget | `src/pipeline/loop.ts` and/or `src/pipeline/ingest.ts` + focused RSS test |
| Disabled sinks are skipped by the push path without affecting enabled sinks | BP-08 §Disable/Enable semantics | `src/pipeline/push.ts` + focused disabled-sink test |

Every row must be resolved in the completion report as:
- implemented, with code + test citation
- deferred, with Codex approval
- out of scope, with boundary citation

## V1 Comparison

- Required comparison target: `src/commands/watch.ts`
- The worker must explicitly compare the v2 RSS guard behavior against the
  v1 watcher-era RSS kill switch and record parity or intentional drift.
- `CPUQuota=10%` in `src/commands/service.ts` is **not** part of this packet.
  If service-unit tuning becomes necessary, stop and escalate to Codex.

## Acceptance Checks

- `findChanged()` timeout logs and skips that adapter cycle
- `loadConversation()` timeout logs and skips only that ref
- RSS warning/hard-limit checks execute in the v2 pipeline path; hard limit
  does not silently continue work
- disabled sinks are skipped in `pushDirty()` without affecting enabled sinks
- tests cite each BP Acceptance Matrix row

## Stop And Escalate

Stop if:

- a frozen contract must change
- disabled-sink semantics cannot be implemented without widening the sink
  contract or editing `src/config.ts`
- service-unit or daemon-boundary tuning pressure appears
- the packet needs command-surface edits outside `src/pipeline/**`

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
- parity kept / intentional BP-backed change / deferred regression
- or `no prior v1 surface`

BP alignment:
- BP-02: timeout handling, RSS budget, push-path enforcement
- BP-08: disabled-sink filter semantics in the runtime path

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
