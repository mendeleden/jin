---
title: Bun/JSC RSS investigation needs native-heap controls, not just JS-heap fixes
date: 2026-04-13
tags: [daemon, pipeline, perf, runtime]
related: [W3-PERF-04, W3-PERF-05, BP-02, BP-04]
---

# Bun/JSC RSS investigation needs native-heap controls, not just JS-heap fixes

## Problem

`W3-PERF-04` kept burning time on adapter and pipeline reshaping while the live
startup RSS cliff remained hard to explain. The team kept asking the right
question:

> is this really JavaScript object retention, or are we fighting the runtime /
> allocator instead?

Without a split between JSC heap and native heap, every new experiment risked
optimizing the wrong layer.

## Solution

Use Bun's own two-heap model as the investigation frame:

- Bun docs say there are **two heaps**:
  - the JavaScript heap (`bun:jsc.heapStats()`)
  - "everything else" (`MIMALLOC_SHOW_STATS=1`)
- add timed heap sampling alongside the existing Jin debug log
- compare three live runs on the same startup path:
  - default `256 MB`
  - `256 MB` with `MIMALLOC_PURGE_DELAY=0`
  - `256 MB` with `bun --smol`

This gives a real answer about what kind of memory is dominating peak RSS.

## Key Insight

On the live Jin startup path, the worst RSS spikes were **not** dominated by the
live JSC heap.

Concrete local evidence:

- default `256 MB` control run failed during Claude at `RSS 257 MB`
- at the sampled RSS peak, JSC heap was only about `14 MB`
- after the failure, JSC heap fell back to about `4 MB` while RSS stayed at
  `257 MB`

That means the primary cliff is native/retained runtime memory, allocator page
retention, mapped pages, or similar process-level residency, not just live JS
objects.

Two tuned runs changed the outcome materially:

- `MIMALLOC_PURGE_DELAY=0` completed the same live `256 MB` startup path
  cleanly; sampled RSS peak was about `233 MB`
- `bun --smol` also completed the same live `256 MB` startup path; sampled RSS
  peak was about `239 MB`

`--smol` matters, but the native-allocator result is the stronger signal because
the split run showed the process can be far above `200 MB` RSS while JSC heap is
still only single-digit MB.

## Prevention

- do not use RSS alone to infer "JavaScript heap leak"
- for Bun runtime investigations, always collect:
  - `bun:jsc.heapStats()`
  - `MIMALLOC_SHOW_STATS=1`
  - timed RSS samples in addition to batch-boundary logs
- do not trust batch-boundary logging alone: the highest sampled RSS can happen
  between logged ingest batches
- test runtime knobs that match the observed layer:
  - JS heap knobs (`--smol`) for JSC-dominated growth
  - allocator purge knobs (`MIMALLOC_PURGE_DELAY=0`) for native-retained RSS

## Related

- Bun memory docs:
  - `https://bun.sh/docs/project/benchmarking`
- Bun runtime `smol` docs:
  - `https://bun.sh/docs/runtime/bunfig`
- WebKit / JavaScriptCore GC background:
  - `https://webkit.org/blog/7122/introducing-riptide-webkits-retreating-wavefront-concurrent-garbage-collector/`
  - `https://webkit.org/blog/12967/understanding-gc-in-jsc-from-scratch/`
- mimalloc runtime options:
  - `https://microsoft.github.io/mimalloc/environment.html`
  - `https://microsoft.github.io/mimalloc/group__options.html`

## Files Changed

- `docs/execution/audits/2026-04-13-W3-PERF-04-streaming-writer-contract-and-live-reruns.md`
- `docs/execution/audits/2026-04-13-W3-PERF-04-bun-jsc-native-heap-investigation.md`
