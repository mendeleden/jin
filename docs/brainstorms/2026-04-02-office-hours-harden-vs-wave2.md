---
title: "Office Hours: Harden v2 Pipeline vs Ship Wave 2"
date: 2026-04-02
status: reframed
outcome: proceed — close pipeline spec gaps as W1-PIPE-01 completion, dispatch W1-ADAPTER-01 in parallel
---

# Office Hours: Harden v2 Pipeline vs Ship Wave 2

## Original Framing

Should we harden the v2 pipeline (RSS kill switch, adapter timeouts,
sink.enabled filter) before or after shipping Wave 2 (adapters, more sinks,
query surface)?

## Reframe

The pipeline packet (W1-PIPE-01) shipped without its BP-02 resource budget
spec. The RSS kill switch, per-adapter timeout, and sink.enabled filter are
not "hardening" — they are specified behavior that was omitted from the
implementation. Total gap: ~65 lines of code.

Meanwhile, W1-ADAPTER-01 (Claude Code reference adapter) has no dependency on
the pipeline. It produces bundles. The pipeline consumes bundles. They can be
built in parallel.

## Forcing Questions Summary

**Q1 (Who benefits?)**: The hardening gaps don't hurt anyone today because v2
isn't the running path yet. The adapter gap blocks v2 from being real.

**Q2 (What if we don't?)**: Skip hardening → first OOM crash on v2 launch is a
reputation event. Skip adapters → v2 pipeline has no data, can't validate
end-to-end.

**Q3 (Simplest 80%?)**: RSS kill switch is 20 lines. sink.enabled is 5 lines.
Adapter timeout is 40 lines. Total: ~65 lines. Not a phase — a task.

**Q4 (Wrong assumptions?)**: "Harden vs expand" is a false choice. These are
non-competing paths. The RSS kill switch is a spec gap in W1-PIPE-01, not a
new feature.

**Q5 (Reversibility?)**: Both paths are additive. The cost of doing RSS kill
switch after a user OOM is reputational.

**Q6 (Adjacent problems?)**: The v2 pipeline has never been tested end-to-end
with real data. The first adapter port will surface integration bugs.

## Decision

Do both. Close W1-PIPE-01 spec gaps (~65 lines), then dispatch W1-ADAPTER-01
in parallel. Don't create a false choice between two non-competing paths.

## Specific Items for W1-PIPE-01 Completion

1. RSS kill switch (200MB warn, 256MB hard → graceful shutdown) — ~20 lines
2. sink.enabled filter in pushDirty — ~5 lines
3. Per-adapter timeout wrappers (30s/60s) — ~40 lines
4. Fix CPUQuota=10% → 2% in service.ts — 1 line
5. Consecutive error count (3 failures → skip adapter) — ~30 lines (can be P2)
