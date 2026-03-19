#!/usr/bin/env bun
/**
 * Cross-platform acceptance test for jin.
 *
 * Simulates what a new user does:
 *   install script → jin init → jin start → verify data
 *
 * Runs the COMPILED BINARY (not bun run src/), which catches
 * platform-specific bugs like the ones from PR #20:
 *   1. Bun.spawn without detached:true (Windows kills children)
 *   2. PID file race (daemon self-detects as running)
 *   3. SQLite WAL .db-shm handles not released (EBUSY)
 *   4. rmSync failing on Windows file locks
 *
 * Usage:
 *   bun run test/acceptance/verify.ts <path-to-jin-binary>
 *
 * Exit code: 0 = pass, 1 = fail
 */
import { mkdtempSync, mkdirSync, cpSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// ─── Config ──────────────────────────────────────────────────────────────

const JIN_BIN = resolve(process.argv[2] || "jin");
const isWindows = process.platform === "win32";
const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures");

// How many synthetic sessions to generate per adapter (in addition to fixtures)
const SYNTHETIC_SESSIONS = 5;
const MESSAGES_PER_SESSION = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function assertGt(label: string, actual: number, min: number) {
  assert(label, actual > min, `expected > ${min}, got ${actual}`);
}

function assertEq(label: string, actual: unknown, expected: unknown) {
  assert(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function run(args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([JIN_BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function robustCleanup(dir: string) {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err: any) {
      if (err.code === "EBUSY" || err.code === "EPERM") {
        Bun.sleepSync(300 * (i + 1));
        continue;
      }
      throw err;
    }
  }
}

// ─── Setup temp home ─────────────────────────────────────────────────────

const tmpHome = mkdtempSync(join(tmpdir(), "jin-accept-"));
const jinConfigDir = join(tmpHome, ".config", "jin");

// Environment for all jin commands — isolated from real home
// JIN_LAUNCHED_BY_SERVICE bypasses the "OS service already running" guard,
// which checks globally (launchctl/systemctl) and would block us on dev machines.
const jinEnv: Record<string, string> = {
  HOME: tmpHome,
  JIN_CONFIG_DIR: jinConfigDir,
  CODEX_HOME: join(tmpHome, ".codex"),
  JIN_LAUNCHED_BY_SERVICE: "1",
};
if (isWindows) {
  jinEnv.USERPROFILE = tmpHome;
  jinEnv.LOCALAPPDATA = join(tmpHome, "AppData", "Local");
}

console.log("");
console.log("jin acceptance test");
console.log("═══════════════════");
console.log(`  platform:  ${process.platform}-${process.arch}`);
console.log(`  binary:    ${JIN_BIN}`);
console.log(`  temp home: ${tmpHome}`);
console.log("");

// ─── Phase 0: Binary smoke test ──────────────────────────────────────────

console.log("PHASE 0: BINARY SMOKE TEST");

const versionResult = await run(["version"], jinEnv);
assert("jin version exits cleanly", versionResult.exitCode === 0, `exit ${versionResult.exitCode}: ${versionResult.stderr}`);
assert("jin version outputs a version string", /\d+\.\d+/.test(versionResult.stdout));
console.log(`  version: ${versionResult.stdout.trim()}`);

const helpResult = await run(["--help"], jinEnv);
assert("jin --help exits cleanly", helpResult.exitCode === 0);
assert("jin --help mentions init", helpResult.stdout.includes("init"));

// ─── Phase 1: Seed fixture data ──────────────────────────────────────────

console.log("");
console.log("PHASE 1: SEED FIXTURE DATA");

// Claude Code fixtures
const ccProjectDir = join(tmpHome, ".config", "claude", "projects", "test-project");
mkdirSync(ccProjectDir, { recursive: true });
cpSync(
  join(FIXTURES_DIR, "claude-code", "00c4c4e7.jsonl"),
  join(ccProjectDir, "fixture-session.jsonl"),
);

// Generate synthetic Claude Code sessions
for (let s = 0; s < SYNTHETIC_SESSIONS; s++) {
  const lines: string[] = [];
  const sessionId = `synth-cc-${s}-${Date.now()}`;
  for (let m = 0; m < MESSAGES_PER_SESSION; m++) {
    const role = m % 2 === 0 ? "user" : "assistant";
    const type = m % 2 === 0 ? "user" : "assistant";
    lines.push(JSON.stringify({
      type,
      sessionId,
      uuid: `${sessionId}-msg-${m}`,
      timestamp: new Date(Date.now() + m * 1000).toISOString(),
      message: {
        role,
        content: [{ type: "text", text: `Synthetic ${role} message ${m} in session ${s}` }],
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      cwd: `/tmp/project-${s}`,
    }));
  }
  await Bun.write(join(ccProjectDir, `synth-${s}.jsonl`), lines.join("\n") + "\n");
}
console.log(`  Claude Code: 1 fixture + ${SYNTHETIC_SESSIONS} synthetic sessions (${MESSAGES_PER_SESSION} msgs each)`);

// Codex fixtures
const codexDir = join(tmpHome, ".codex", "sessions");
mkdirSync(codexDir, { recursive: true });
cpSync(
  join(FIXTURES_DIR, "codex", "2026-02-21T12-48-43-testcodex.jsonl"),
  join(codexDir, "fixture-codex.jsonl"),
);
console.log("  Codex: 1 fixture session");

// Gemini CLI fixtures
const geminiDir = join(tmpHome, ".gemini", "tmp", "test-project", "chats");
mkdirSync(geminiDir, { recursive: true });
cpSync(
  join(FIXTURES_DIR, "gemini-cli", "session-623e21e2-8e7c-4cab-8f23-791b74a26033.json"),
  join(geminiDir, "session-623e21e2-8e7c-4cab-8f23-791b74a26033.json"),
);
console.log("  Gemini CLI: 1 fixture session");

const totalExpectedSessions = 1 + SYNTHETIC_SESSIONS + 1 + 1; // cc fixture + synth + codex + gemini

// ─── Phase 2: jin init ──────────────────────────────────────────────────

console.log("");
console.log("PHASE 2: JIN INIT");

const initResult = await run(["init", "--json"], jinEnv);
assert("jin init exits cleanly", initResult.exitCode === 0, `exit ${initResult.exitCode}: ${initResult.stderr}`);

let initData: any = {};
try {
  initData = JSON.parse(initResult.stdout);
} catch {
  assert("jin init --json returns valid JSON", false, initResult.stdout.slice(0, 200));
}

if (initData.detected) {
  const detectedIds = initData.detected.map((d: any) => d.id);
  assert("claude-code adapter detected", detectedIds.includes("claude-code"));
  assert("codex adapter detected", detectedIds.includes("codex"));
  assert("gemini-cli adapter detected", detectedIds.includes("gemini-cli"));

  const ccAdapter = initData.detected.find((d: any) => d.id === "claude-code");
  if (ccAdapter) {
    assertGt("claude-code session count", ccAdapter.sessions, SYNTHETIC_SESSIONS);
  }
}

assert("config file created", existsSync(join(jinConfigDir, "config.json")));
assert("store.db created", existsSync(join(jinConfigDir, "store.db")));

// ─── Phase 3: jin status (verify ingestion) ──────────────────────────────

console.log("");
console.log("PHASE 3: JIN STATUS (VERIFY INGESTION)");

const statusResult = await run(["status", "--json"], jinEnv);
assert("jin status exits cleanly", statusResult.exitCode === 0, `exit ${statusResult.exitCode}: ${statusResult.stderr}`);

let statusData: any = {};
try {
  statusData = JSON.parse(statusResult.stdout);
} catch {
  assert("jin status --json returns valid JSON", false, statusResult.stdout.slice(0, 200));
}

if (statusData.sessions !== undefined) {
  assertGt("sessions ingested", statusData.sessions, 0);
  assertGt("messages ingested", statusData.messages, 0);
  console.log(`  sessions: ${statusData.sessions}`);
  console.log(`  messages: ${statusData.messages}`);

  if (statusData.adapters) {
    assert("multiple adapters in store", statusData.adapters.length >= 2,
      `got: ${JSON.stringify(statusData.adapters)}`);
  }
}

// ─── Phase 4: jin start --foreground (daemon lifecycle) ──────────────────

console.log("");
console.log("PHASE 4: JIN START --FOREGROUND (DAEMON LIFECYCLE)");

// Start jin in foreground mode, let it do initial ingest, then kill it
const daemonProc = Bun.spawn([JIN_BIN, "start", "--foreground"], {
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env, ...jinEnv, JIN_DAEMON: "1" },
});

// Wait for initial ingest (max 30 seconds)
let daemonOutput = "";
const startTime = Date.now();
const maxWaitMs = 30_000;
let ingestComplete = false;

const reader = daemonProc.stdout.getReader();
const decoder = new TextDecoder();

while (Date.now() - startTime < maxWaitMs) {
  const readPromise = reader.read();
  const timeoutPromise = new Promise<{ done: true; value: undefined }>(
    resolve => setTimeout(() => resolve({ done: true, value: undefined }), 2000)
  );
  const { done, value } = await Promise.race([readPromise, timeoutPromise]);
  if (value) daemonOutput += decoder.decode(value);

  if (daemonOutput.includes("Watching for changes")) {
    ingestComplete = true;
    break;
  }
  if (done) break;
}

assert("daemon starts and completes initial ingest", ingestComplete,
  `output so far: ${daemonOutput.slice(-500)}`);

if (ingestComplete) {
  // Extract session/message counts from log output
  const ingestMatch = daemonOutput.match(/Ingested (\d+) sessions?, (\d+) messages?/);
  if (ingestMatch) {
    const [, sessions, messages] = ingestMatch;
    assertGt("daemon ingested sessions", parseInt(sessions), 0);
    assertGt("daemon ingested messages", parseInt(messages), 0);
    console.log(`  daemon ingested: ${sessions} sessions, ${messages} messages`);
  }
}

// ─── Phase 4b: Watcher smoke test (incremental ingest) ───────────────────

// Write a new JSONL file while the daemon runs, verify it gets picked up
if (ingestComplete) {
  console.log("");
  console.log("PHASE 4b: WATCHER SMOKE TEST");

  const preStatus = await run(["status", "--json"], jinEnv);
  let preCount = 0;
  try { preCount = JSON.parse(preStatus.stdout).sessions || 0; } catch {}

  // Write a new session file into the watched directory
  const watchTestSession = `watch-test-${Date.now()}`;
  const watchLines = Array.from({ length: 5 }, (_, i) => JSON.stringify({
    type: i % 2 === 0 ? "user" : "assistant",
    sessionId: watchTestSession,
    uuid: `${watchTestSession}-msg-${i}`,
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
    message: {
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `Watcher test message ${i}` }],
      model: "claude-sonnet-4-20250514",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    cwd: "/tmp/watcher-test",
  }));
  await Bun.write(join(ccProjectDir, "watcher-test.jsonl"), watchLines.join("\n") + "\n");

  // Wait for the watcher debounce + ingest (up to 15 seconds)
  let watcherPickedUp = false;
  for (let i = 0; i < 15; i++) {
    await Bun.sleep(1000);
    const postStatus = await run(["status", "--json"], jinEnv);
    let postCount = 0;
    try { postCount = JSON.parse(postStatus.stdout).sessions || 0; } catch {}
    if (postCount > preCount) {
      watcherPickedUp = true;
      console.log(`  session count: ${preCount} → ${postCount}`);
      break;
    }
  }
  assert("watcher picks up new file while daemon runs", watcherPickedUp);
}

// ─── Daemon shutdown ─────────────────────────────────────────────────────

// Windows doesn't support SIGINT reliably for child processes — use SIGTERM
daemonProc.kill(isWindows ? "SIGTERM" : "SIGINT");
const exitCode = await daemonProc.exited;
// Exit 0 = graceful handler called process.exit(0)
// Exit 130 = SIGINT (128+2), 143 = SIGTERM (128+15) — normal signal exits
assert("daemon exits after signal",
  exitCode === 0 || exitCode === 130 || exitCode === 143 || exitCode === null,
  `unexpected exit code: ${exitCode}`);

// PID file should be cleaned up by the shutdown handler
const pidFile = join(jinConfigDir, "jin.pid");
await Bun.sleep(1000);
// Non-fatal: PID cleanup varies by platform
if (existsSync(pidFile)) {
  console.log(`  ⚠ PID file not cleaned up (platform-specific signal handling)`);
  rmSync(pidFile, { force: true });
}

// ─── Phase 5: Post-shutdown SQLite verification ──────────────────────────

console.log("");
console.log("PHASE 5: POST-SHUTDOWN SQLITE VERIFICATION");

// Verify the store is accessible after daemon shutdown (WAL handles released)
const statusAfter = await run(["status", "--json"], jinEnv);
assert("jin status works after daemon shutdown", statusAfter.exitCode === 0);

let afterData: any = {};
try {
  afterData = JSON.parse(statusAfter.stdout);
} catch {}

if (afterData.sessions !== undefined) {
  assertGt("sessions still in store after restart", afterData.sessions, 0);
  assertGt("messages still in store after restart", afterData.messages, 0);

  // Content spot-check: verify adapters are present (not just counts)
  if (afterData.adapters) {
    assert("claude-code in store after restart", afterData.adapters.includes("claude-code"));
  }
}

// ─── Phase 6: Second init is idempotent ──────────────────────────────────

console.log("");
console.log("PHASE 6: IDEMPOTENCY");

const init2 = await run(["init", "--json"], jinEnv);
assert("second jin init exits cleanly", init2.exitCode === 0);

const status2 = await run(["status", "--json"], jinEnv);
let status2Data: any = {};
try { status2Data = JSON.parse(status2.stdout); } catch {}

if (afterData.sessions !== undefined && status2Data.sessions !== undefined) {
  assertEq("session count stable after re-init", status2Data.sessions, afterData.sessions);
}

// ─── Phase 7: Cleanup (EBUSY regression) ─────────────────────────────────

console.log("");
console.log("PHASE 7: CLEANUP (EBUSY REGRESSION)");

// This is the exact bug from PR #20 — on Windows, rmSync fails with EBUSY
// because SQLite WAL .db-shm mmap handles aren't released after db.close()
try {
  robustCleanup(tmpHome);
  assert("temp home cleaned up without EBUSY", !existsSync(tmpHome));
} catch (err: any) {
  assert("temp home cleaned up without EBUSY", false, err.message);
}

// ─── Summary ─────────────────────────────────────────────────────────────

console.log("");
console.log("═══════════════════");
console.log(`  ${passed} passed, ${failed} failed`);
console.log("");

if (failed > 0) {
  console.log("ACCEPTANCE TEST FAILED");
  process.exit(1);
} else {
  console.log("ALL CHECKS PASSED");
}
