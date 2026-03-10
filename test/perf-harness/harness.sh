#!/bin/bash
set -e

# ─── jin performance harness ────────────────────────────────────────────
# Runs inside Docker. Measures the full lifecycle using REAL jin commands:
#   jin init --team → jin connect → jin start → ingest → verify postgres
#
# Dogfoods jin's own CLI — no manual config writing.
#
# Results written to /results/report.json and /results/report.txt
# Exit code: 0 = pass, 1 = fail

RESULTS_DIR="/results"
REPORT="$RESULTS_DIR/report.txt"
REPORT_JSON="$RESULTS_DIR/report.json"
PG_CONN="$JIN_PERF_PG"
JIN_CFG_DIR="/home/testuser/.config/jin"
FAIL=0

mkdir -p "$RESULTS_DIR"
> "$REPORT"

# ─── Helpers ─────────────────────────────────────────────────────────────

log() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$REPORT"
}

metric() {
  local phase="$1" key="$2" value="$3"
  echo "  $key: $value" | tee -a "$REPORT"
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
  local cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ')
  metric "$phase" "cpu_pct" "$cpu"
}

assert_gt() {
  local label="$1" actual="$2" min="$3"
  if [ "$actual" -gt "$min" ] 2>/dev/null; then
    log "  ✓ $label: $actual > $min"
  else
    log "  ✗ FAIL: $label: expected > $min, got $actual"
    FAIL=1
  fi
}

assert_eq() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then
    log "  ✓ $label: $actual"
  else
    log "  ✗ FAIL: $label: expected '$expected', got '$actual'"
    FAIL=1
  fi
}

# ─── Phase 0: Baseline ──────────────────────────────────────────────────

log "═══ PHASE 0: BASELINE ═══"
log "System: $(nproc) CPUs, $(free -m | awk '/Mem:/{print $2}') MB RAM"
log "jin version: $(jin version)"

