#!/bin/bash
set -e

# ─── jin performance harness ────────────────────────────────────────────
# Runs inside Docker. Measures the full lifecycle:
#   install → init → configure sink → start → ingest → monitor
#
# Results written to /results/report.json and /results/report.txt

RESULTS_DIR="/results"
REPORT="$RESULTS_DIR/report.txt"
REPORT_JSON="$RESULTS_DIR/report.json"
PG_CONN="$JIN_PERF_PG"

mkdir -p "$RESULTS_DIR"
> "$REPORT"

# ─── Helpers ─────────────────────────────────────────────────────────────

log() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$REPORT"
}

metric() {
  local phase="$1" key="$2" value="$3"
  echo "  $key: $value" | tee -a "$REPORT"
  # Append to JSON array
  echo "{\"phase\":\"$phase\",\"key\":\"$key\",\"value\":\"$value\",\"ts\":\"$(date -Iseconds)\"}" >> "$RESULTS_DIR/metrics.jsonl"
}

capture_proc() {
  local pid="$1" phase="$2"
  if [ -f "/proc/$pid/status" ]; then
    local rss=$(grep VmRSS /proc/$pid/status | awk '{print $2}')
    local threads=$(grep Threads /proc/$pid/status | awk '{print $2}')
    metric "$phase" "rss_kb" "$rss"
    metric "$phase" "threads" "$threads"
  fi
  if [ -f "/proc/$pid/io" ]; then
    local rchar=$(grep rchar /proc/$pid/io | awk '{print $2}')
    local wchar=$(grep wchar /proc/$pid/io | awk '{print $2}')
    local syscr=$(grep syscr /proc/$pid/io | awk '{print $2}')
    metric "$phase" "rchar_bytes" "$rchar"
    metric "$phase" "wchar_bytes" "$wchar"
    metric "$phase" "syscr" "$syscr"
  fi
  # CPU from ps
  local cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ')
  metric "$phase" "cpu_pct" "$cpu"
}

# ─── Phase 0: Baseline ──────────────────────────────────────────────────

log "═══ PHASE 0: BASELINE ═══"
log "System: $(nproc) CPUs, $(free -m | awk '/Mem:/{print $2}') MB RAM"
log "jin version: $(jin version)"

