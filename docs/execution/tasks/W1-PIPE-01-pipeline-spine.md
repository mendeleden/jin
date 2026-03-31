# W1-PIPE-01: Pipeline Spine

## Role

Worker packet.

## Goal

Implement the serial pipeline coordinator from BP-02: one queue, one
ingest/push coordinator, change-gated push scheduling, and bounded shutdown.

## Depends On

- `W0-CODEX-01-contract-freeze.md`
- stable enough output from `W1-DB-01-store-spine.md`
- stable enough contracts from `W1-ROUTING-01-routing-config-core.md`
- stable enough contracts from `W1-SINK-01-webhook-reference.md`

## Unblocks

- the first true end-to-end v2 path

## Read In Order

1. `docs/execution/00-global-rules.md`
2. `docs/blueprint/BP-02-data-flow.md`
3. `docs/blueprint/BP-01-module-map.md`
4. `docs/blueprint/BP-07-process-lifecycle.md`
5. Current code:
   - `src/commands/watch.ts`
   - `src/watcher.ts`
   - `src/lifecycle.ts`
   - the new `src/db/**` interfaces

## Owned Files

- `src/pipeline/**`
- pipeline-focused tests under `test/`

## Forbidden Files

- `src/adapters/**`
- `src/db/**`
- `src/sinks/**`
- `src/config.ts`
- `src/routing.ts`
- `src/commands/**`
- `src/watcher.ts` unless Codex explicitly authorizes folding it into the
  pipeline module

## Frozen Contracts

- adapter interface
- store read/write interfaces
- push payload semantics
- lifecycle ownership semantics

## Deliverables

- queue/work-item model
- `ingestOne()` and `ingestAll()`
- `pushDirty()`
- watcher integration with per-adapter serialization
- change-gated push scheduling
- bounded shutdown flush semantics aligned to BP-02 and BP-07

## Non-Goals

- lifecycle command surface
- adapter implementation details
- sink internals

## Acceptance Checks

- no concurrent calls into the same adapter instance
- adjacent push work coalesces instead of storming
- unchanged ingest does not enqueue push work
- shutdown skips queued normal work and performs one bounded final flush
- tests cover serial execution and push coalescing

## Stop And Escalate

Stop if:

- the packet needs new store semantics
- the packet needs shared type changes
- the packet needs lifecycle policy changes beyond frozen BP-07 semantics

## Completion Report

```md
Completed:
- ...

Files changed:
- ...

Tests run:
- ...

BP alignment:
- BP-02: serial coordinator, ingest/push flow, backpressure, shutdown
- BP-01: pipeline module ownership respected

Risks / follow-ups:
- ...

Blocked / needs Codex:
- ...
```