FILE_COUNT=$(find ~/.claude/projects -name "*.jsonl" -type f 2>/dev/null | wc -l)
TOTAL_SIZE=$(find ~/.claude/projects -name "*.jsonl" -type f -exec du -cb {} + 2>/dev/null | tail -1 | awk '{print $1}')
TOTAL_LINES=$(find ~/.claude/projects -name "*.jsonl" -type f -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
metric "baseline" "jsonl_files" "$FILE_COUNT"
metric "baseline" "total_bytes" "$TOTAL_SIZE"
metric "baseline" "total_lines" "$TOTAL_LINES"

# ─── Phase 1: jin init --team (dogfooding real commands) ─────────────────

log ""
log "═══ PHASE 1: JIN INIT --TEAM ═══"

# Build team config base64 the same way a team lead would
TEAM_JSON="{\"type\":\"postgres\",\"id\":\"perf-test\",\"connectionString\":\"$PG_CONN\",\"teamId\":\"perf-team\",\"developerId\":\"perf-dev\"}"
TEAM_B64=$(echo -n "$TEAM_JSON" | base64 -w0)
log "Team config (base64): ${TEAM_B64:0:40}..."

INIT_START=$(date +%s%N)
jin init --team="$TEAM_B64" 2>&1 | tee -a "$REPORT"
INIT_END=$(date +%s%N)
INIT_MS=$(( (INIT_END - INIT_START) / 1000000 ))
metric "init" "duration_ms" "$INIT_MS"

# Verify init created the config and detected adapters
log ""
log "Verifying init results (via jin init --json)..."
INIT_JSON=$(jin init --json 2>&1 || echo "{}")
log "init --json output length: ${#INIT_JSON} chars"
echo "$INIT_JSON" >> "$REPORT"

# Extract project names using bun (reliable JSON parsing, no fragile grep)
PROJECTS_FILE="$RESULTS_DIR/projects.txt"
cd /home/testuser/jin-src
bun -e "
const data = JSON.parse(process.argv[1]);
const projects = data.projects || [];
for (const p of projects) console.log(p);
" "$INIT_JSON" > "$PROJECTS_FILE" 2>/dev/null || true
cd /home/testuser

PROJECT_COUNT=$(wc -l < "$PROJECTS_FILE" | tr -d ' ')
metric "init" "projects_discovered" "$PROJECT_COUNT"
log "Discovered $PROJECT_COUNT projects:"
cat "$PROJECTS_FILE" | while read p; do log "  - $p"; done

# ─── Phase 2: jin connect (dogfooding real commands) ─────────────────────

log ""
log "═══ PHASE 2: JIN CONNECT ═══"

CONNECT_COUNT=0
while IFS= read -r project; do
  [ -z "$project" ] && continue
  log "  Connecting: $project → perf-test"
  jin connect "$project" --sink=perf-test 2>&1 | tee -a "$REPORT" || true
  CONNECT_COUNT=$((CONNECT_COUNT + 1))
done < "$PROJECTS_FILE"

if [ "$CONNECT_COUNT" -eq 0 ]; then
  log "  WARNING: No projects connected. No routes will match."
  log "  This likely means jin init found no projects in the store."
fi

metric "connect" "projects_connected" "$CONNECT_COUNT"

# Show connections (dogfooding jin connections)
log ""
log "jin connections output:"
jin connections 2>&1 | tee -a "$REPORT" || true

# Show status (dogfooding jin status)
log ""
log "jin status output:"
jin status 2>&1 | tee -a "$REPORT" || true

# ─── Phase 3: Cold Start + Ingest ───────────────────────────────────────

log ""
log "═══ PHASE 3: START DAEMON (COLD INGEST) ═══"

START_TS=$(date +%s%N)
jin start --foreground &
JIN_PID=$!
sleep 2

# Wait for initial ingest to complete (watch log)
INGEST_DONE=0
for i in $(seq 1 60); do
  if grep -q "Initial ingest" "$JIN_CFG_DIR/jin.log" 2>/dev/null; then
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

# Wait for initial push to complete
for i in $(seq 1 30); do
  if grep -q "Pushed" "$JIN_CFG_DIR/jin.log" 2>/dev/null; then
    log "Initial push detected in logs"
    break
  fi
  sleep 1
done

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

cd /home/testuser/jin-src

# Count sessions and messages
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

# Verify team_id and developer_id are set correctly
TEAM_ID=$(bun -e "
const { SQL } = await import('bun');
const sql = new SQL('$PG_CONN');
const r = await sql.unsafe('SELECT DISTINCT team_id FROM public.jin_sessions LIMIT 1');
console.log(r.length > 0 ? r[0].team_id : '');
sql.close();
" 2>/dev/null || echo "")

DEV_ID=$(bun -e "
const { SQL } = await import('bun');
const sql = new SQL('$PG_CONN');
const r = await sql.unsafe('SELECT DISTINCT developer_id FROM public.jin_sessions LIMIT 1');
console.log(r.length > 0 ? r[0].developer_id : '');
sql.close();
" 2>/dev/null || echo "")

# Verify messages have valid roles
VALID_ROLES=$(bun -e "
const { SQL } = await import('bun');
const sql = new SQL('$PG_CONN');
const r = await sql.unsafe(\"SELECT count(*) as cnt FROM public.jin_messages WHERE role NOT IN ('user','assistant','system')\");
console.log(r[0].cnt);
sql.close();
" 2>/dev/null || echo "-1")

# Session details for report
log ""
log "Postgres session details:"
bun -e "
const { SQL } = await import('bun');
const sql = new SQL('$PG_CONN');
const rows = await sql.unsafe('SELECT id, adapter_id, name, message_count, team_id, developer_id FROM public.jin_sessions ORDER BY created_at DESC LIMIT 10');
for (const r of rows) {
  console.log('  ' + r.adapter_id + ' | ' + (r.name || '').slice(0,40) + ' | msgs=' + r.message_count + ' | team=' + r.team_id + ' | dev=' + r.developer_id);
}
sql.close();
" 2>&1 | tee -a "$REPORT" || true

# ─── Assertions ──────────────────────────────────────────────────────────

log ""
log "═══ ASSERTIONS ═══"

assert_gt "postgres_sessions" "$SESSIONS" "0"
assert_gt "postgres_messages" "$MESSAGES" "0"
assert_eq "team_id" "$TEAM_ID" "perf-team"
assert_eq "developer_id" "$DEV_ID" "perf-dev"
assert_eq "invalid_roles" "$VALID_ROLES" "0"

# ─── Phase 8: Benchmark ─────────────────────────────────────────────────

log ""
log "═══ PHASE 8: JIN BENCHMARK ═══"
jin benchmark 2>&1 | tee -a "$REPORT"
jin benchmark --json > "$RESULTS_DIR/benchmark.json" 2>/dev/null || true

# ─── Jin log tail ────────────────────────────────────────────────────────

log ""
log "═══ JIN LOG (last 30 lines) ═══"
tail -30 "$JIN_CFG_DIR/jin.log" 2>/dev/null | tee -a "$REPORT" || true

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

# ─── Final verdict ──────────────────────────────────────────────────────

log ""
if [ "$FAIL" -eq 0 ]; then
  log "═══ ALL CHECKS PASSED ═══"
  exit 0
else
  log "═══ SOME CHECKS FAILED ═══"
  log "Review assertions above. Common causes:"
  log "  - jin init --team did not register the sink"
  log "  - jin connect did not route projects to the sink"
  log "  - Postgres unreachable from container"
  log "  - Adapter detected 0 sessions (conversation fixtures missing?)"
  exit 1
fi
