---
title: Diagnostic dashboard should show worker RSS and CPU separately from parent
date: 2026-04-19
status: resolved
tags: [pipeline, worker, diagnostics, dashboard]
related: [W3-PERF-11]
---

# Diagnostic dashboard should show worker RSS and CPU separately from parent

## Problem

The diagnostic dashboard was parent-centric.

`debug.jsonl` now includes parent `rssMb` and `cpuPct`, which is useful, but
worker-heavy ingest paths still require terminal-side `ps` inspection to answer:

- how much RSS belongs to the long-lived parent
- how much RSS belongs to active worker subprocesses
- whether worker CPU is dominating a given scan

That made live investigation slower than it should be.

## Resolution

The dashboard now shows, at minimum:

- parent RSS / CPU
- active worker RSS / CPU
- combined family RSS
- combined family CPU

Implementation shape:

- worker sample events are now persisted into `debug.jsonl`
- `tools/diagnostic-viewer.html` renders parent, worker, and combined RSS lines
- `tools/diagnostic-viewer.html` renders parent, worker, and combined CPU lines
- the event table includes per-event parent/worker/combined metrics

## Notes

- `src/pipeline/ingest-worker.ts` already computes worker sample data and
  combined RSS in the worker callback path
- the dashboard now surfaces those subprocess metrics directly instead of
  forcing manual `ps` correlation
