#!/bin/bash
set -e

# ─── jin perf harness runner ────────────────────────────────────────────
# Usage: ./test/perf-harness/run.sh [--rebuild]
#
# Copies real conversations, builds jin in Docker, runs the full
# instrumented lifecycle, and prints results.
#
# Results saved to test/perf-harness/results/

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"
RESULTS_DIR="$SCRIPT_DIR/results"

echo "jin perf harness"
echo "================"
echo ""

# ─── Step 1: Copy conversation data ─────────────────────────────────────

echo "[1/4] Copying conversation data..."
rm -rf "$FIXTURES_DIR"
mkdir -p "$FIXTURES_DIR"

# Copy all Claude Code project directories (preserving structure)
if [ -d "$HOME/.claude/projects" ]; then
  cp -r "$HOME/.claude/projects/"* "$FIXTURES_DIR/" 2>/dev/null || true
fi

# Copy Gemini CLI sessions if they exist
if [ -d "$HOME/.gemini" ]; then
  mkdir -p "$FIXTURES_DIR/.gemini"
  cp -r "$HOME/.gemini/tmp" "$FIXTURES_DIR/.gemini/" 2>/dev/null || true
fi

FILE_COUNT=$(find "$FIXTURES_DIR" -name "*.jsonl" -o -name "*.json" | wc -l)
TOTAL_SIZE=$(du -sh "$FIXTURES_DIR" | awk '{print $1}')
echo "  $FILE_COUNT files, $TOTAL_SIZE total"
echo ""

# ─── Step 2: Prepare results dir ────────────────────────────────────────

echo "[2/4] Preparing results directory..."
mkdir -p "$RESULTS_DIR"
# Timestamp the run
RUN_ID=$(date '+%Y%m%d-%H%M%S')
RUN_DIR="$RESULTS_DIR/$RUN_ID"
mkdir -p "$RUN_DIR"
# Symlink latest
ln -sfn "$RUN_ID" "$RESULTS_DIR/latest"
echo "  Run ID: $RUN_ID"
echo "  Results: $RUN_DIR"
echo ""

# ─── Step 3: Build and run ──────────────────────────────────────────────

echo "[3/4] Building and starting containers..."

cd "$SCRIPT_DIR"

# Update docker-compose to mount the run-specific results dir
docker compose down -v 2>/dev/null || true

if [ "$1" = "--rebuild" ]; then
  echo "  (forcing rebuild)"
  docker compose build --no-cache
else
  docker compose build
fi

echo ""
echo "[4/4] Running harness..."
echo "─────────────────────────────────────────────"

# Run with the results dir mounted (chmod for container user)
chmod 777 "$RUN_DIR"
docker compose run --rm \
  -v "$RUN_DIR:/results" \
  jin

echo "─────────────────────────────────────────────"
echo ""

# ─── Results ─────────────────────────────────────────────────────────────

docker compose down -v 2>/dev/null || true

echo ""
echo "═══ RESULTS ═══"
echo ""

if [ -f "$RUN_DIR/report.txt" ]; then
  cat "$RUN_DIR/report.txt"
fi

echo ""
echo "Files:"
echo "  Report:    $RUN_DIR/report.txt"
echo "  JSON:      $RUN_DIR/report.json"
echo "  Benchmark: $RUN_DIR/benchmark.json"
echo "  Metrics:   $RUN_DIR/metrics.jsonl"
echo ""
echo "Compare runs:"
echo "  diff $RESULTS_DIR/<run-a>/report.txt $RESULTS_DIR/<run-b>/report.txt"
echo ""

# ─── Cleanup fixtures (large, don't commit) ─────────────────────────────
echo "Cleaning up fixtures..."
rm -rf "$FIXTURES_DIR"
echo "Done."
