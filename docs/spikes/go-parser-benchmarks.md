---
title: Go vs TS Claude Code parser — full benchmark results
date: 2026-05-01
status: spike (validated, not production)
related: [docs/spikes/go-parser-claude-code.md]
---

# Go vs TS Claude Code parser — full benchmark results

Companion to `docs/spikes/go-parser-claude-code.md`. This document records 5
iterations × 8 fixtures (6 real + 2 synthesized for scaling) under
`/usr/bin/time -v`.

## Methodology

- **Runner**: `tools/parser-spike/bench.py` — invokes both binaries under
  `/usr/bin/time -f "wall=%e rss=%M cpu=%P exit=%x"`, runs 5 iterations of
  each, computes mean / min / max / stdev.
- **Hardware**: Linux x86_64, Go 1.26.2, Bun runtime
- **Working set kept warm**: All fixtures pre-staged in repo root; no cold
  filesystem cache effects on later runs.
- **Both binaries do equivalent work**: parse JSONL → emit `ConversationBundle`
  JSON to a file → exit. Bundle JSON content is at parity on aggregate
  counts/totals; semantic-hash parity gaps documented in the companion doc.

## Fixtures

| Fixture | Source | Size | Lines | Notes |
|---|---|---|---|---|
| `.spike-target-1.26mb.jsonl` | real | 1.26 MB | 789 | main session, jin project |
| `.spike-target-1.71mb.jsonl` | real | 1.71 MB | 717 | main session, estatimate-v7 |
| `.spike-target-1.77mb.jsonl` | real | 1.77 MB | 827 | sub-agent, jin project |
| `.spike-target.jsonl` | real | 1.89 MB | 1012 | primary fixture, has 1 compact_boundary |
| `.spike-target-2.68mb.jsonl` | real | 2.67 MB | 516 | sub-agent, jin project |
| `.spike-target-big.jsonl` | real | 3.62 MB | 1352 | largest natural file on disk |
| `.spike-target-10mb.jsonl` | synth | 11.32 MB | 6072 | primary × 6 (record replication) |
| `.spike-target-50mb.jsonl` | synth | 50.92 MB | 27,324 | primary × 27 (record replication) |

Synthetic fixtures are produced by concatenating a real file with itself N
times. Both parsers do strictly proportional work (parse all lines, build
bundle, emit JSON); resulting bundles have duplicate-uuid noise that doesn't
affect parser hot-path timing.

## Headline table (5 runs, mean ± stdev)

| Fixture | Size | Lines | TS wall | Go wall | TS RSS | Go RSS | Speedup | RSS lower |
|---|---|---|---|---|---|---|---|---|
| 1.26 MB | 1.26 MB | 789   | 104.0 ± 8.0 ms  | **42.0 ± 14.7 ms**  | 72.7 MB | **9.1 MB**  | **2.48×** | **7.97×** |
| 1.71 MB | 1.71 MB | 717   | 108.0 ± 4.0 ms  | **48.0 ± 11.7 ms**  | 73.3 MB | **10.3 MB** | **2.25×** | **7.10×** |
| 1.77 MB | 1.77 MB | 827   | 108.0 ± 4.0 ms  | **46.0 ± 8.0 ms**   | 73.8 MB | **12.4 MB** | **2.35×** | **5.95×** |
| primary | 1.89 MB | 1012  | 152.0 ± 4.0 ms  | **58.0 ± 16.0 ms**  | 83.6 MB | **10.7 MB** | **2.62×** | **7.83×** |
| 2.68 MB | 2.67 MB | 516   | 118.0 ± 7.5 ms  | **54.0 ± 4.9 ms**   | 83.5 MB | **11.4 MB** | **2.19×** | **7.29×** |
| big     | 3.62 MB | 1352  | 138.0 ± 4.0 ms  | **66.0 ± 8.0 ms**   | 86.0 MB | **11.2 MB** | **2.09×** | **7.69×** |
| 10 MB synth | 11.32 MB | 6072  | 530.0 ± 12.6 ms | **370.0 ± 32.9 ms** | 136.6 MB | **43.9 MB** | **1.43×** | **3.11×** |
| 50 MB synth | 50.92 MB | 27,324 | 1950.0 ± 43.8 ms | **1592.0 ± 31.9 ms** | 222.5 MB | **163.6 MB** | **1.22×** | **1.36×** |

## Key observations

### 1. Speedup ratio narrows as files grow

| Size class | Speedup (mean) | Why |
|---|---|---|
| 1–4 MB (real) | 2.0–2.6× | Bun runtime baseline (~75 MB / ~80 ms startup) dominates |
| 11 MB | 1.43× | Real parse work starts to dominate Bun overhead |
| 51 MB | 1.22× | Both runtimes mostly doing JSON unmarshal + GC; advantage narrows |

This means the "Go is 2.5× faster" headline applies to **typical conversation
files** (the realistic workload). On pathological multi-day mega-transcripts,
the win shrinks to ~20%.

### 2. RSS reduction is the durable win

| Size class | RSS reduction (mean) | Notes |
|---|---|---|
| 1–4 MB | 6–8× | Bun runtime overhead is the floor (~75 MB), Go floor is ~10 MB |
| 11 MB | 3.1× | Bundle size (~30 MB JSON) starts dominating both |
| 51 MB | 1.4× | Both retaining full 50 MB+ bundle in memory before emit |

