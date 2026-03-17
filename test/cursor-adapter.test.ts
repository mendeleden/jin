/**
 * Tests for the Cursor adapter (new state.vscdb format + legacy fallback).
 *
 * Creates temporary SQLite databases mimicking Cursor's storage layout:
 * - Global state.vscdb with cursorDiskKV table (composerData, bubbles)
 * - Workspace state.vscdb with ItemTable (composer index)
 * - Legacy ~/.cursor/chats/<ws>/<session>/store.db format
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Test fixtures ──────────────────────────────────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), "jin-cursor-test-"));

// Composer IDs
const PARENT_ID = "aaaa1111-bbbb-cccc-dddd-eeeeeeee0001";
const CHILD_1_ID = "aaaa1111-bbbb-cccc-dddd-eeeeeeee0002";
const CHILD_2_ID = "aaaa1111-bbbb-cccc-dddd-eeeeeeee0003";
const STANDALONE_ID = "aaaa1111-bbbb-cccc-dddd-eeeeeeee0004";

// Bubble IDs
const USER_BUBBLE = "bbbb0001-0000-0000-0000-000000000001";
const THINKING_BUBBLE = "bbbb0001-0000-0000-0000-000000000002";
const TEXT_BUBBLE = "bbbb0001-0000-0000-0000-000000000003";
const TOOL_BUBBLE = "bbbb0001-0000-0000-0000-000000000004";
const EMPTY_BUBBLE = "bbbb0001-0000-0000-0000-000000000005";
const CHILD_USER_BUBBLE = "bbbb0002-0000-0000-0000-000000000001";
const CHILD_ASST_BUBBLE = "bbbb0002-0000-0000-0000-000000000002";

const NOW = Date.now();
const HOUR_AGO = NOW - 3600_000;

// ─── Build fake global state.vscdb ──────────────────────────────────────────

const cursorConfigDir = join(tmpDir, "CursorConfig");
const globalDbPath = join(cursorConfigDir, "User", "globalStorage", "state.vscdb");
const wsStorageDir = join(cursorConfigDir, "User", "workspaceStorage");
const ws1Hash = "abcdef1234567890abcdef1234567890";

mkdirSync(join(cursorConfigDir, "User", "globalStorage"), { recursive: true });
mkdirSync(join(wsStorageDir, ws1Hash), { recursive: true });

function buildGlobalDb() {
  const db = new Database(globalDbPath);
  db.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
  db.exec("CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");

  const put = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");

  // Parent composer with 2 subagents
  put.run(`composerData:${PARENT_ID}`, JSON.stringify({
    composerId: PARENT_ID,
    name: "Refactor auth module",
    createdAt: HOUR_AGO,
    status: "completed",
    unifiedMode: "agent",
    isAgentic: true,
    modelConfig: { modelName: "gpt-5.1" },
    fullConversationHeadersOnly: [
      { bubbleId: USER_BUBBLE, type: 1 },
      { bubbleId: THINKING_BUBBLE, type: 2 },
      { bubbleId: TEXT_BUBBLE, type: 2 },
      { bubbleId: TOOL_BUBBLE, type: 2 },
      { bubbleId: EMPTY_BUBBLE, type: 2 },
    ],
    subagentComposerIds: [CHILD_1_ID, CHILD_2_ID],
  }));

  // Child 1
  put.run(`composerData:${CHILD_1_ID}`, JSON.stringify({
    composerId: CHILD_1_ID,
    name: "Analyze database schema",
    createdAt: HOUR_AGO + 1000,
    status: "completed",
    unifiedMode: "chat",
    fullConversationHeadersOnly: [
      { bubbleId: CHILD_USER_BUBBLE, type: 1 },
      { bubbleId: CHILD_ASST_BUBBLE, type: 2 },
    ],
    subagentComposerIds: [],
  }));

  // Child 2 (empty)
  put.run(`composerData:${CHILD_2_ID}`, JSON.stringify({
    composerId: CHILD_2_ID,
    name: "Check API endpoints",
    createdAt: HOUR_AGO + 2000,
    status: "completed",
    unifiedMode: "chat",
    fullConversationHeadersOnly: [],
    subagentComposerIds: [],
  }));

  // Standalone session
  put.run(`composerData:${STANDALONE_ID}`, JSON.stringify({
    composerId: STANDALONE_ID,
    name: "Quick question",
    createdAt: NOW - 60_000,
    status: "completed",
    unifiedMode: "chat",
    fullConversationHeadersOnly: [
      { bubbleId: USER_BUBBLE, type: 1 },
    ],
    subagentComposerIds: [],
  }));

  // ─── Bubbles for parent ───────────────────────────────────────────────

  // User message
  put.run(`bubbleId:${PARENT_ID}:${USER_BUBBLE}`, JSON.stringify({
    _v: 3,
    bubbleId: USER_BUBBLE,
    type: 1,
    text: "Refactor the auth middleware to use JWT",
    createdAt: new Date(HOUR_AGO).toISOString(),
    tokenCount: { inputTokens: 0, outputTokens: 0 },
  }));

  // Thinking bubble (capabilityType 30)
  put.run(`bubbleId:${PARENT_ID}:${THINKING_BUBBLE}`, JSON.stringify({
    _v: 3,
    bubbleId: THINKING_BUBBLE,
    type: 2,
    text: "",
    createdAt: new Date(HOUR_AGO + 1000).toISOString(),
    capabilityType: 30,
    thinking: { text: "I need to analyze the current auth middleware structure", signature: "" },
    thinkingDurationMs: 500,
    tokenCount: { inputTokens: 100, outputTokens: 50 },
  }));

  // Text response
  put.run(`bubbleId:${PARENT_ID}:${TEXT_BUBBLE}`, JSON.stringify({
    _v: 3,
    bubbleId: TEXT_BUBBLE,
    type: 2,
    text: "I'll refactor the auth middleware to use JWT tokens instead of session cookies.",
    createdAt: new Date(HOUR_AGO + 2000).toISOString(),
    tokenCount: { inputTokens: 200, outputTokens: 150 },
    modelInfo: { modelName: "gpt-5.1" },
  }));

  // Tool use bubble (capabilityType 15)
  put.run(`bubbleId:${PARENT_ID}:${TOOL_BUBBLE}`, JSON.stringify({
    _v: 3,
    bubbleId: TOOL_BUBBLE,
    type: 2,
    text: "",
    createdAt: new Date(HOUR_AGO + 3000).toISOString(),
    capabilityType: 15,
    toolFormerData: {
      name: "read_file_v2",
      status: "completed",
      toolCallId: "call_abc123",
      additionalData: { path: "/src/auth/middleware.ts" },
    },
    tokenCount: { inputTokens: 0, outputTokens: 0 },
  }));

  // Empty placeholder bubble (should be skipped)
  put.run(`bubbleId:${PARENT_ID}:${EMPTY_BUBBLE}`, JSON.stringify({
    _v: 3,
    bubbleId: EMPTY_BUBBLE,
    type: 2,
    text: "",
    createdAt: new Date(HOUR_AGO + 4000).toISOString(),
    tokenCount: { inputTokens: 0, outputTokens: 0 },
  }));

  // ─── Bubbles for child 1 ──────────────────────────────────────────────

  put.run(`bubbleId:${CHILD_1_ID}:${CHILD_USER_BUBBLE}`, JSON.stringify({
    _v: 3,
    bubbleId: CHILD_USER_BUBBLE,
    type: 1,
    text: "Analyze the database schema for auth tables",
    createdAt: new Date(HOUR_AGO + 5000).toISOString(),
    tokenCount: { inputTokens: 0, outputTokens: 0 },
  }));

  put.run(`bubbleId:${CHILD_1_ID}:${CHILD_ASST_BUBBLE}`, JSON.stringify({
    _v: 3,
    bubbleId: CHILD_ASST_BUBBLE,
    type: 2,
    text: "The auth schema has three tables: users, sessions, and tokens.",
    createdAt: new Date(HOUR_AGO + 6000).toISOString(),
    tokenCount: { inputTokens: 300, outputTokens: 200 },
    modelInfo: { modelName: "gpt-5.1" },
  }));

  db.close();
}

// ─── Build fake workspace state.vscdb ───────────────────────────────────────

function buildWorkspaceDb() {
  const wsDbPath = join(wsStorageDir, ws1Hash, "state.vscdb");
  const db = new Database(wsDbPath);
  db.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
  db.exec("CREATE TABLE IF NOT EXISTS cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");

  db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
    "composer.composerData",
    JSON.stringify({
      allComposers: [
        {
          type: "head",
          composerId: PARENT_ID,
          name: "Refactor auth module",
          lastUpdatedAt: NOW,
          createdAt: HOUR_AGO,
          unifiedMode: "agent",
          forceMode: "edit",
          totalLinesAdded: 120,
          totalLinesRemoved: 45,
          filesChangedCount: 3,
          subtitle: "Edited middleware.ts, jwt.ts, auth.test.ts",
          numSubComposers: 2,
        },
        {
          type: "head",
          composerId: CHILD_1_ID,
          name: "Analyze database schema",
          lastUpdatedAt: HOUR_AGO + 10000,
          createdAt: HOUR_AGO + 1000,
          unifiedMode: "chat",
        },
        {
          type: "head",
          composerId: CHILD_2_ID,
          name: "Check API endpoints",
          lastUpdatedAt: HOUR_AGO + 15000,
          createdAt: HOUR_AGO + 2000,
          unifiedMode: "chat",
        },
        {
          type: "head",
          composerId: STANDALONE_ID,
          name: "Quick question",
          lastUpdatedAt: NOW - 60_000,
          createdAt: NOW - 60_000,
          unifiedMode: "chat",
        },
      ],
    }),
  );

  db.close();

  // workspace.json
  writeFileSync(
    join(wsStorageDir, ws1Hash, "workspace.json"),
    JSON.stringify({ folder: "file:///home/dev/projects/myapp" }),
  );
}

// ─── Build legacy format ────────────────────────────────────────────────────

const LEGACY_SESSION_ID = "legacy-sess-0001";
const legacyChatsDir = join(tmpDir, "legacy-chats");

function buildLegacyDb() {
  const sessDir = join(legacyChatsDir, "workspace1", LEGACY_SESSION_ID);
  mkdirSync(sessDir, { recursive: true });
  const dbPath = join(sessDir, "store.db");

  const db = new Database(dbPath);
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.exec("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");

  const meta = {
    agentId: LEGACY_SESSION_ID,
    name: "Legacy session",
    createdAt: HOUR_AGO,
    latestRootBlobId: "blob-2",
  };
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
    "0",
    Buffer.from(JSON.stringify(meta)).toString("hex"),
  );

  // Blob tree: blob-1 (user) ← blob-2 (assistant)
  db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)").run(
    "blob-1",
    Buffer.from(JSON.stringify({
      role: "user",
      content: "Hello from the legacy format",
    })),
  );
  db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)").run(
    "blob-2",
    Buffer.from(JSON.stringify({
      parentId: "blob-1",
      role: "assistant",
      content: "Hello! I'm responding in legacy format.",
      model: "gpt-4",
    })),
  );

  db.close();
}

// ─── Build all fixtures ─────────────────────────────────────────────────────

buildGlobalDb();
buildWorkspaceDb();
buildLegacyDb();

// ─── Import adapter with path overrides ─────────────────────────────────────
// We need to override the paths the adapter uses. The simplest way is to
// construct the adapter and patch its private fields.

const { CursorAdapter } = await import("../src/adapters/cursor");

function createTestAdapter() {
  const adapter = new CursorAdapter();
  // Override private paths to point at our fixtures
  (adapter as any).configDir = cursorConfigDir;
  (adapter as any).globalDbPath = globalDbPath;
  (adapter as any).workspaceStorageDir = wsStorageDir;
  (adapter as any).legacyDir = legacyChatsDir;
  return adapter;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Cursor adapter: vscdb format", () => {
  test("detect() returns true when state.vscdb exists with cursorDiskKV", async () => {
    const adapter = createTestAdapter();
    expect(await adapter.detect()).toBe(true);
  });

  test("detect() returns true for legacy-only setup", async () => {
    const adapter = createTestAdapter();
    (adapter as any).globalDbPath = "/nonexistent/state.vscdb";
    expect(await adapter.detect()).toBe(true);
  });

  test("detect() returns false when nothing exists", async () => {
    const adapter = createTestAdapter();
    (adapter as any).globalDbPath = "/nonexistent/state.vscdb";
    (adapter as any).legacyDir = "/nonexistent/chats";
    expect(await adapter.detect()).toBe(false);
  });

  test("sessions() returns all composers from workspace index", async () => {
    const adapter = createTestAdapter();
    const sessions = await adapter.sessions();
    // 4 vscdb + 1 legacy = 5
    expect(sessions.length).toBe(5);
  });

  test("sessions() have correct metadata", async () => {
    const adapter = createTestAdapter();
    const sessions = await adapter.sessions();
    const parent = sessions.find(s => s.id === PARENT_ID);
    expect(parent).toBeDefined();
    expect(parent!.name).toBe("Refactor auth module");
    expect(parent!.adapterId).toBe("cursor");
    expect(parent!.messageCount).toBe(5);
    expect(parent!.metadata.workspace).toBe("/home/dev/projects/myapp");
    expect(parent!.metadata.unifiedMode).toBe("agent");
    expect(parent!.metadata.linesAdded).toBe(120);
    expect(parent!.metadata.linesRemoved).toBe(45);
  });

  test("sessions() correctly links subagents to parent", async () => {
    const adapter = createTestAdapter();
    const sessions = await adapter.sessions();

    const parent = sessions.find(s => s.id === PARENT_ID)!;
    const child1 = sessions.find(s => s.id === CHILD_1_ID)!;
    const child2 = sessions.find(s => s.id === CHILD_2_ID)!;
    const standalone = sessions.find(s => s.id === STANDALONE_ID)!;

    expect(parent.isSubAgent).toBe(false);
    expect(parent.parentSessionId).toBe("");

    expect(child1.isSubAgent).toBe(true);
    expect(child1.parentSessionId).toBe(PARENT_ID);

    expect(child2.isSubAgent).toBe(true);
    expect(child2.parentSessionId).toBe(PARENT_ID);

    expect(standalone.isSubAgent).toBe(false);
    expect(standalone.parentSessionId).toBe("");
  });

  test("sessions() handles undefined lastUpdatedAt gracefully", async () => {
    // Patch a workspace entry with missing lastUpdatedAt
    const wsDbPath = join(wsStorageDir, ws1Hash, "state.vscdb");
    const db = new Database(wsDbPath);
    const existing = JSON.parse(
      (db.prepare("SELECT value FROM ItemTable WHERE key = ?").get("composer.composerData") as any).value,
    );
    existing.allComposers.push({
      type: "head",
      composerId: "no-update-ts-0000-0000-000000000000",
      name: "No updatedAt",
      createdAt: HOUR_AGO,
      // lastUpdatedAt intentionally omitted
      unifiedMode: "chat",
    });
    db.prepare("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)").run(
      "composer.composerData",
      JSON.stringify(existing),
    );
    db.close();

    const adapter = createTestAdapter();
    const sessions = await adapter.sessions();
    const noUpdate = sessions.find(s => s.id === "no-update-ts-0000-0000-000000000000");
    expect(noUpdate).toBeDefined();
    expect(noUpdate!.updatedAt).toBeTruthy();
    expect(() => new Date(noUpdate!.updatedAt)).not.toThrow();
  });

  test("sessions() sorted by updatedAt descending", async () => {
    const adapter = createTestAdapter();
    const sessions = await adapter.sessions();
    for (let i = 1; i < sessions.length; i++) {
      expect(new Date(sessions[i - 1].updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(sessions[i].updatedAt).getTime(),
      );
    }
  });
});

describe("Cursor adapter: messages (vscdb)", () => {
  test("messages() returns ordered bubbles for a session", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages(PARENT_ID);
    // 5 bubbles but empty one is skipped
    expect(msgs.length).toBe(4);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[3].role).toBe("assistant");
  });

  test("user message has correct content and timestamp", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages(PARENT_ID);
    const user = msgs[0];
    expect(user.content).toBe("Refactor the auth middleware to use JWT");
    expect(user.role).toBe("user");
    expect(user.timestamp).toBeTruthy();
    expect(new Date(user.timestamp).getTime()).toBeGreaterThan(0);
  });

  test("thinking bubble produces thinkingBlocks", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages(PARENT_ID);
    const thinking = msgs[1];
    expect(thinking.thinkingBlocks.length).toBe(1);
    expect(thinking.thinkingBlocks[0].content).toBe(
      "I need to analyze the current auth middleware structure",
    );
    expect(thinking.content).toBe("");
  });

  test("text response has content and model", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages(PARENT_ID);
    const text = msgs[2];
    expect(text.content).toContain("JWT tokens");
    expect(text.model).toBe("gpt-5.1");
    expect(text.inputTokens).toBe(200);
    expect(text.outputTokens).toBe(150);
  });

  test("tool bubble produces toolUses", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages(PARENT_ID);
    const tool = msgs[3];
    expect(tool.toolUses.length).toBe(1);
    expect(tool.toolUses[0].name).toBe("read_file_v2");
    expect(tool.toolUses[0].id).toBe("call_abc123");
    expect(tool.toolUses[0].input).toContain("middleware.ts");
    expect(tool.content).toBe("");
  });

  test("empty placeholder bubbles are skipped", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages(PARENT_ID);
    const emptyBubble = msgs.find(m => m.id === EMPTY_BUBBLE);
    expect(emptyBubble).toBeUndefined();
  });

  test("child session messages are independent", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages(CHILD_1_ID);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("database schema");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toContain("three tables");
    expect(msgs[1].model).toBe("gpt-5.1");
  });

  test("messages() returns empty for session with no bubbles", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages(CHILD_2_ID);
    expect(msgs.length).toBe(0);
  });

  test("messages() returns empty for nonexistent session", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages("nonexistent-id");
    expect(msgs.length).toBe(0);
  });
});

describe("Cursor adapter: legacy format", () => {
  test("legacy sessions are included", async () => {
    const adapter = createTestAdapter();
    const sessions = await adapter.sessions();
    const legacy = sessions.find(s => s.id === LEGACY_SESSION_ID);
    expect(legacy).toBeDefined();
    expect(legacy!.name).toBe("Legacy session");
    expect(legacy!.adapterId).toBe("cursor");
  });

  test("legacy messages use blob tree traversal", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages(LEGACY_SESSION_ID);
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Hello from the legacy format");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toContain("legacy format");
    expect(msgs[1].model).toBe("gpt-4");
  });

  test("legacy messages have interpolated timestamps", async () => {
    const adapter = createTestAdapter();
    const msgs = await adapter.messages(LEGACY_SESSION_ID);
    expect(msgs[0].timestamp).toBeTruthy();
    expect(msgs[1].timestamp).toBeTruthy();
    // Second message timestamp should be >= first
    expect(new Date(msgs[1].timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(msgs[0].timestamp).getTime(),
    );
  });
});

describe("Cursor adapter: watchPaths", () => {
  test("returns global db path when it exists", () => {
    const adapter = createTestAdapter();
    const paths = adapter.watchPaths();
    expect(paths).toContain(globalDbPath);
  });

  test("returns legacy dir when it exists", () => {
    const adapter = createTestAdapter();
    const paths = adapter.watchPaths();
    expect(paths).toContain(legacyChatsDir);
  });
});

// ─── Cleanup ────────────────────────────────────────────────────────────────

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
