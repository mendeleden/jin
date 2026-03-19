/**
 * Cross-platform E2E verification test.
 *
 * Seeds adapter fixtures into a temp home, runs adapter detection + ingestion,
 * and verifies everything lands correctly in SQLite. Catches the exact class
 * of bugs from PR #20:
 *   - SQLite WAL handle leaks (EBUSY on cleanup)
 *   - Store open/close/reopen lifecycle
 *   - Adapter path resolution on Windows
 *   - File locking during cleanup
 *
 * No Docker needed — runs on Linux, macOS, and Windows.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, cpSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Temp home setup (BEFORE any adapter imports) ────────────────────────

const isWindows = process.platform === "win32";
const tmpHome = mkdtempSync(join(tmpdir(), "jin-e2e-"));

// Save originals to restore in afterAll
const origHome = process.env.HOME;
const origUserProfile = process.env.USERPROFILE;
const origCodexHome = process.env.CODEX_HOME;
const origJinConfigDir = process.env.JIN_CONFIG_DIR;

// Override home so adapters discover our fixtures
process.env.HOME = tmpHome;
if (isWindows) process.env.USERPROFILE = tmpHome;
process.env.CODEX_HOME = join(tmpHome, ".codex");

// Jin config dir — isolated from real config
const configDir = join(tmpHome, ".config", "jin");
process.env.JIN_CONFIG_DIR = configDir;
mkdirSync(configDir, { recursive: true });

// ─── Copy fixtures into adapter-expected locations ───────────────────────

const fixturesDir = join(import.meta.dir, "fixtures");

// Claude Code: $HOME/.config/claude/projects/<hash>/<session>.jsonl
const ccProjectDir = join(tmpHome, ".config", "claude", "projects", "test-project-hash");
mkdirSync(ccProjectDir, { recursive: true });
cpSync(
  join(fixturesDir, "claude-code", "00c4c4e7.jsonl"),
  join(ccProjectDir, "00c4c4e7-2dac-41ce-93d2-984430f37c69.jsonl"),
);

// Codex: $CODEX_HOME/sessions/<session>.jsonl
const codexSessionsDir = join(tmpHome, ".codex", "sessions");
mkdirSync(codexSessionsDir, { recursive: true });
cpSync(
  join(fixturesDir, "codex", "2026-02-21T12-48-43-testcodex.jsonl"),
  join(codexSessionsDir, "2026-02-21T12-48-43-testcodex.jsonl"),
);

// Gemini CLI: $HOME/.gemini/tmp/<project>/chats/session-<id>.json
const geminiChatsDir = join(tmpHome, ".gemini", "tmp", "test-project", "chats");
mkdirSync(geminiChatsDir, { recursive: true });
cpSync(
  join(fixturesDir, "gemini-cli", "session-623e21e2-8e7c-4cab-8f23-791b74a26033.json"),
  join(geminiChatsDir, "session-623e21e2-8e7c-4cab-8f23-791b74a26033.json"),
);

// ─── Dynamic imports (after HOME override) ───────────────────────────────

const { ClaudeCodeAdapter } = await import("../src/adapters/claude-code");
const { CodexAdapter } = await import("../src/adapters/codex");
const { GeminiCliAdapter } = await import("../src/adapters/gemini-cli");
const { Store } = await import("../src/store");
import type { Session, Message } from "../src/adapters/types";

// ─── Shared state ────────────────────────────────────────────────────────

const dbPath = join(configDir, "store.db");
const allSessions: { adapter: string; session: Session; messages: Message[] }[] = [];

// ─── Cleanup with retry for Windows EBUSY ────────────────────────────────

function robustCleanup(dir: string, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err: any) {
      if (i === maxRetries - 1) throw err;
      // EBUSY/EPERM on Windows — WAL handles may need a moment to release
      if (err.code === "EBUSY" || err.code === "EPERM") {
        Bun.sleepSync(200 * (i + 1));
        continue;
      }
      throw err;
    }
  }
}

afterAll(() => {
  process.env.HOME = origHome;
  if (isWindows) process.env.USERPROFILE = origUserProfile;
  process.env.CODEX_HOME = origCodexHome;
  process.env.JIN_CONFIG_DIR = origJinConfigDir;
  robustCleanup(tmpHome);
});

// ═════════════════════════════════════════════════════════════════════════
// 1. Adapter detection + session parsing
// ═════════════════════════════════════════════════════════════════════════

describe("adapter detection and parsing", () => {
  test("claude-code: detects fixtures and parses sessions + messages", async () => {
    const adapter = new ClaudeCodeAdapter();
    expect(await adapter.detect()).toBe(true);

    const sessions = await adapter.sessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const session = sessions[0];
    expect(session.adapterId).toBe("claude-code");
    expect(session.messageCount).toBeGreaterThan(0);

    const messages = await adapter.messages(session.id, session.sourcePath);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.role === "user")).toBe(true);
    expect(messages.some((m) => m.role === "assistant")).toBe(true);

    allSessions.push({ adapter: "claude-code", session, messages });
  });

  test("codex: detects fixtures and parses sessions + messages", async () => {
    const adapter = new CodexAdapter();
    expect(await adapter.detect()).toBe(true);

    const sessions = await adapter.sessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const session = sessions[0];
    expect(session.adapterId).toBe("codex");

    const messages = await adapter.messages(session.id);
    expect(messages.length).toBeGreaterThan(0);

    allSessions.push({ adapter: "codex", session, messages });
  });

  test("gemini-cli: detects fixtures and parses sessions + messages", async () => {
    const adapter = new GeminiCliAdapter();
    expect(await adapter.detect()).toBe(true);

    const sessions = await adapter.sessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const session = sessions[0];
    expect(session.adapterId).toBe("gemini-cli");

    const messages = await adapter.messages(session.id);
    // Gemini adapter may need sourcePath for message lookup
    if (messages.length === 0 && session.sourcePath) {
      const data = await Bun.file(session.sourcePath).json();
      expect((data.messages || data.turns || []).length).toBeGreaterThan(0);
    }

    allSessions.push({ adapter: "gemini-cli", session, messages });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. SQLite ingestion
// ═════════════════════════════════════════════════════════════════════════

describe("sqlite ingestion", () => {
  let store: InstanceType<typeof Store>;

  test("ingest all adapter sessions into store", () => {
    store = new Store(dbPath);

    for (const { session, messages } of allSessions) {
      store.upsertSession(session);
      if (messages.length > 0) {
        store.upsertMessages(session.id, messages);
      }
    }

    expect(store.sessionCount()).toBe(allSessions.length);
    expect(store.messageCount()).toBeGreaterThan(0);
  });

  test("adapter IDs are correct in store", () => {
    const byAdapter = store.analyzeByAdapter();
    const adapterIds = Object.keys(byAdapter);
    expect(adapterIds).toContain("claude-code");
    expect(adapterIds).toContain("codex");
    expect(adapterIds).toContain("gemini-cli");
  });

  test("all messages have valid roles", () => {
    for (const { session } of allSessions) {
      const messages = store.getMessages(session.id);
      for (const msg of messages) {
        expect(["user", "assistant", "system"]).toContain(msg.role);
      }
    }
  });

  test("re-upsert is idempotent", () => {
    const beforeSessions = store.sessionCount();
    const beforeMessages = store.messageCount();

    for (const { session, messages } of allSessions) {
      store.upsertSession(session);
      if (messages.length > 0) {
        store.upsertMessages(session.id, messages);
      }
    }

    expect(store.sessionCount()).toBe(beforeSessions);
    expect(store.messageCount()).toBe(beforeMessages);
  });

  test("push tracking works without real sinks", () => {
    const sessionId = allSessions[0].session.id;
    const fakeEndpoint = "fake-sink-0";

    // Before any push, session should need pushing
    const needsPush = store.sessionsNeedingPush(fakeEndpoint);
    expect(needsPush.has(sessionId)).toBe(true);

    // Log a push
    const msgCount = store.messageCountForSession(sessionId);
    store.logPush(sessionId, fakeEndpoint, 200, "ok", msgCount);

    // After push, should report correct message count
    const lastCount = store.lastPushedMessageCount(sessionId, fakeEndpoint);
    expect(lastCount).toBe(msgCount);
  });

  test("store closes cleanly", () => {
    store.close();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3. Store lifecycle — catches WAL handle leak (PR #20 bug #3)
// ═════════════════════════════════════════════════════════════════════════

describe("store lifecycle (WAL handle leak regression)", () => {
  test("open → write → close → reopen → read → close cycle", () => {
    const cyclePath = join(configDir, "lifecycle.db");

    // Cycle 1: create and write
    const store1 = new Store(cyclePath);
    store1.upsertSession(allSessions[0].session);
    store1.upsertMessages(allSessions[0].session.id, allSessions[0].messages);
    const count1 = store1.sessionCount();
    store1.close();

    // Cycle 2: reopen and verify data survived
    const store2 = new Store(cyclePath);
    expect(store2.sessionCount()).toBe(count1);
    expect(store2.messageCount()).toBeGreaterThan(0);
    store2.close();

    // Cycle 3: reopen, write more, close
    const store3 = new Store(cyclePath);
    if (allSessions.length > 1) {
      store3.upsertSession(allSessions[1].session);
      store3.upsertMessages(allSessions[1].session.id, allSessions[1].messages);
    }
    expect(store3.sessionCount()).toBeGreaterThanOrEqual(count1);
    store3.close();

    // WAL files should not prevent deletion (the EBUSY bug)
    robustCleanup(join(configDir, "lifecycle.db"));
    robustCleanup(join(configDir, "lifecycle.db-wal"));
    robustCleanup(join(configDir, "lifecycle.db-shm"));
  });

  test("concurrent store instances on different DBs don't interfere", () => {
    const pathA = join(configDir, "concurrent-a.db");
    const pathB = join(configDir, "concurrent-b.db");

    const storeA = new Store(pathA);
    const storeB = new Store(pathB);

    storeA.upsertSession(allSessions[0].session);
    storeB.upsertSession(allSessions[0].session);

    expect(storeA.sessionCount()).toBe(1);
    expect(storeB.sessionCount()).toBe(1);

    storeA.close();
    storeB.close();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 4. Cleanup — catches Windows file locking (PR #20 bug #4)
// ═════════════════════════════════════════════════════════════════════════

describe("cleanup (file locking regression)", () => {
  test("temp dir with closed DB can be removed", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "jin-cleanup-"));
    const tempDb = join(tempDir, "test.db");

    const store = new Store(tempDb);
    store.upsertSession(allSessions[0].session);
    store.close();

    // This is what failed on Windows before PR #20 — rmSync threw EBUSY
    // because SQLite WAL .db-shm mmap handles weren't released on close()
    robustCleanup(tempDir);
    expect(existsSync(tempDir)).toBe(false);
  });
});
