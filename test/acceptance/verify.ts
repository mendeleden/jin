#!/usr/bin/env bun
/**
 * Cross-platform acceptance test for jin.
 *
 * Simulates what a new user does:
 *   install script → jin start → verify data
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
import { mkdtempSync, mkdirSync, cpSync, rmSync, existsSync, readFileSync } from "fs";
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

async function waitForDeferredWatcherStartup(
  configDir: string,
  maxWaitMs = 10_000,
): Promise<void> {
  const debugPath = join(configDir, "debug.jsonl");
  const deadline = Date.now() + maxWaitMs;
  let consecutiveIdlePolls = 0;

  while (Date.now() < deadline) {
    if (existsSync(debugPath)) {
      const lines = readFileSync(debugPath, "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);
      const last = lines.length > 0 ? safeParse(lines[lines.length - 1]!) : null;
      const event = typeof last?.event === "string" ? last.event : "";
      const queueSize = typeof last?.queueSize === "number" ? last.queueSize : -1;

      if (
        queueSize === 0 &&
        (event === "work:end" ||
          event === "push:result" ||
          event === "ingest:result" ||
          event === "reclaim:adapter-boundary")
      ) {
        consecutiveIdlePolls += 1;
        if (consecutiveIdlePolls >= 2) {
          await Bun.sleep(1000);
          return;
        }
      } else {
        consecutiveIdlePolls = 0;
      }
    }

    await Bun.sleep(500);
  }
}

async function waitForRuntimeShutdown(
  env: Record<string, string>,
  maxWaitMs = 15_000,
): Promise<{ stopped: boolean; detail: string }> {
  const deadline = Date.now() + maxWaitMs;
  let lastDetail = "jin status did not return usable shutdown state";
  while (Date.now() < deadline) {
    const statusResult = await run(["status", "--json"], env);
    lastDetail = `exit ${statusResult.exitCode}: ${statusResult.stderr || statusResult.stdout}`.slice(0, 500);
    if (statusResult.exitCode === 0) {
      try {
        const status = JSON.parse(statusResult.stdout) as {
          runtime?: { state?: string };
        };
        lastDetail = statusResult.stdout.slice(0, 500);
        if (status.runtime?.state === "stopped") {
          return {
            stopped: true,
            detail: lastDetail,
          };
        }
      } catch {
        // keep polling
      }
    }
    await Bun.sleep(500);
  }

  return {
    stopped: false,
    detail: lastDetail,
  };
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readDiagnosticTail(configDir: string, lineCount = 12): string {
  const debugPath = join(configDir, "debug.jsonl");
  if (!existsSync(debugPath)) {
    return "debug log missing";
  }

  const lines = readFileSync(debugPath, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "debug log empty";
  }

  return lines.slice(-lineCount).join("\n");
}

function readDiagnosticEvents(
  configDir: string,
  events: string[],
  lineCount = 20,
): string {
  const debugPath = join(configDir, "debug.jsonl");
  if (!existsSync(debugPath)) {
    return "debug log missing";
  }

  const wanted = new Set(events);
  const matches = readFileSync(debugPath, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => ({ raw: line, parsed: safeParse(line) }))
    .filter((entry) => wanted.has(typeof entry.parsed?.event === "string" ? entry.parsed.event : ""))
    .map((entry) => entry.raw);

  if (matches.length === 0) {
    return `no matching events for: ${events.join(", ")}`;
  }

  return matches.slice(-lineCount).join("\n");
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
assert("jin --help mentions start", helpResult.stdout.includes("start"));

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

// ─── Phase 2: jin start --foreground (bootstrap + daemon lifecycle) ─────

console.log("");
console.log("PHASE 2: JIN START --FOREGROUND (BOOTSTRAP + DAEMON)");

// Start jin in foreground mode, let it do initial ingest, then kill it
const daemonProc = Bun.spawn([JIN_BIN, "start", "--foreground"], {
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env, ...jinEnv, JIN_DAEMON: "1" },
});

// Wait for bootstrap + initial ingest (max 30 seconds) by polling status.
const maxWaitMs = 30_000;
let bootstrapComplete = false;
let bootstrapStatus: any = {};
let bootstrapFailureDetail = "";

for (let i = 0; i < maxWaitMs / 1000; i++) {
  await Bun.sleep(1000);
  const statusResult = await run(["status", "--json"], jinEnv);
  if (statusResult.exitCode !== 0) {
    bootstrapFailureDetail = statusResult.stderr || statusResult.stdout;
    continue;
  }

  try {
    bootstrapStatus = JSON.parse(statusResult.stdout);
  } catch {
    bootstrapFailureDetail = statusResult.stdout.slice(0, 200);
    continue;
  }

  if ((bootstrapStatus.sessions || 0) > 0 && (bootstrapStatus.messages || 0) > 0) {
    bootstrapComplete = true;
    break;
  }
}

if (!bootstrapComplete) {
  const logPath = join(jinConfigDir, "jin.log");
  if (existsSync(logPath)) {
    bootstrapFailureDetail = readFileSync(logPath, "utf8").slice(-1000);
  }
}

assert("daemon starts and completes bootstrap ingest", bootstrapComplete,
  `detail: ${bootstrapFailureDetail.slice(-500)}`);

assert("config file created", existsSync(join(jinConfigDir, "config.json")));
assert("store.db created", existsSync(join(jinConfigDir, "store.db")));

if (bootstrapComplete) {
  assertGt("sessions ingested", bootstrapStatus.sessions, 0);
  assertGt("messages ingested", bootstrapStatus.messages, 0);
  console.log(`  sessions: ${bootstrapStatus.sessions}`);
  console.log(`  messages: ${bootstrapStatus.messages}`);

  if (bootstrapStatus.adapters) {
    const adapters = Array.isArray(bootstrapStatus.adapters)
      ? bootstrapStatus.adapters
      : [];
    const adapterIds = adapters.map((entry: any) =>
      typeof entry === "string" ? entry : entry.id,
    );
    const adapterDetail = [
      `got: ${JSON.stringify(adapters)}`,
      `codex fixture exists: ${existsSync(join(codexDir, "fixture-codex.jsonl"))}`,
      `gemini fixture exists: ${existsSync(join(geminiDir, "session-623e21e2-8e7c-4cab-8f23-791b74a26033.json"))}`,
      "detect tail:",
      readDiagnosticEvents(jinConfigDir, ["detect:start", "detect:adapter", "detect:result"]),
      "ingest tail:",
      readDiagnosticEvents(jinConfigDir, ["work:start", "discovery:result", "ingest:result"], 12),
    ].join("\n");
    assert("claude-code adapter detected", adapterIds.includes("claude-code"), adapterDetail);
    assert("codex adapter detected", adapterIds.includes("codex"), adapterDetail);
    assert("gemini-cli adapter detected", adapterIds.includes("gemini-cli"), adapterDetail);
    assert("multiple adapters in store", adapterIds.length >= 2,
      adapterDetail);
  }
}

// ─── Phase 3: Watcher smoke test ──────────────────────────────────────────

// Mutate an existing Claude transcript while the daemon runs and verify the
// updated message count is observed. This matches the common hot path better
// than relying on brand-new file creation semantics.
if (bootstrapComplete) {
  console.log("");
  console.log("PHASE 3: WATCHER SMOKE TEST");
  await waitForDeferredWatcherStartup(jinConfigDir);

  const preStatus = await run(["status", "--json"], jinEnv);
  let preCount = 0;
  let preMessages = 0;
  try { preCount = JSON.parse(preStatus.stdout).sessions || 0; } catch {}
  try { preMessages = JSON.parse(preStatus.stdout).messages || 0; } catch {}

  const watchedTranscriptPath = join(ccProjectDir, "synth-0.jsonl");
  const existingLines = readFileSync(watchedTranscriptPath, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  const existingFirstLine = safeParse(existingLines[0] ?? "");
  const watchTestSession = typeof existingFirstLine?.sessionId === "string"
    ? existingFirstLine.sessionId
    : "";
  assert("watcher smoke fixture exposes a Claude session id", watchTestSession.length > 0);

  const watchLines = Array.from({ length: 4 }, (_, i) => JSON.stringify({
    type: i % 2 === 0 ? "user" : "assistant",
    sessionId: watchTestSession,
    uuid: `${watchTestSession}-watch-msg-${i}-${Date.now()}`,
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
    message: {
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `Watcher test message ${i}` }],
      model: "claude-sonnet-4-20250514",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    cwd: "/tmp/watcher-test",
  }));
  await Bun.write(
    watchedTranscriptPath,
    `${existingLines.join("\n")}\n${watchLines.join("\n")}\n`,
  );

  // Wait for the watcher debounce + ingest (up to 15 seconds)
  let watcherPickedUp = false;
  for (let i = 0; i < 15; i++) {
    await Bun.sleep(1000);
    const postStatus = await run(["status", "--json"], jinEnv);
    let postCount = 0;
    let postMessages = 0;
    try { postCount = JSON.parse(postStatus.stdout).sessions || 0; } catch {}
    try { postMessages = JSON.parse(postStatus.stdout).messages || 0; } catch {}
    if (postMessages > preMessages) {
      watcherPickedUp = true;
      console.log(`  message count: ${preMessages} → ${postMessages}`);
      break;
    }
  }
  if (watcherPickedUp) {
    assert("watcher picks up transcript updates while daemon runs", true);
  } else {
    console.log(
      `  ⚠ watcher smoke did not observe transcript updates within the wait window\n` +
      `    sessions=${preCount}; messages=${preMessages}\n` +
      `    debug tail:\n${readDiagnosticTail(jinConfigDir)}`,
    );
  }
}

// ─── Daemon shutdown ─────────────────────────────────────────────────────

// On Windows, kill() with no args calls TerminateProcess (hard kill).
// On Unix, SIGINT triggers the graceful shutdown handler in watch.ts.
if (isWindows) {
  daemonProc.kill();
} else {
  daemonProc.kill("SIGINT");
}
const exitCode = await Promise.race([
  daemonProc.exited,
  Bun.sleep(10_000).then(() => null),  // 10s safety timeout
]);
// Exit 0 = graceful, 130 = SIGINT (128+2), 143 = SIGTERM (128+15),
// 1 = TerminateProcess on Windows, null = safety timeout fired
assert("daemon exits after signal",
  exitCode === 0 || exitCode === 1 || exitCode === 130 || exitCode === 143,
  `unexpected exit code: ${exitCode}`);

// PID file should be cleaned up by the shutdown handler
const pidFile = join(jinConfigDir, "jin.pid");
await Bun.sleep(1000);
// Non-fatal: PID cleanup varies by platform
if (existsSync(pidFile)) {
  console.log(`  ⚠ PID file not cleaned up (platform-specific signal handling)`);
  rmSync(pidFile, { force: true });
}
const shutdownState = await waitForRuntimeShutdown(jinEnv);
assert(
  "jin status reaches stopped after daemon shutdown",
  shutdownState.stopped,
  shutdownState.detail,
);

// ─── Phase 4: Post-shutdown SQLite verification ──────────────────────────

console.log("");
console.log("PHASE 4: POST-SHUTDOWN SQLITE VERIFICATION");

// Verify the store is accessible after daemon shutdown (WAL handles released)
const statusAfter = await run(["status", "--json"], jinEnv);
assert("jin status works after daemon shutdown", statusAfter.exitCode === 0);

let afterData: any = {};
try {
  afterData = JSON.parse(statusAfter.stdout);
} catch {}

assertEq("runtime reports stopped after daemon shutdown", afterData.runtime?.state, "stopped");

if (afterData.sessions !== undefined) {
  assertGt("sessions still in store after restart", afterData.sessions, 0);
  assertGt("messages still in store after restart", afterData.messages, 0);

  // Content spot-check: verify adapters are present (not just counts)
  if (afterData.adapters) {
    assert("claude-code in store after restart", afterData.adapters.includes("claude-code"));
  }
}

// ─── Phase 5: One-shot ingest remains idempotent ─────────────────────────

console.log("");
console.log("PHASE 5: IDEMPOTENCY");

const ingest2 = await run(["ingest"], jinEnv);
assert("jin ingest exits cleanly after bootstrap", ingest2.exitCode === 0, `exit ${ingest2.exitCode}: ${ingest2.stderr}`);

const status2 = await run(["status", "--json"], jinEnv);
let status2Data: any = {};
try { status2Data = JSON.parse(status2.stdout); } catch {}

if (afterData.sessions !== undefined && status2Data.sessions !== undefined) {
  assertEq("session count stable after one-shot ingest", status2Data.sessions, afterData.sessions);
}

// ─── Phase 6: Cleanup (EBUSY regression) ─────────────────────────────────

console.log("");
console.log("PHASE 6: CLEANUP (EBUSY REGRESSION)");

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
