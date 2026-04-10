# W3-PERF-03 Repeatable V2 Performance Harness

## Scope

- validation date: `2026-04-08`
- packet: `W3-PERF-03`
- harness surface:
  - `src/commands/benchmark.ts`
  - `test/perf-harness/run-v2-benchmark.sh`
  - `test/perf-harness/README.md`
  - `test/perf-harness/benchmark-v2.test.ts`
- validation mode:
  - temp `JIN_CONFIG_DIR`
  - temp Codex dataset override rooted at a copied fixture
  - synthetic push mode so the push/runtime phases stay repeatable and packet-local

## What Changed

The legacy `jin benchmark` path measured v1-era `sessions()` / `messages()`
surfaces and a daemon PID snapshot. It did not exercise the real v2
discover/load/write/push/runtime pipeline or emit phase-level artifacts.

The new harness replaces that implementation with:

- isolated child-process execution per phase so each artifact has a clean
  `maxRSS` and no retained state from the prior phase
- strict requested-adapter targeting for env-scoped runs so benchmark phases
  fail if a requested adapter is missing, blocked, or its `detect()` call
  fails instead of silently shrinking the measured surface
- phase artifacts for:
  - `discovery`
  - `load`
  - `load-write`
  - `push`
  - `runtime`
  - `shutdown-flush`
- machine-readable JSON at both levels:
  - `report.json`
  - `phase-*.json`
- dataset targeting via env overrides:
  - `JIN_BENCHMARK_DATASET_DIR`
  - `JIN_BENCHMARK_ADAPTER_DIRS`
  - `JIN_BENCHMARK_ADAPTERS`
- a packet-local synthetic sink mode that still drives the real v2
  store->routing->sink path without requiring network services for every perf
  run
- byte-normalized `highWaterMarkBytes` and `summary.peakRssBytes`, derived
  from `process.resourceUsage().maxRSS` before persistence

## Exact Commands

### Focused automated validation

```sh
bun test test/perf-harness/benchmark-v2.test.ts
```

This focused file now covers:

- the single-adapter happy path
- the explicit multi-adapter failure path when one requested adapter is absent
- the `highWaterMarkBytes` byte-normalization helper

### Exact wrapper command used for the packet-local proof run

```sh
tmp_root=$(mktemp -d /tmp/jin-w3-perf03.XXXXXX)
config_dir="$tmp_root/config"
out_dir="$tmp_root/results"
codex_home="$tmp_root/codex-home"
mkdir -p "$config_dir" "$out_dir" "$codex_home/sessions/2026/02/21"
cp test/fixtures/codex/2026-02-21T12-48-43-testcodex.jsonl \
  "$codex_home/sessions/2026/02/21/rollout-simple.jsonl"
cat > "$config_dir/config.json" <<'EOF'
{
  "adapters": {
    "claude-code": { "enabled": false },
    "cursor": { "enabled": false },
    "codex": { "enabled": true },
    "warp": { "enabled": false },
    "gemini-cli": { "enabled": false },
    "kiro": { "enabled": false },
    "amp": { "enabled": false },
    "opencode": { "enabled": false },
    "pi": { "enabled": false },
    "piagent": { "enabled": false }
  },
  "sinks": [],
  "routes": [],
  "watch": { "pollIntervalMs": 0 }
}
EOF
JIN_CONFIG_DIR="$config_dir" \
JIN_BENCHMARK_ADAPTERS=codex \
JIN_BENCHMARK_DATASET_DIR="$codex_home" \
JIN_BENCHMARK_OUTPUT_DIR="$out_dir" \
bash test/perf-harness/run-v2-benchmark.sh
```

## Observed Artifacts

- aggregate report:
  - `/tmp/jin-w3-perf03-recheck.6EtR7l/results/report.json`
- latest pointer copy:
  - `/tmp/jin-w3-perf03-recheck.6EtR7l/config/benchmarks/latest.json`
- phase artifacts:
  - `/tmp/jin-w3-perf03-recheck.6EtR7l/results/phase-discovery.json`
  - `/tmp/jin-w3-perf03-recheck.6EtR7l/results/phase-load.json`
  - `/tmp/jin-w3-perf03-recheck.6EtR7l/results/phase-load-write.json`
  - `/tmp/jin-w3-perf03-recheck.6EtR7l/results/phase-push.json`
  - `/tmp/jin-w3-perf03-recheck.6EtR7l/results/phase-runtime.json`
  - `/tmp/jin-w3-perf03-recheck.6EtR7l/results/phase-shutdown-flush.json`

Observed phase list:

- `discovery`
- `load`
- `load-write`
- `push`
- `runtime`
- `shutdown-flush`

Observed verdict:

- `pass`

Observed peak RSS:

- `63717376` bytes (`60.8 MB`)

## Notes

- The default push mode is `synthetic` so local and CI runs can measure the v2
  push/runtime surfaces without depending on an external sink being reachable.
- `JIN_BENCHMARK_PUSH_MODE=real` and `JIN_BENCHMARK_PUSH_MODE=hybrid` remain
  available when an operator wants the configured sinks involved in the run.
- The runtime phase exits its child process immediately after emitting the
  startup artifact so the harness does not spend the full shutdown drain budget
  waiting on non-measured cleanup work.
- The packet-local proof run kept `JIN_BENCHMARK_ADAPTERS=codex`, so the
  artifact target and the executed adapter set matched exactly. The focused
  automated failure case now covers the explicit `codex,amp` request where
  `amp` is absent and the harness must error instead of silently dropping it.
