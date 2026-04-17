---
title: Store-owned write sessions should own both bundle and worker persistence
date: 2026-04-15
tags: [pipeline, schema, daemon, migration]
related: [W3-PERF-10, W3-PERF-07, W3-PERF-09, BP-04, BP-05]
---

# Store-owned write sessions should own both bundle and worker persistence

## Problem

Jin had two parent-side persistence paths for the same conversation data:

- `writeBundle()` in `src/db/bundle.ts`
- a separate staged writer used by the worker ingest path

That duplicated hash/revision checks, row replacement, FTS refresh, and derived
field updates. Even when outputs matched, the duplication made future perf work
hard to review because the store contract only guaranteed `writeBundle()` while
the worker path relied on a second implementation detail.

## Solution

Add an explicit store-owned write-session API to `src/contracts/store.ts` and
route both paths through it:

- `ConversationStore.beginWrite(conversation)`
- `ConversationWriteSession.finish(bundleHash)`
- `writeBundle()` now computes the canonical bundle hash and appends each
  message through that same session engine
- worker ingest now begins the staged session from the store contract instead
  of reaching into SQLite-specific writer internals

This keeps persistence parent-owned, preserves the existing hash/revision
semantics, and removes the implementation drift between one-shot bundle writes
and staged worker writes.

## Key Insight

If Jin needs staged persistence, the staged API must be part of the store
contract itself. A pipeline-owned or ad hoc writer quickly becomes a shadow
contract with duplicate semantics and weak reviewability.

## Prevention

- When a new ingest mode needs staged writes, add or reuse an explicit store
  contract surface instead of introducing a second persistence helper.
- Keep focused parity tests for both bundle writes and session/worker writes.
- Review worker ingest code for direct database access; parent-owned store logic
  should stay behind `ConversationStore`.

## Related

- packet: `W3-PERF-10`
- review context: `2026-04-14-W3-PERF-07-codex`
- blueprint alignment: `BP-04` read-only adapters, `BP-05` store-owned durable
  revision/hash semantics

## Files Changed

- `src/contracts/store.ts`
- `src/db/bundle.ts`
- `src/db/store.ts`
- `src/db/write-session.ts`
- `src/pipeline/ingest-worker.ts`
- `src/index.ts`
- `src/pipeline/index.ts`
- `test/db-write-session.test.ts`
