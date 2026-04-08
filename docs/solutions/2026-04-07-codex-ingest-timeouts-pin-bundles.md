---
title: Codex ingest timeouts can pin successful bundles until the timer expires
date: 2026-04-07
tags: [adapter, pipeline, daemon]
related: [W3-PERF-01, W3-E2E-01, BP-02]
---

# Codex ingest timeouts can pin successful bundles until the timer expires

## Problem

Installed-binary validation showed the Codex ingest path repeatedly tripping the
BP-02 `256 MB` RSS hard limit on a real local dataset.

Two packet-local causes stacked:

- the Codex adapter fully parsed every session file during `findChanged()`, then
  reparsed the same file during `loadConversation()`
- the pipeline timeout helper used `Promise.race()` with an uncancelled sleep,
  which kept successful `loadConversation()` results reachable until the
  timeout expired

That combination turned one cold ingest into hundreds of megabytes of retained
RSS even before push work began.

## Solution

- make Codex ref discovery lightweight:
  - scan only session ids, root-segment creation, and compaction boundaries
  - yield and reclaim memory between files during the scan
- keep Codex full-file parsing bounded:
  - cache only one loaded file model at a time
  - stream full-file parsing line-by-line instead of reading the whole file into
    an extra in-memory text buffer
  - force Codex ingest batches down to one conversation per batch so the
    existing BP-02 batch boundary becomes an effective reclamation point
- replace the ingest timeout helper with a clearable timer so a successful
  adapter call does not stay pinned behind a losing timeout promise

## Key Insight

For large adapter bundles, a timeout wrapper is part of the memory profile, not
just the failure path.

If the losing timeout branch cannot be cancelled, `Promise.race()` can retain
already-written bundle results until the timeout resolves. In a serial ingest
loop that turns a correctness guard into a memory leak.

## Prevention

- when a packet adds timeouts around large adapter or sink payloads, prefer a
  clearable timer over an uncancelled `sleep` race
- for file-backed adapters, keep `findChanged()` on a metadata/index path and
  reserve full parsing for `loadConversation()`
- validate memory-sensitive ingest fixes on the real local dataset with peak RSS
  logging, not only fixture-scale tests

## Related

- `W3-PERF-01` fixed the active Codex ingest RSS blocker on the v2 pipeline path
- `W3-E2E-01` exposed the real-dataset failure during installed-binary
  validation
- BP-02 remains the governing contract: bounded ingest batches plus intact RSS
  warning/hard-limit enforcement

## Files Changed

- `docs/solutions/2026-04-07-codex-ingest-timeouts-pin-bundles.md`
- `src/adapters/codex.ts`
- `src/pipeline/ingest.ts`
- `test/codex-reference-adapter.test.ts`
- `test/pipeline-spec-gap-closure.test.ts`
