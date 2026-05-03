---
title: Worker parity must cover ref contracts and subagent IDs
date: 2026-05-03
tags: [adapter, pipeline, daemon]
related: [BP-02, BP-07]
---

# Worker parity must cover ref contracts and subagent IDs

## Problem

The Claude Code Go worker looked healthy under batch parity checks and small streamed
fixtures, but a real cold boot against live local data dropped most Claude
conversations. The live store before the experiment had `276` conversations. After a
fresh cold boot with the published runtime, Jin rebuilt to `282` conversations. The
branch run with `JIN_EXPERIMENT_CLAUDE_CODE_WORKER=go` only rebuilt to `68`.

The failure was not a generic worker/runtime issue and it was not primarily Codex or
Cursor data. The live discovery cache and direct ref audit showed the gap was almost
entirely Claude subagent conversations:

- TS Claude discovery emitted `241` refs.
- `214` of those refs were subagent refs.
- The Go parser could resolve `0` of those `214` subagent ref IDs.
- Root Claude refs still matched.

That meant the parent pipeline treated those Claude refs as `missing` during
`loadConversation`, excluded their source paths from the discovery cache writeback,
and silently finished with a much smaller store.

## Solution

Treat worker parity as a ref-resolution problem, not only a bundle-shape problem.

For Claude Code, the TS adapter derives conversation IDs from both transcript content
and source-path structure. In particular, subagent conversations are not keyed by the
raw `sessionId` in the JSONL file. They are keyed by a parent-scoped hashed ID derived
from:

- the parent session path scope
- the subagent `agentId` / source conversation identity
- the subagent file stem

The Go worker initially parsed each file around the raw `sessionId`, so every
subagent file produced the parent/root conversation ID instead of the TS adapter’s
spawned `agent-*` ID. `findChanged()` still ran in TS, so the parent passed
TS-generated subagent ref IDs into the Go worker. The Go worker then failed to find a
bundle with that ID and returned `missing`.

The fix is to make the Go parser mirror the TS adapter’s file inspection and parent
link logic for Claude:

- inspect file paths for `/subagents/`
- derive parent session scope from the path
- use `agentId` and path context to build TS-compatible spawned conversation IDs
- preserve spawned relationship / parent linkage semantics
- keep root and compacted ID behavior unchanged

The parent pipeline should also log worker-returned `missing` results explicitly so a
future ref-resolution regression is visible in live runs instead of only surfacing as
reduced cold-boot totals.

## Key Insight

“Output parity” is not enough for an ingest worker experiment.

If discovery stays in one implementation and `loadConversation` moves to another, the
two sides must agree on the **ref contract**:

- which files produce refs
- which conversation IDs those refs use
- how spawned/compacted variants are named

In other words, worker compatibility is defined by:

1. `findChanged()` emitting the same refs
2. `loadConversation(ref)` being able to resolve every emitted ref
3. persisted bundle content matching after that resolution succeeds

This is broader than hash parity on a few hand-picked bundles.

## Prevention

- Add worker parity tests for spawned/subagent Claude paths, not only root fixtures.
- Add a live ref audit whenever `findChanged` and `loadConversation` are split across
  implementations.
- Treat worker-returned `missing` as a first-class diagnostic event and log the
  adapter, ref ID, and source path.
- Before cold-boot perf comparisons, verify that ref counts and final rebuilt store
  totals are in-family with the known-good runtime.

## Related

- `docs/review/go-parser-spike-ground-truth-verification-2026-05-01.md`
- `docs/review/go-parser-parity-and-bench-summary-2026-05-01.md`
- `test/worker-go-parity.test.ts`

## Files Changed

- `tools/parser-spike/go-parser/main.go`
- `src/pipeline/ingest.ts`
- `test/worker-go-parity.test.ts`
