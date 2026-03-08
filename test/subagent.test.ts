/**
 * Tests for sub-agent handling in the claude-code adapter and postgres sink.
 *
 * Covers:
 * - Sub-agent sessions get filename-based IDs (not parent's sessionId)
 * - Sub-agent parentSessionId is correctly set to the parent directory name
 * - findSessionFile resolves agent-* IDs by filename
 * - Postgres sink writes parent_session_id column
 * - Postgres sink updates session_id on message upsert conflict
 *
 * NOTE: Bun's os.homedir() caches the real home dir at startup and does NOT
 * respect process.env.HOME changes. So we place fixtures in the REAL home
 * directory under a unique project name, then filter by sourcePath to
 * isolate test sessions from real ones.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

// ─── Config setup (JIN_CONFIG_DIR can be overridden) ─────────────────────
const tmpConfigDir = join(homedir(), ".config", "jin-test-subagent");
process.env.JIN_CONFIG_DIR = tmpConfigDir;
mkdirSync(tmpConfigDir, { recursive: true });

const configJson = {
  version: 1,
  adapters: { "claude-code": { enabled: true } },
  sinks: [],
  store: {
    dbPath: join(tmpConfigDir, "store.db"),
    rawDir: join(tmpConfigDir, "raw"),
  },
};
await Bun.write(join(tmpConfigDir, "config.json"), JSON.stringify(configJson));

// ─── Create fixture JSONL files in REAL homedir ─────────────────────────
// The adapter uses os.homedir() (cached at startup) to find projects dir.

const PARENT_SESSION_ID = "aabbccdd-1111-2222-3333-444455556666";
const SUB_AGENT_FILE = "agent-abc123def456";
const TEST_PROJECT = "jin-subagent-test-proj";

const projectDir = join(homedir(), ".config", "claude", "projects", TEST_PROJECT);
mkdirSync(projectDir, { recursive: true });

// Parent session JSONL
const parentLines = [
  JSON.stringify({
    type: "user",
    sessionId: PARENT_SESSION_ID,
    uuid: "uuid-parent-msg-1",
    cwd: "/tmp/test",
    timestamp: "2026-03-01T10:00:00Z",
    message: { role: "user", content: "build a feature" },
  }),
  JSON.stringify({
    type: "assistant",
    sessionId: PARENT_SESSION_ID,
    uuid: "uuid-parent-msg-2",
    parentUuid: "uuid-parent-msg-1",
    timestamp: "2026-03-01T10:00:05Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-5-20251101",
      content: [{ type: "text", text: "I'll work on that." }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }),
];
writeFileSync(
  join(projectDir, `${PARENT_SESSION_ID}.jsonl`),
  parentLines.join("\n") + "\n",
);

// Sub-agent JSONL in subagents directory
const subagentsDir = join(projectDir, PARENT_SESSION_ID, "subagents");
mkdirSync(subagentsDir, { recursive: true });

const subAgentLines = [
  JSON.stringify({
    type: "user",
    sessionId: PARENT_SESSION_ID, // sub-agents share parent's sessionId
    uuid: "uuid-sub-msg-1",
    cwd: "/tmp/test",
    timestamp: "2026-03-01T10:01:00Z",
    message: { role: "user", content: "explore the codebase" },
  }),
  JSON.stringify({
    type: "assistant",
    sessionId: PARENT_SESSION_ID,
    uuid: "uuid-sub-msg-2",
    parentUuid: "uuid-sub-msg-1",
    timestamp: "2026-03-01T10:01:05Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-5-20251101",
      content: [{ type: "text", text: "I found the following files..." }],
      usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }),
];
writeFileSync(
  join(subagentsDir, `${SUB_AGENT_FILE}.jsonl`),
  subAgentLines.join("\n") + "\n",
);

// ─── Import adapter after fixtures are created ───────────────────────────
const { ClaudeCodeAdapter } = await import("../src/adapters/claude-code");

afterAll(() => {
  delete process.env.JIN_CONFIG_DIR;
  // Clean up test fixtures from real homedir
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(tmpConfigDir, { recursive: true, force: true });
});

// Helper: filter sessions to only those from our test project directory
function testSessions(allSessions: { sourcePath: string }[]) {
  return allSessions.filter((s) => s.sourcePath.includes(TEST_PROJECT));
}

// ═════════════════════════════════════════════════════════════════════════
// Claude Code adapter: sub-agent session discovery
// ═════════════════════════════════════════════════════════════════════════

describe("claude-code adapter: sub-agent handling", () => {
  let adapter: InstanceType<typeof ClaudeCodeAdapter>;
  let sessions: Awaited<ReturnType<typeof adapter.sessions>>;

  beforeAll(async () => {
    adapter = new ClaudeCodeAdapter();
    const allSessions = await adapter.sessions();
    sessions = testSessions(allSessions) as typeof allSessions;
  });

  test("discovers both parent and sub-agent sessions", () => {
    expect(sessions.length).toBe(2);
  });

  test("parent session uses sessionId from JSONL", () => {
    const parent = sessions.find((s) => !s.isSubAgent);
    expect(parent).toBeDefined();
    expect(parent!.id).toBe(PARENT_SESSION_ID);
  });

  test("sub-agent session uses filename as ID, not parent sessionId", () => {
    const sub = sessions.find((s) => s.isSubAgent);
    expect(sub).toBeDefined();
    expect(sub!.id).toBe(SUB_AGENT_FILE);
    // Must NOT be the parent's UUID
    expect(sub!.id).not.toBe(PARENT_SESSION_ID);
  });

  test("sub-agent parentSessionId points to parent directory name", () => {
    const sub = sessions.find((s) => s.isSubAgent);
    expect(sub).toBeDefined();
    expect(sub!.parentSessionId).toBe(PARENT_SESSION_ID);
  });

  test("parent session is not marked as sub-agent", () => {
    const parent = sessions.find((s) => s.id === PARENT_SESSION_ID);
    expect(parent).toBeDefined();
    expect(parent!.isSubAgent).toBe(false);
  });

  test("sub-agent session is marked as sub-agent", () => {
    const sub = sessions.find((s) => s.id === SUB_AGENT_FILE);
    expect(sub).toBeDefined();
    expect(sub!.isSubAgent).toBe(true);
  });

  test("sub-agent has correct message count", () => {
    const sub = sessions.find((s) => s.isSubAgent);
    expect(sub!.messageCount).toBe(2);
  });

  test("messages() returns correct messages for sub-agent by sourcePath", async () => {
    const sub = sessions.find((s) => s.isSubAgent)!;
    const messages = await adapter.messages(sub.id, sub.sourcePath);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("explore the codebase");
    expect(messages[1].role).toBe("assistant");
  });

  test("messages() returns correct messages for parent by sourcePath", async () => {
    const parent = sessions.find((s) => !s.isSubAgent)!;
    const messages = await adapter.messages(parent.id, parent.sourcePath);
    expect(messages.length).toBe(2);
    expect(messages[0].content).toContain("build a feature");
  });

  test("findSessionFile resolves agent-* ID via filename match", async () => {
    // Without sourcePath, adapter must find file by scanning directories
    const messages = await adapter.messages(SUB_AGENT_FILE);
    expect(messages.length).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Postgres sink: parent_session_id and session_id upsert
// ═════════════════════════════════════════════════════════════════════════

describe("postgres sink: sub-agent fields in SQL", () => {
  test("INSERT includes parent_session_id column", () => {
    const sinkSource = readFileSync(
      join(import.meta.dir, "../src/sinks/postgres.ts"),
      "utf-8",
    );

    // Session upsert should include parent_session_id in column list
    expect(sinkSource).toContain("parent_session_id");

    // ON CONFLICT for sessions should update parent_session_id
    expect(sinkSource).toContain("parent_session_id=EXCLUDED.parent_session_id");
  });

  test("message upsert updates session_id on conflict", () => {
    const sinkSource = readFileSync(
      join(import.meta.dir, "../src/sinks/postgres.ts"),
      "utf-8",
    );

    // ON CONFLICT for messages should update session_id
    expect(sinkSource).toContain("session_id=EXCLUDED.session_id");
  });

  test("push payload includes parentSessionId for sub-agents", async () => {
    const adapter = new ClaudeCodeAdapter();
    const allSessions = await adapter.sessions();
    const sessions = testSessions(allSessions);
    const sub = sessions.find((s: any) => s.isSubAgent)!;

    expect(sub).toBeDefined();
    expect((sub as any).parentSessionId).toBe(PARENT_SESSION_ID);
    expect((sub as any).parentSessionId).not.toBe("");
    expect((sub as any).parentSessionId).not.toBe((sub as any).id);
  });

  test("session INSERT parameter count matches column count", () => {
    const sinkSource = readFileSync(
      join(import.meta.dir, "../src/sinks/postgres.ts"),
      "utf-8",
    );

    // Extract the session INSERT statement
    const sessionInsertMatch = sinkSource.match(
      /INSERT INTO \$\{this\.sessionsTable\}\s*\n\s*\(([^)]+)\)\s*\n\s*VALUES\s*\(([^)]+)\)/
    );
    expect(sessionInsertMatch).not.toBeNull();

    const columns = sessionInsertMatch![1].split(",").map(s => s.trim()).filter(Boolean);
    const placeholders = sessionInsertMatch![2].split(",").map(s => s.trim()).filter(Boolean);
    expect(columns.length).toBe(placeholders.length);
    expect(columns.length).toBe(19);
  });

  test("message INSERT COLS_PER_ROW matches column count", () => {
    const sinkSource = readFileSync(
      join(import.meta.dir, "../src/sinks/postgres.ts"),
      "utf-8",
    );

    // Verify COLS_PER_ROW matches actual column count in message INSERT
    const colsPerRow = sinkSource.match(/COLS_PER_ROW = (\d+)/);
    expect(colsPerRow).not.toBeNull();

    const msgInsertMatch = sinkSource.match(
      /INSERT INTO \$\{this\.messagesTable\}\s*\n\s*\(([^)]+)\)\s*\n/
    );
    expect(msgInsertMatch).not.toBeNull();

    const msgColumns = msgInsertMatch![1].split(",").map(s => s.trim()).filter(Boolean);
    expect(msgColumns.length).toBe(Number(colsPerRow![1]));
  });
});
