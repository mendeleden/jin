#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RESULTS_DIR="${JIN_PERF_RESULTS_DIR:-$ROOT_DIR/test/perf-harness/results}"
RUN_ID="${JIN_PERF_RUN_ID:-$(date '+%Y%m%d-%H%M%S')}"
RUN_DIR="${JIN_BENCHMARK_OUTPUT_DIR:-$RESULTS_DIR/$RUN_ID}"

mkdir -p "$RUN_DIR"

export JIN_BENCHMARK_OUTPUT_DIR="$RUN_DIR"
: "${JIN_BENCHMARK_PUSH_MODE:=synthetic}"
export JIN_BENCHMARK_PUSH_MODE

cd "$ROOT_DIR"

bun src/index.ts benchmark --json | tee "$RUN_DIR/stdout.json"

echo
echo "report: $RUN_DIR/report.json"
echo "latest: ${JIN_CONFIG_DIR:-$HOME/.config/jin}/benchmarks/latest.json"
