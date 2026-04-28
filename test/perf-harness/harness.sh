#!/bin/bash
set -e

# ─── jin performance harness ────────────────────────────────────────────
# Runs inside Docker. Measures the full lifecycle using REAL jin commands:
#   jin connect --team → jin connect <repo> --sink → jin start → ingest → verify postgres
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

# ─── Phase 1: jin connect --team (dogfooding real commands) ──────────────

log ""
log "═══ PHASE 1: JIN CONNECT --TEAM ═══"

# Build Postgres team config base64 the same way a team lead would
TEAM_JSON="{\"type\":\"postgres\",\"id\":\"perf-test\",\"connectionString\":\"$PG_CONN\",\"teamId\":\"perf-team\",\"userId\":\"perf-user\"}"
TEAM_B64=$(echo -n "$TEAM_JSON" | base64 -w0)
log "Postgres team config (base64): ${TEAM_B64:0:40}..."

TEAM_CONNECT_START=$(date +%s%N)
CONNECT_TEAM_JSON=$(jin connect --team="$TEAM_B64" --json 2>&1 || echo "{}")
echo "$CONNECT_TEAM_JSON" | tee -a "$REPORT"
TEAM_CONNECT_END=$(date +%s%N)
TEAM_CONNECT_MS=$(( (TEAM_CONNECT_END - TEAM_CONNECT_START) / 1000000 ))
metric "connect_team" "pg_duration_ms" "$TEAM_CONNECT_MS"

# Build S3 team config and create MinIO bucket
S3_ENDPOINT="$JIN_PERF_S3_ENDPOINT"
S3_BUCKET="$JIN_PERF_S3_BUCKET"
S3_ACCESS_KEY="$JIN_PERF_S3_ACCESS_KEY"
S3_SECRET_KEY="$JIN_PERF_S3_SECRET_KEY"

SCRIPTS_DIR="/home/testuser/jin-src/test/perf-harness/scripts"

