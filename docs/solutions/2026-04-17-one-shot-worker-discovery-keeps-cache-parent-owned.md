---
title: One-shot worker discovery keeps cache parent-owned
date: 2026-04-17
tags: [adapter, pipeline, daemon]
related: [BP-02, BP-04, BP-10]
---

# One-shot worker discovery keeps cache parent-owned

## Problem

Heavy adapter discovery still left too much RSS in the long-lived parent
process even after `loadConversation()` moved into subprocess workers.
At the same time, the durable discovery cache was intentionally parent-owned,
so moving discovery out-of-process could not hand cache ownership to the child.

## Solution

Run heavy `findChanged()` through the existing JSON-RPC worker transport, but
keep cache ownership in the parent:

1. Parent loads adapter discovery state from `discovery-cache.db`.
2. Parent sends `ChangeHint` plus the cache state to a one-shot worker.
3. Worker runs `findChanged(hint)` and returns refs plus updated discovery
   state.
4. Parent persists the returned discovery state after the ingest cycle.

This keeps the worker stateless across requests while still moving heavy
discovery memory out of the parent.

## Key Insight

The right ownership split is:

- parent owns durable state and invalidation
- worker owns bounded execution of a single adapter operation

That gives the memory isolation benefit of subprocesses without reintroducing a
resident helper whose only job is holding cache in RAM.

## Prevention

- Treat "move work to a worker" and "move cache ownership to a worker" as
  separate decisions.
- When workerizing a cached step, round-trip the lightweight cache state
  through the parent instead of silently duplicating cache authority.
- Add lifecycle tests that prove warm cache still suppresses periodic replay
  when discovery itself is worker-executed.

## Related

- [ingest.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/ingest.ts)
- [ingest-worker.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/ingest-worker.ts)
- [worker-ingest.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/worker-ingest.test.ts)

## Files Changed

- [ingest.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/ingest.ts)
- [ingest-worker.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/ingest-worker.ts)
- [worker-ingest.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/worker-ingest.test.ts)
- [durable-discovery-cache.md](/Users/edenmendel/Documents/GitHub/jin/docs/proposals/durable-discovery-cache.md)
