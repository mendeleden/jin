---
title: Diagnostic dashboard should show worker RSS and CPU separately from parent
date: 2026-04-19
tags: [pipeline, worker, diagnostics, dashboard]
related: [W3-PERF-11]
---

# Diagnostic dashboard should show worker RSS and CPU separately from parent

## Problem

The current diagnostic dashboard is parent-centric.

`debug.jsonl` now includes parent `rssMb` and `cpuPct`, which is useful, but
worker-heavy ingest paths still require terminal-side `ps` inspection to answer:

- how much RSS belongs to the long-lived parent
- how much RSS belongs to active worker subprocesses
- whether worker CPU is dominating a given scan

That makes live investigation slower than it should be.

## Desired Outcome

The dashboard should be able to show, at minimum:

- parent RSS / CPU
- active worker RSS / CPU
- combined family RSS
- ideally by adapter and by worker lifecycle window

## Notes

- `src/pipeline/ingest-worker.ts` already computes worker sample data and
  combined RSS in the worker callback path
- the dashboard currently does not surface those subprocess metrics as first-class
  charts or stats

## Next Step

Extend the diagnostic event/model and viewer so worker sample data is persisted
and rendered directly, instead of forcing manual `ps` correlation.
