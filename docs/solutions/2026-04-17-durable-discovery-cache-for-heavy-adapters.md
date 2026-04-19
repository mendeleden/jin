---
title: Durable discovery cache for heavy adapters
date: 2026-04-17
tags: [adapter, pipeline, daemon, config]
related: [BP-02, BP-04, BP-10]
---

# Durable discovery cache for heavy adapters

## Problem

Heavy adapters were replaying startup discovery on every fresh `jin start`.
That kept cold-start ingest expensive and left the parent process carrying more
startup RSS than the workerized `loadConversation()` path had actually solved.

We briefly explored a resident discovery worker to keep adapter-local cache
state alive across periodic scans, but that only fixed the within-lifetime
case. It did not solve stop/start replay, and it introduced another
long-lived subprocess class to debug.

## Solution

Jin now persists **lightweight adapter discovery state** in a separate SQLite
cache DB:

- heavy adapters export/import only lightweight discovery state
- the pipeline hydrates that state before `findChanged()`
- the pipeline persists updated state after discovery completes
- the public adapter contract stays `findChanged()` plus `loadConversation()`
- the cache lives outside the canonical conversation store

The first implementation keeps discovery in the parent and uses the durable
cache to warm fresh startup scans. Workerized `loadConversation()` remains a
separate execution policy.

## Key Insight

This was a durability problem, not a helper-lifetime problem.

If the performance state that matters is lost on restart, a resident helper can
only hide the issue during one daemon lifetime. The durable fix is to persist
small, adapter-owned discovery metadata in a cache that is safe to wipe and
safe to rebuild.

## Prevention

- Keep heavy-adapter performance state out of the canonical store.
- Do not widen `src/contracts/adapters.ts` just to support cache hydration.
- Treat adapter import/export helpers as real internal contract surface:
  version them and test restart behavior directly.
- Add lifecycle tests that cover release hooks, cache export, adapter
  recreation on reconcile, cache re-import, and immediate periodic rescan.
- When a performance fix proposes a new forever-lived helper process, ask
  whether the real missing property is durability instead.

## Related

- [durable-discovery-cache.md](/Users/edenmendel/Documents/GitHub/jin/docs/proposals/durable-discovery-cache.md)
- [2026-04-17-discovery-cache-needs-lifecycle-tests.md](/Users/edenmendel/Documents/GitHub/jin/docs/solutions/2026-04-17-discovery-cache-needs-lifecycle-tests.md)
- [BP-02-data-flow.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-02-data-flow.md)
- [BP-04-adapter-contract.md](/Users/edenmendel/Documents/GitHub/jin/docs/blueprint/BP-04-adapter-contract.md)

## Files Changed

- [src/db/discovery-cache.ts](/Users/edenmendel/Documents/GitHub/jin/src/db/discovery-cache.ts)
- [src/pipeline/ingest.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/ingest.ts)
- [src/adapters/claude-code.ts](/Users/edenmendel/Documents/GitHub/jin/src/adapters/claude-code.ts)
- [src/adapters/codex.ts](/Users/edenmendel/Documents/GitHub/jin/src/adapters/codex.ts)
- [src/adapters/cursor.ts](/Users/edenmendel/Documents/GitHub/jin/src/adapters/cursor.ts)
