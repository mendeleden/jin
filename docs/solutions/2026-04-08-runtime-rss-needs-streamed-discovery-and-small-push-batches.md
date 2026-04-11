---
title: Runtime RSS needs streamed discovery and small push batches
date: 2026-04-08
tags: [adapter, pipeline, daemon]
related: [W3-PERF-01, W3-PERF-02, BP-02, BP-07]
---

# Runtime RSS needs streamed discovery and small push batches

## Problem

The approved `W3-PERF-01` Codex ingest fix kept the packet-local ingest harness
below the `256 MB` hard limit, but the real long-lived runtime still died on the
same machine.

The remaining failure only showed up in the integrated path:

- Codex startup discovery still read each JSONL file into one full in-memory
  string while building lightweight ref indexes
- after startup ingest finished, runtime push batching still built enough
  conversation payloads at once to pin RSS above the remaining headroom

That combination produced a false local conclusion if only `ingestOne(...)` on
an empty temp store was measured.

## Solution

Two packet-owned fixes closed the gap:

1. Stream Codex file-index discovery through the existing line reader instead of
   `readFileSync(...)` + whole-file string scanning.
2. Narrow the long-lived runtime push batch size to `2` payloads so startup and
   steady-state daemon/store->sink work stay under the BP-02 guard on the real
   workload.

The store hash path was also rewritten to preserve the legacy canonical hash
output while keeping the implementation explicit, but the decisive RSS win came
from streamed discovery plus smaller runtime push batches.

## Key Insight

In Jin, `findChanged()` is part of the memory contract, not just a correctness
contract.

If discovery keeps whole source files or startup push batches build too many
payloads at once, the runtime can still exceed the RSS guard even when
`loadConversation()` itself is already bounded.

The right validation order for perf regressions is:

1. discovery only
2. ingest with a real store snapshot
3. integrated startup `ingestAll -> pushDirty`
4. real foreground/runtime execution

## Prevention

- Treat adapter discovery code as part of BP-02 backpressure reviews.
- When a runtime RSS issue only appears in the daemon/foreground path, isolate
  `findChanged()`, startup ingest, and startup push separately before changing
  the guard or the sink.
- Keep a focused runtime test on the long-lived path configuration so runtime
  batch-size specializations do not drift.

## Related

- `W3-PERF-01` fixed the earlier Codex `loadConversation()` retention path.
- `W3-PERF-02` closed the remaining integrated runtime gap.
- `docs/execution/audits/2026-04-08-W3-PERF-02-full-runtime-rss-shutdown-flush.md`
  contains the durable repro and validation commands.

## Files Changed

- `src/adapters/codex.ts`
- `src/commands/watch.ts`
- `src/db/bundle.ts`
- `test/runtime-store-cutover.test.ts`
- `test/db-store-spine.test.ts`
- `docs/execution/audits/2026-04-08-W3-PERF-02-full-runtime-rss-shutdown-flush.md`
