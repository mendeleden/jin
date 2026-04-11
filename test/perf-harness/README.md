# V2 Performance Harness

`jin benchmark` is the repeatable v2 perf harness for release-gate checks.
It runs these phases in isolated child processes and writes machine-readable
artifacts for each phase plus an aggregate `report.json`. Phase RSS artifacts
publish byte-valued `highWaterMarkBytes` after normalizing
`process.resourceUsage().maxRSS`:

- `discovery`
- `load`
- `load-write`
- `push`
- `runtime`
- `shutdown-flush`

## Default local run

```sh
bash test/perf-harness/run-v2-benchmark.sh
```

The wrapper writes:

- `test/perf-harness/results/<timestamp>/report.json`
- `test/perf-harness/results/<timestamp>/phase-*.json`
- `test/perf-harness/results/<timestamp>/stdout.json`

## Exact command

```sh
JIN_BENCHMARK_OUTPUT_DIR=test/perf-harness/results/manual \
JIN_BENCHMARK_PUSH_MODE=synthetic \
bun src/index.ts benchmark --json
```

## Dataset targeting

Use dataset overrides when a generated scale tier should replace live tool
directories:

```sh
JIN_BENCHMARK_ADAPTERS=codex \
JIN_BENCHMARK_DATASET_DIR=test/perf-datasets/generated/codex-heavy/10x \
bash test/perf-harness/run-v2-benchmark.sh
```

If multiple adapters need explicit roots, use `JIN_BENCHMARK_ADAPTER_DIRS`:

```sh
JIN_BENCHMARK_ADAPTER_DIRS='codex=/tmp/codex-10x,claude-code=/tmp/claude-10x' \
bash test/perf-harness/run-v2-benchmark.sh
```

When `JIN_BENCHMARK_ADAPTERS`, `JIN_BENCHMARK_ADAPTER_DIRS`, or
`JIN_BENCHMARK_DATASET_DIR` explicitly target adapters, the harness treats
that adapter set as strict. If any requested adapter is missing, blocked, or
its `detect()` call fails, the run fails instead of silently shrinking the
measured benchmark surface.

## Useful env vars

- `JIN_BENCHMARK_PHASES=discovery,load-write,push`
- `JIN_BENCHMARK_PUSH_MODE=synthetic|real|hybrid`
- `JIN_BENCHMARK_RUNTIME_PUSH_BATCH_SIZE=2`
- `JIN_BENCHMARK_RSS_WARNING_MB=200`
- `JIN_BENCHMARK_RSS_HARD_LIMIT_MB=256`
- `JIN_CONFIG_DIR=/tmp/jin-config`
