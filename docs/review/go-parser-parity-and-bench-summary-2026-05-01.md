---
title: Go parser parity and medium-large-xl benchmark summary
date: 2026-05-01
status: review
related:
  - tools/parser-spike/results-medium-large-xl.json
  - docs/spikes/go-parser-medium-large-xl-benchmarks-2026-05-01.md
  - docs/review/go-parser-spike-ground-truth-verification-2026-05-01.md
---

# Go parser parity and medium-large-xl benchmark summary

## Parity status

The Go spike now matches the TS harness on the verified fixtures below at the
normalized bundle-hash level:

- `.spike-target.jsonl`
- `.spike-target-1.77mb.jsonl`

This means:

- conversation metadata matched under the normalized comparison
- message content matched
- tool-use payloads matched
- sequence, turn, parent linkage, and timestamp formatting matched

## Measurement source

All benchmark numbers below come from the same runner and the same source of
truth:

- runner: `tools/parser-spike/bench.py`
- timing / RSS / CPU source: `/usr/bin/time -f "wall=%e rss_kb=%M cpu=%P exit=%x"`
- iterations: `5`

That means wall time, peak RSS, and CPU% are directly comparable between TS and
Go for this batch-mode benchmark.

## Medium / large / XL results

| Fixture | Size | Lines | TS wall ms | Go wall ms | TS RSS MB | Go RSS MB | TS CPU% | Go CPU% | Wall speedup | RSS reduction |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `.spike-target-big.jsonl` | 3.62 | 1352 | 130.0 ± 0.0 | 86.0 ± 16.2 | 86.6 | 12.3 | 129.6 | 98.4 | 1.51x | 7.06x |
| `.spike-target-10mb.jsonl` | 11.32 | 6072 | 488.0 ± 13.3 | 480.0 ± 49.4 | 136.3 | 57.3 | 131.2 | 109.8 | 1.02x | 2.38x |
| `.spike-target-50mb.jsonl` | 50.92 | 27324 | 1828.0 ± 14.7 | 1774.0 ± 72.3 | 244.6 | 211.1 | 127.6 | 107.0 | 1.03x | 1.16x |

## Readout

- At medium size (`3.62 MB`), Go is still clearly better on both wall time and
  RSS.
- At large size (`11.32 MB`), the wall-time win nearly disappears, but Go still
  cuts RSS materially.
- At XL size (`50.92 MB`), batch-mode wall time is nearly tied and RSS
  advantage is small.
- CPU% stays consistently lower for Go across all three sizes, but the batch
  benchmark increasingly converges as payload size grows.

## Interpretation

These results support a narrower claim than the original spike headline:

- Go has a strong advantage on smaller real files.
- In this batch harness, the advantage decays quickly as transcript size grows.
- The remaining case for a Go worker at large/XL sizes is more about memory
  floor and worker-process isolation than raw parse throughput.

## Files

- structured results: `tools/parser-spike/results-medium-large-xl.json`
- generated markdown table: `docs/spikes/go-parser-medium-large-xl-benchmarks-2026-05-01.md`