The 50 MB case is misleading: both parsers materialize the entire bundle into
memory before serializing to JSON. That's an artifact of the spike harness,
**not** an inherent constraint. A real Go worker streams `INGEST_MESSAGE_METHOD`
notifications per-message back to the parent (matching the existing TS
subprocess protocol) and would never hold more than one message in memory.

### 3. CPU% breakdown

| Implementation | Avg CPU% | Cores in use |
|---|---|---|
| TS (Bun) | 125–140% | 2 cores (V8 GC parallelism) |
| Go | 100–110% | ~1 core |

TS uses **more total CPU** to achieve a 2.5× slower wall — Go is more
single-thread efficient. For a daemon ingesting in a tight loop, that's
relevant: less core contention with the rest of the daemon.

### 4. Throughput

| Fixture | TS lines/s | Go lines/s | TS MB/s | Go MB/s |
|---|---|---|---|---|
| primary 1.89 MB | 6,658 | 17,448 | 12.4 | 32.6 |
| big 3.62 MB | 9,797 | 20,485 | 26.2 | 54.8 |
| 10 MB synth | 11,457 | 16,411 | 21.4 | 30.6 |
| 50 MB synth | 14,012 | 17,164 | 26.1 | 32.0 |

Go saturates around **17 K lines/sec, 32 MB/sec** regardless of file size —
that's the parser's intrinsic ceiling in this implementation. TS speed-up over
Go vanishes by 50 MB because both are dominated by JSON marshal/unmarshal cost.

## What changes if we run as a streaming subprocess

The spike harness measures **batch parse** (read file → produce full bundle →
write JSON file). The production code path is **streaming** — emit each
`ParsedMessage` as a JSON-RPC notification to the parent daemon, which writes
to SQLite incrementally.

For Go, streaming means peak working set stays at ~10–15 MB **regardless of
file size**, because no message is retained beyond emit. For Bun, streaming
already happens (`INGEST_MESSAGE_METHOD` notifications), but the runtime floor
is still ~75 MB and growth on big files is observable.

Re-running the 50 MB benchmark in streaming mode would likely show:
- TS: ~150 MB peak RSS (still has runtime baseline, plus parse buffers)
- Go: ~15 MB peak RSS (constant)
- → **10× RSS reduction at scale**, not the 1.36× the batch number suggests

This is the version of the experiment that would actually settle the
production decision.

## Notes on the synthetic fixtures

The 10 MB and 50 MB files are produced by `cat .spike-target.jsonl >> out.jsonl`
N times. This means:
- Same record content repeats, so JSON parse cost is realistic
- All uuids and sessionIds are duplicated, which both parsers handle
  (neither does uuid-uniqueness validation at parse time)
- Compact boundary triggers ~N times, producing ~2N segments
- Aggregate counts will be N× the real-file counts but still match between
  TS and Go (which is what the bench measures)

A more realistic large-file benchmark would use a real 50 MB transcript from a
power user. None exists in the local fileset (largest is 3.62 MB).

## Reproducing this

```bash
# stage all fixtures
bash tools/parser-spike/stage-fixtures.sh   # not committed; see this doc

# build Go
cd tools/parser-spike/go-parser && go build -o ../go-parser-bin . && cd -

# run all 8 fixtures × 5 iterations
python3 tools/parser-spike/bench.py \
    .spike-target-1.26mb.jsonl \
    .spike-target-1.71mb.jsonl \
    .spike-target-1.77mb.jsonl \
    .spike-target.jsonl \
    .spike-target-2.68mb.jsonl \
    .spike-target-big.jsonl \
    .spike-target-10mb.jsonl \
    .spike-target-50mb.jsonl \
    --iterations 5 \
    --out tools/parser-spike/results.json
```

Raw per-iteration data is in `tools/parser-spike/results.json` (gitignored;
contains private transcript paths).

## Verdict

| Workload | Speedup | RSS reduction | Action |
|---|---|---|---|
| Typical conversation (1–4 MB) | 2.0–2.6× | 6–8× | **Go is decisively better** |
| Long conversation (10 MB) | 1.4× | 3× | **Go is meaningfully better** |
| Mega-transcript (50 MB+, batch) | 1.2× | 1.4× | Marginal in batch mode |
| Mega-transcript (streaming) | 1.2× est. | **10× est.** | **Go wins on memory floor** |

**Production case for Go is strongest on the memory side, not raw speed.** A
Go subprocess pegs RSS at ~10–15 MB indefinitely; Bun's 75 MB runtime baseline
plus per-file growth means the daemon's idle memory cost grows with the
biggest open file.

For jin's actual deployment (background daemon, ingesting transcripts of
varying sizes from active developer sessions), this matters:
- Idle daemon RSS today is ~109 MB (post-Phase 1, per `MEMORY.md`)
- Replacing the Claude Code parser with a Go subprocess would cap parser RSS
  regardless of input
- Phase 2 byte-offset tail-reads in TS would address the *recurrent re-parse*
  problem; a Go worker would address the *peak working-set* problem. They're
  complementary, not redundant.
