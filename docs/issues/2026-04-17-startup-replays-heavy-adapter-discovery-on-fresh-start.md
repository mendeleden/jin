---
title: Fresh `jin start` replayed heavy adapter discovery on unchanged datasets
date: 2026-04-17
status: resolved
severity: medium
area: [pipeline, adapter, discovery, startup]
related: [BP-02, BP-04, BP-10]
---

# Fresh `jin start` replayed heavy adapter discovery on unchanged datasets

## Summary

Before the durable discovery-cache lane landed, a full stop/start re-ran heavy
startup discovery from scratch for unchanged heavy adapters.

This was an operational bug because:

- startup time stays high on every restart
- parent RSS stays higher for longer during startup
- repeated startup replay contributes to later hard-limit failures

## Evidence

From the recent `debug.jsonl` runs:

- Run 1:
  - `claude-code`: `913` refs
  - `cursor`: `6` refs
  - `codex`: `416` refs
- Run 2 after stop/start:
  - `claude-code`: `913` refs again
  - `cursor`: `100` refs after protected-source opt-in
  - `codex`: `416` refs again

This showed fresh start behaving like a cold scan even when the dataset was
already in the store.

## Repro

1. Start Jin and let startup ingest complete or mostly complete.
2. Stop Jin.
3. Start Jin again without changing the heavy adapter sources.
4. Observe `debug.jsonl` and adapter startup counts.

## Expected

Fresh restart should reload durable lightweight discovery state and avoid
replaying unchanged heavy discovery work.

## Actual

Fresh restart replayed heavy `findChanged({ kind: "startup-scan" })` work for
heavy adapters.

## Likely Fix

Resolved by:

- [durable-discovery-cache.md](/Users/edenmendel/Documents/GitHub/jin/docs/proposals/durable-discovery-cache.md)
- one-shot worker-backed heavy discovery
- lifecycle fixes for Codex cache persistence across periodic scans

Current state:

- cold restarts now warm Claude/Codex/Cursor discovery from durable cache
- live runs no longer show full heavy-adapter startup replay on unchanged data
- remaining runtime issue is queue growth during long startup drain, tracked
  separately

## Notes

This was not a correctness bug in the store. It was a performance and lifecycle
bug caused by process-local discovery state.