if [ -n "$S3_ENDPOINT" ]; then
  log ""
  log "Creating MinIO bucket: $S3_BUCKET"
  cd /home/testuser/jin-src
  BUCKET_RESULT=$(bun run "$SCRIPTS_DIR/create-s3-bucket.ts" "$S3_ENDPOINT" "$S3_BUCKET" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" 2>/dev/null || echo '{"ok":false}')
  log "  Bucket result: $BUCKET_RESULT"
  cd /home/testuser

  S3_JSON="{\"type\":\"s3\",\"id\":\"perf-s3\",\"bucket\":\"$S3_BUCKET\",\"endpoint\":\"$S3_ENDPOINT\",\"accessKeyId\":\"$S3_ACCESS_KEY\",\"secretAccessKey\":\"$S3_SECRET_KEY\",\"region\":\"us-east-1\",\"prefix\":\"jin/\",\"teamId\":\"perf-team\",\"userId\":\"perf-user\"}"
  S3_B64=$(echo -n "$S3_JSON" | base64 -w0)
  log "S3 team config (base64): ${S3_B64:0:40}..."

  S3_CONNECT_START=$(date +%s%N)
  jin connect --team="$S3_B64" --json 2>&1 | tee -a "$REPORT" >/dev/null
  S3_CONNECT_END=$(date +%s%N)
  S3_CONNECT_MS=$(( (S3_CONNECT_END - S3_CONNECT_START) / 1000000 ))
  metric "connect_team" "s3_duration_ms" "$S3_CONNECT_MS"
fi

# Verify workspace connect created the sink and reported repos
log ""
log "Verifying workspace connect results..."
log "connect --team --json output length: ${#CONNECT_TEAM_JSON} chars"

# Extract project names using bun (reliable JSON parsing, no fragile grep)
PROJECTS_FILE="$RESULTS_DIR/projects.txt"
cd /home/testuser/jin-src
bun -e "
const data = JSON.parse(process.argv[1]);
const projects = data.projects || [];
for (const p of projects) console.log(p);
" "$CONNECT_TEAM_JSON" > "$PROJECTS_FILE" 2>/dev/null || true
cd /home/testuser

PROJECT_COUNT=$(wc -l < "$PROJECTS_FILE" | tr -d ' ')
metric "connect_team" "projects_discovered" "$PROJECT_COUNT"
log "Discovered $PROJECT_COUNT projects:"
cat "$PROJECTS_FILE" | while read p; do log "  - $p"; done

# ─── Phase 2: jin connect (dogfooding real commands) ─────────────────────

log ""
log "═══ PHASE 2: JIN CONNECT ═══"

CONNECT_COUNT=0
while IFS= read -r project; do
  [ -z "$project" ] && continue
  log "  Connecting: $project → perf-test (postgres)"
  jin connect "$project" --sink=perf-test 2>&1 | tee -a "$REPORT" || true
  if [ -n "$S3_ENDPOINT" ]; then
    log "  Connecting: $project → perf-s3 (s3)"
    jin connect "$project" --sink=perf-s3 2>&1 | tee -a "$REPORT" || true
  fi
  CONNECT_COUNT=$((CONNECT_COUNT + 1))
done < "$PROJECTS_FILE"

if [ "$CONNECT_COUNT" -eq 0 ]; then
  log "  WARNING: No projects connected. No routes will match."
  log "  This likely means `jin connect --team --json` found no repos in the store."
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

# Run verification script — returns JSON with conversations, messages, invalidRoles, teamId, userId, topConversations
PG_RESULT=$(bun run "$SCRIPTS_DIR/verify-postgres.ts" "$PG_CONN" 2>/dev/null || echo '{}')
log "Postgres result: $PG_RESULT"

CONVERSATIONS=$(echo "$PG_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" conversations 2>/dev/null || echo "0")
MESSAGES=$(echo "$PG_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" messages 2>/dev/null || echo "0")
VALID_ROLES=$(echo "$PG_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" invalidRoles 2>/dev/null || echo "-1")
TEAM_ID=$(echo "$PG_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" teamId 2>/dev/null || echo "")
USER_ID=$(echo "$PG_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" userId 2>/dev/null || echo "")

metric "postgres" "conversations" "$CONVERSATIONS"
metric "postgres" "messages" "$MESSAGES"

# Get SQLite counts for completeness check
JIN_STATUS=$(jin status 2>/dev/null || echo "")
SQLITE_SESSIONS=$(echo "$JIN_STATUS" | sed -n 's/.*sessions[[:space:]]*\([0-9,]*\).*/\1/p' | tr -d ',' | head -1)
SQLITE_MESSAGES=$(echo "$JIN_STATUS" | sed -n 's/.*messages[[:space:]]*\([0-9,]*\).*/\1/p' | tr -d ',' | head -1)
SQLITE_SESSIONS=${SQLITE_SESSIONS:-0}
SQLITE_MESSAGES=${SQLITE_MESSAGES:-0}
metric "completeness" "sqlite_sessions" "$SQLITE_SESSIONS"
metric "completeness" "sqlite_messages" "$SQLITE_MESSAGES"
if [ "$SQLITE_MESSAGES" -gt 0 ] 2>/dev/null; then
  PUSH_PCT=$(( MESSAGES * 100 / SQLITE_MESSAGES ))
  metric "completeness" "push_pct" "${PUSH_PCT}%"
  log "Push completeness: $MESSAGES / $SQLITE_MESSAGES messages (${PUSH_PCT}%)"
fi

# Conversation details for report
log ""
log "Postgres conversation details:"
PG_TOP=$(echo "$PG_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" topConversations 2>/dev/null || echo "[]")
log "  $PG_TOP"

# ─── S3 Verification ─────────────────────────────────────────────────────

S3_CONVERSATIONS=0
S3_MESSAGES=0
S3_VALID=0
S3_SAMPLE_TEAM=""
S3_SAMPLE_USER=""

if [ -n "$S3_ENDPOINT" ]; then
  log ""
  log "═══ PHASE 7b: S3 VERIFICATION ═══"

  cd /home/testuser/jin-src

  # Run verification script — returns JSON with conversations, totalMessages, sample
  S3_RESULT=$(bun run "$SCRIPTS_DIR/verify-s3.ts" "$S3_ENDPOINT" "$S3_BUCKET" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" 2>/dev/null || echo '{}')
  log "S3 result: $S3_RESULT"

  S3_CONVERSATIONS=$(echo "$S3_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" conversations 2>/dev/null || echo "0")
  S3_MESSAGES=$(echo "$S3_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" totalMessages 2>/dev/null || echo "0")

  metric "s3" "conversations" "$S3_CONVERSATIONS"
  metric "s3" "total_messages" "$S3_MESSAGES"
  log "S3 objects: $S3_CONVERSATIONS conversation files, $S3_MESSAGES total messages"

  # Check sample validity
  S3_SAMPLE_MSGS=$(echo "$S3_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" sample.messageCount 2>/dev/null || echo "0")
  S3_SAMPLE_TEAM=$(echo "$S3_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" sample.teamId 2>/dev/null || echo "")
  S3_SAMPLE_USER=$(echo "$S3_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" sample.userId 2>/dev/null || echo "")
  S3_SAMPLE_HAS_CONVERSATION=$(echo "$S3_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" sample.hasConversation 2>/dev/null || echo "false")
  S3_SAMPLE_KEY=$(echo "$S3_RESULT" | bun run "$SCRIPTS_DIR/json-field.ts" sample.key 2>/dev/null || echo "")

  if [ -n "$S3_SAMPLE_KEY" ]; then
    metric "s3" "sample_key" "$S3_SAMPLE_KEY"
    metric "s3" "sample_messages" "$S3_SAMPLE_MSGS"
    metric "s3" "sample_team_id" "$S3_SAMPLE_TEAM"
    metric "s3" "sample_user_id" "$S3_SAMPLE_USER"
    log "S3 sample: $S3_SAMPLE_KEY — $S3_SAMPLE_MSGS messages, team=$S3_SAMPLE_TEAM, user=$S3_SAMPLE_USER"

    if [ "$S3_SAMPLE_HAS_CONVERSATION" = "true" ] && [ "$S3_SAMPLE_MSGS" -gt 0 ] 2>/dev/null; then
      S3_VALID=1
    fi
  fi

  cd /home/testuser
fi

# ─── Assertions ──────────────────────────────────────────────────────────

log ""
log "═══ ASSERTIONS ═══"

assert_gt "postgres_conversations" "$CONVERSATIONS" "0"
assert_gt "postgres_messages" "$MESSAGES" "0"
assert_eq "team_id" "$TEAM_ID" "perf-team"
assert_eq "user_id" "$USER_ID" "perf-user"
assert_eq "invalid_roles" "$VALID_ROLES" "0"

# Push completeness: at least 95% of SQLite messages should be in Postgres
if [ "$SQLITE_MESSAGES" -gt 0 ] 2>/dev/null; then
  MIN_MESSAGES=$(( SQLITE_MESSAGES * 95 / 100 ))
  assert_gt "push_completeness_95pct" "$MESSAGES" "$MIN_MESSAGES"
fi

# S3 assertions
if [ -n "$S3_ENDPOINT" ]; then
  assert_gt "s3_conversations" "$S3_CONVERSATIONS" "0"
  assert_gt "s3_messages" "$S3_MESSAGES" "0"
  assert_eq "s3_sample_valid" "$S3_VALID" "1"
  assert_eq "s3_team_id" "$S3_SAMPLE_TEAM" "perf-team"
  assert_eq "s3_user_id" "$S3_SAMPLE_USER" "perf-user"
fi

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
  log "  - jin connect --team did not register the sink"
  log "  - jin connect did not route projects to the sink"
  log "  - Postgres unreachable from container"
  log "  - Adapter detected 0 sessions (conversation fixtures missing?)"
  exit 1
fi
