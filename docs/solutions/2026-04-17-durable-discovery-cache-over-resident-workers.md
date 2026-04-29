---
title: Prefer durable discovery cache over resident discovery workers
date: 2026-04-17
tags: [pipeline, daemon, adapter, cache, worker, routing]
related: [BP-02, BP-04, BP-10]
---

# Prefer durable discovery cache over resident discovery workers

## Problem

Heavy-adapter discovery replayed too much work on fresh `jin start`, and one
proposed fix was a long-lived discovery subprocess that kept adapter-local
cache state alive for the daemon lifetime.

That helped within one runtime, but it did not solve restart replay and added a
new forever-lived helper process class to debug and operate.

## Solution

Reject resident discovery workers as the target architecture.

Use a durable discovery cache as the primary design direction instead:

- cache lightweight adapter-specific discovery state after each scan
- reload that state on the next discovery run
- keep worker-vs-parent discovery execution as a benchmarked decision, not an
  assumption

The short-term resident-worker experiment was rolled back so the code matches
the proposal direction again.

## Key Insight

The restart-replay issue is a durability problem, not mainly a subprocess
lifetime problem.

If the useful discovery state disappears when the process exits, then a
long-lived worker only hides the issue during one daemon lifetime. Durable
state is the real fix.

## Prevention

- Treat resident helper processes as an explicit architecture choice, not a
  convenient intermediate step.
- When the real complaint is "fresh restart is still expensive," require the
  design to explain where the state survives restart.
- Benchmark `durable cache + in-parent discovery` before keeping a worker path
  whose only job is to preserve warm cache.

## Related

- [durable-discovery-cache.md](/Users/edenmendel/Documents/GitHub/jin/docs/proposals/durable-discovery-cache.md)
- [durable-discovery-cache-review.md](/Users/edenmendel/Documents/GitHub/jin/docs/proposals/durable-discovery-cache-review.md)
- [disk-backed-parent-write-session.md](/Users/edenmendel/Documents/GitHub/jin/docs/proposals/disk-backed-parent-write-session.md)

## Files Changed

- [src/pipeline/ingest-worker.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/ingest-worker.ts)
- [src/pipeline/ingest.ts](/Users/edenmendel/Documents/GitHub/jin/src/pipeline/ingest.ts)
- [docs/proposals/durable-discovery-cache.md](/Users/edenmendel/Documents/GitHub/jin/docs/proposals/durable-discovery-cache.md)