# Count source data
FILE_COUNT=$(find ~/.claude/projects -name "*.jsonl" -type f 2>/dev/null | wc -l)
TOTAL_SIZE=$(find ~/.claude/projects -name "*.jsonl" -type f -exec du -cb {} + 2>/dev/null | tail -1 | awk '{print $1}')
TOTAL_LINES=$(find ~/.claude/projects -name "*.jsonl" -type f -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
metric "baseline" "jsonl_files" "$FILE_COUNT"
metric "baseline" "total_bytes" "$TOTAL_SIZE"
metric "baseline" "total_lines" "$TOTAL_LINES"

# ─── Phase 1: Init ──────────────────────────────────────────────────────

log ""
log "═══ PHASE 1: JIN INIT ═══"
INIT_START=$(date +%s%N)
jin init 2>&1 | tee -a "$REPORT"
INIT_END=$(date +%s%N)
INIT_MS=$(( (INIT_END - INIT_START) / 1000000 ))
metric "init" "duration_ms" "$INIT_MS"

# ─── Phase 2: Configure Sink ────────────────────────────────────────────

log ""
log "═══ PHASE 2: CONFIGURE SINK ═══"

# Generate team config base64
TEAM_CONFIG=$(echo -n "{\"type\":\"postgres\",\"id\":\"perf-test\",\"connectionString\":\"$PG_CONN\",\"teamId\":\"perf-team\"}" | base64 -w0)
log "Team config: $TEAM_CONFIG"

SINK_START=$(date +%s%N)
jin init --team="$TEAM_CONFIG" --skills 2>&1 | tee -a "$REPORT"
SINK_END=$(date +%s%N)
SINK_MS=$(( (SINK_END - SINK_START) / 1000000 ))
metric "sink_config" "duration_ms" "$SINK_MS"

# Connect all projects
log "Connecting projects..."
for project in $(jin connections 2>&1 | grep '~/' | awk '{print $1}'); do
  jin connect "$project" --sink=perf-test 2>&1 | tee -a "$REPORT" || true
done

# ─── Phase 3: Cold Start + Ingest ───────────────────────────────────────

log ""
log "═══ PHASE 3: START DAEMON (COLD INGEST) ═══"

START_TS=$(date +%s%N)
jin start --foreground &
JIN_PID=$!
sleep 2  # let it start

# Wait for initial ingest to complete (watch log)
INGEST_DONE=0
for i in $(seq 1 60); do
  if grep -q "Initial ingest" ~/.config/jin/jin.log 2>/dev/null; then
    INGEST_DONE=1
    break
  fi
  sleep 1
done
INGEST_END=$(date +%s%N)
INGEST_MS=$(( (INGEST_END - START_TS) / 1000000 ))
metric "cold_start" "duration_ms" "$INGEST_MS"
metric "cold_start" "ingest_done" "$INGEST_DONE"

log "Cold start + ingest: ${INGEST_MS}ms"
capture_proc "$JIN_PID" "post_cold_ingest"

# ─── Phase 4: Idle Monitoring (30 seconds) ──────────────────────────────

log ""
log "═══ PHASE 4: IDLE MONITORING (30s) ═══"

capture_proc "$JIN_PID" "idle_t0"
sleep 10
capture_proc "$JIN_PID" "idle_t10"
sleep 10
capture_proc "$JIN_PID" "idle_t20"
sleep 10
capture_proc "$JIN_PID" "idle_t30"

# ─── Phase 5: Simulate Active Session ───────────────────────────────────

log ""
log "═══ PHASE 5: SIMULATE ACTIVE SESSION ═══"

# Pick the largest JSONL file
TARGET_FILE=$(find ~/.claude/projects -name "*.jsonl" -type f -exec du -b {} + | sort -rn | head -1 | awk '{print $2}')
TARGET_SIZE=$(du -b "$TARGET_FILE" | awk '{print $1}')
log "Target file: $TARGET_FILE ($TARGET_SIZE bytes)"

capture_proc "$JIN_PID" "pre_active"

# Simulate Claude Code streaming: append a line every 500ms for 30 seconds
log "Simulating 60 message writes over 30 seconds..."
for i in $(seq 1 60); do
  echo "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Simulated message $i for perf testing\"}],\"model\":\"claude-sonnet-4-20250514\",\"usage\":{\"input_tokens\":100,\"output_tokens\":50}},\"timestamp\":\"$(date -Iseconds)\"}" >> "$TARGET_FILE"
  sleep 0.5
done

sleep 5  # let final events process
capture_proc "$JIN_PID" "post_active"

# Calculate I/O during active phase
log "Active session I/O cost captured."

# ─── Phase 6: Post-Active Settle ────────────────────────────────────────

log ""
log "═══ PHASE 6: POST-ACTIVE SETTLE (30s) ═══"

capture_proc "$JIN_PID" "settle_t0"
sleep 15
capture_proc "$JIN_PID" "settle_t15"
sleep 15
capture_proc "$JIN_PID" "settle_t30"

# ─── Phase 7: Verify Postgres Data ──────────────────────────────────────

log ""
log "═══ PHASE 7: POSTGRES VERIFICATION ═══"

# Use bun to query Postgres
cd /home/testuser/jin-src
SESSIONS=$(bun -e "
const { SQL } = await import('bun');
const sql = new SQL('$PG_CONN');
const r = await sql.unsafe('SELECT count(*) as cnt FROM public.jin_sessions');
console.log(r[0].cnt);
sql.close();
" 2>/dev/null || echo "0")

MESSAGES=$(bun -e "
const { SQL } = await import('bun');
const sql = new SQL('$PG_CONN');
const r = await sql.unsafe('SELECT count(*) as cnt FROM public.jin_messages');
console.log(r[0].cnt);
sql.close();
" 2>/dev/null || echo "0")

metric "postgres" "sessions" "$SESSIONS"
metric "postgres" "messages" "$MESSAGES"
log "Postgres: $SESSIONS sessions, $MESSAGES messages"

# ─── Phase 8: Benchmark ─────────────────────────────────────────────────

log ""
log "═══ PHASE 8: JIN BENCHMARK ═══"
jin benchmark 2>&1 | tee -a "$REPORT"
jin benchmark --json > "$RESULTS_DIR/benchmark.json" 2>/dev/null || true

# ─── Cleanup ─────────────────────────────────────────────────────────────

log ""
log "═══ DONE ═══"
kill $JIN_PID 2>/dev/null || true
wait $JIN_PID 2>/dev/null || true

# Build final JSON report
cd /home/testuser
bun -e "
const lines = require('fs').readFileSync('$RESULTS_DIR/metrics.jsonl', 'utf-8').trim().split('\n');
const metrics = lines.map(l => JSON.parse(l));
const report = {
  timestamp: new Date().toISOString(),
  system: { cpus: $(nproc), memoryMB: $(free -m | awk '/Mem:/{print $2}') },
  source: { files: $FILE_COUNT, bytes: ${TOTAL_SIZE:-0}, lines: ${TOTAL_LINES:-0} },
  metrics: metrics,
};
require('fs').writeFileSync('$REPORT_JSON', JSON.stringify(report, null, 2));
console.log('Report written to $REPORT_JSON');
" 2>/dev/null || log "JSON report generation failed"

log "Full report: $REPORT"
log "JSON report: $REPORT_JSON"
log "Metrics: $RESULTS_DIR/metrics.jsonl"
