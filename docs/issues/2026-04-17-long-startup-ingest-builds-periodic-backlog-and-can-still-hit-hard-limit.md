---
title: Long startup ingest builds periodic backlog and can still hit the 256 MB hard limit
date: 2026-04-17
status: open
severity: high
area: [pipeline, lifecycle, memory, queue]
related: [BP-02, BP-10]
---

# Long startup ingest builds periodic backlog and can still hit the 256 MB hard limit

## Summary

Even with heavy workerized load in place, long startup ingest can still leave
the parent at a high RSS floor. Once another heavy adapter starts, the parent
can cross the `256 MB` hard limit and trigger `shutdown-flush`.

Separately, periodic maintenance work continues to enqueue while startup is
still draining, so queue backlog grows during long startup runs.

## Evidence

Recent live runs show:

- Run with Cursor protected-source opt-in:
  - `cursor` completed `100/100`
  - parent RSS at end of Cursor was around `249-252 MB`
  - next `codex` batch crossed to `258-260 MB`
  - pipeline immediately started `shutdown-flush`

Concrete log excerpt:

```text
2026-04-17T13:39:47.392Z  ingest:batch  rss=252MB  adapter=cursor  refs=99/100
2026-04-17T13:39:49.006Z  ingest:batch  rss=260MB  adapter=codex  refs=1/419
2026-04-17T13:39:49.007Z  work:start  rss=260MB  kind=shutdown-flush
```

Also observed during a longer run:

- queue size grew while startup work was still active
- repeated periodic `push`, `reconcile-adapters`, and `ingest-all` items were
  queued faster than startup could drain them

## Repro

1. Enable heavy adapters, including full Cursor protected-source path.
2. Start Jin on a non-trivial dataset.
3. Watch `debug.jsonl` for:
   - `queueSize`
   - `ingest:batch`
   - `work:start`
   - `shutdown-flush`

## Expected

- startup should not leave the parent so close to the hard limit that the next
  adapter immediately trips it
- periodic maintenance should not pile up unbounded backlog while long startup
  ingest is still draining

## Actual

- parent floor can remain high enough after one heavy adapter that the next
  heavy adapter crosses the hard limit on its first batch
- periodic background work continues to enqueue during long startup runs

## Likely Fixes

Primary:

- durable discovery cache to reduce repeated heavy startup discovery and lower
  parent startup residency

Follow-on:

- queue/coalescing policy for periodic `ingest-all` / `push` / `reconcile`
  while startup work is still active
- possibly a softer startup-aware scheduling policy before hard shutdown logic

Recommended queue policy:

- treat periodic maintenance as level-triggered intent, not an edge-triggered
  packet appended every interval
- allow only one pending:
  - `reconcile-adapters`
  - `ingest-all(periodic-scan)`
  - `push`
- if one of those items is already running, remember that one rerun is owed
  instead of stacking more duplicates in the queue

## Notes

This issue is adjacent to, but distinct from, the fresh-restart replay issue:

- durable discovery cache should reduce startup cost
- queue/scheduling still needs its own explicit policy review
