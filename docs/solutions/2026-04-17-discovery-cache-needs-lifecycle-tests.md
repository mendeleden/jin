---
title: Discovery cache needs lifecycle tests across release and adapter recreation
date: 2026-04-17
tags: [adapter, daemon, cache, pipeline, test]
related: [BP-02, BP-04, BP-10]
---

# Discovery cache needs lifecycle tests across release and adapter recreation

## Problem

The periodic Codex replay bug was a lifecycle-ordering bug, not a parsing bug.
The runtime sequence was:

- `findChanged()` builds lightweight discovery state
- the pipeline calls `releaseDiscoveryMemory()`
- the pipeline later persists `exportDiscoveryState()`
- reconcile creates a fresh adapter instance
- periodic `findChanged()` runs again on that new instance

Codex cleared `fileIndexCache` in `releaseDiscoveryMemory()`, and
`exportDiscoveryState()` read from that same cache. Unit tests that only
exercised cold save/load across one adapter instance did not execute the full
runtime sequence, so they missed the ordering bug.

## Solution

Add tests that span the whole runtime discovery lifecycle:

- run discovery on a real adapter fixture
- release transient memory
- persist discovery state
- recreate a fresh adapter instance
- reload cached discovery state
- assert the next `findChanged()` returns no replay for unchanged sources

Also keep negative tests that:

- load failures do not advance the cache
- empty local stores ignore warm startup cache
- corrupt cache DBs disable the cache instead of crashing startup

## Key Insight

The real boundary is not "method X works in isolation"; it is
"state survives the exact runtime sequence we actually use."

For this class of bug, the sequence matters more than the individual methods:
release, export, reconcile, recreate, reload, rescan. If a test skips the
release or recreate step, it can green-light a cache that only works inside one
object lifetime.

## Prevention

- Treat adapter release hooks as transient-memory cleanup only.
- If a discovery cache exists, test it across a fresh adapter instance, not
  just the same object after mutation.
- For reconcile/periodic paths, prefer an integration test that forces
  adapter recreation and verifies the cached discovery state still suppresses
  replay.
- When a fix depends on ordering between `releaseDiscoveryMemory()` and
  `exportDiscoveryState()`, add an explicit regression test for that ordering.

## Related

- [durable-discovery-cache-for-heavy-adapters.md](/Users/edenmendel/Documents/GitHub/jin/docs/solutions/2026-04-17-durable-discovery-cache-for-heavy-adapters.md)
- [durable-discovery-cache-over-resident-workers.md](/Users/edenmendel/Documents/GitHub/jin/docs/solutions/2026-04-17-durable-discovery-cache-over-resident-workers.md)
- [BP-04-adapter-contract.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-04-adapter-contract.md)

## Files Changed

- [test/discovery-cache.test.ts](/Users/edenmendel/Documents/GitHub/jin/test/discovery-cache.test.ts)
- [src/adapters/codex.ts](/Users/edenmendel/Documents/GitHub/jin/src/adapters/codex.ts)
- [src/pipeline/ingest.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/ingest.ts)
- [src/commands/watch.ts](/Users/edenmendel/Documents/GitHub/jin/src/commands/watch.ts)
