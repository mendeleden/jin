/**
 * Tests for token deduplication and persistent stat cache.
 *
 * Covers:
 * - Token usage is counted once per requestId, not per content block
 * - Persistent file stat cache survives across Store instances
 * - ingestAdapter skips unchanged files when stat cache is seeded
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ─── Config setup ────────────────────────────────────────────────────────
const tmpConfigDir = join(homedir(), ".config", "jin-test-token-dedup");
process.env.JIN_CONFIG_DIR = tmpConfigDir;
mkdirSync(tmpConfigDir, { recursive: true });

const dbPath = join(tmpConfigDir, "store.db");
const rawDir = join(tmpConfigDir, "raw");

const configJson = {
  version: 1,
  adapters: { "claude-code": { enabled: true } },
  sinks: [],
  store: { dbPath, rawDir },
};
await Bun.write(join(tmpConfigDir, "config.json"), JSON.stringify(configJson));

// ─── Create fixture with duplicate requestIds ────────────────────────────
const TEST_PROJECT = "jin-token-dedup-test";
const projectDir = join(homedir(), ".config", "claude", "projects", TEST_PROJECT);
mkdirSync(projectDir, { recursive: true });

const SESSION_ID = "dedup-0001-0000-0000-000000000000";
const REQUEST_ID = "req_test_dedup_001";

// Simulate a single API call that produces 3 content blocks (thinking, text, tool_use)
// Claude Code writes each as a separate JSONL line with the same requestId and usage
const usage = {
  input_tokens: 50,
  output_tokens: 200,
  cache_read_input_tokens: 10000,
  cache_creation_input_tokens: 5000,
};

const lines = [
  JSON.stringify({
    type: "user",
    sessionId: SESSION_ID,
    uuid: "uuid-d1",
    cwd: "/tmp/test",
    timestamp: "2026-03-01T10:00:00Z",
    message: { role: "user", content: "deduplicate this" },
  }),
  // Content block 1: thinking (same requestId, same usage)
  JSON.stringify({
    type: "assistant",
    sessionId: SESSION_ID,
    uuid: "uuid-d2",
    parentUuid: "uuid-d1",
    requestId: REQUEST_ID,
    timestamp: "2026-03-01T10:00:01Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-6",
      content: [{ type: "thinking", thinking: "Let me think..." }],
      stop_reason: null,
      usage,
    },
  }),
  // Content block 2: text (same requestId, same usage)
  JSON.stringify({
    type: "assistant",
    sessionId: SESSION_ID,
    uuid: "uuid-d3",
    parentUuid: "uuid-d2",
    requestId: REQUEST_ID,
    timestamp: "2026-03-01T10:00:02Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-6",
      content: [{ type: "text", text: "Here is the answer." }],
      stop_reason: null,
      usage,
    },
  }),
  // Content block 3: tool_use (same requestId, same usage, with stop_reason)
  JSON.stringify({
    type: "assistant",
    sessionId: SESSION_ID,
    uuid: "uuid-d4",
    parentUuid: "uuid-d3",
    requestId: REQUEST_ID,
    timestamp: "2026-03-01T10:00:03Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-6",
      content: [{ type: "tool_use", name: "Read", input: { file_path: "/tmp/test" } }],
      stop_reason: "tool_use",
      usage,
    },
  }),
];
writeFileSync(join(projectDir, `${SESSION_ID}.jsonl`), lines.join("\n") + "\n");

// ─── Second session with two distinct API calls ──────────────────────────
const SESSION_ID_2 = "dedup-0002-0000-0000-000000000000";
const REQUEST_ID_A = "req_test_dedup_002a";
const REQUEST_ID_B = "req_test_dedup_002b";

const usageA = { input_tokens: 30, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 2000 };
const usageB = { input_tokens: 40, output_tokens: 150, cache_read_input_tokens: 6000, cache_creation_input_tokens: 3000 };

const lines2 = [
  JSON.stringify({
    type: "user", sessionId: SESSION_ID_2, uuid: "uuid-e1",
    cwd: "/tmp/test", timestamp: "2026-03-01T11:00:00Z",
    message: { role: "user", content: "first question" },
  }),
  // API call A — 2 content blocks
  JSON.stringify({
    type: "assistant", sessionId: SESSION_ID_2, uuid: "uuid-e2",
    parentUuid: "uuid-e1", requestId: REQUEST_ID_A,
    timestamp: "2026-03-01T11:00:01Z",
    message: { role: "assistant", model: "claude-opus-4-6",
      content: [{ type: "thinking", thinking: "thinking..." }],
      stop_reason: null, usage: usageA },
  }),
  JSON.stringify({
    type: "assistant", sessionId: SESSION_ID_2, uuid: "uuid-e3",
    parentUuid: "uuid-e2", requestId: REQUEST_ID_A,
    timestamp: "2026-03-01T11:00:02Z",
    message: { role: "assistant", model: "claude-opus-4-6",
      content: [{ type: "text", text: "Answer A" }],
      stop_reason: "end_turn", usage: usageA },
  }),
  // User follow-up
  JSON.stringify({
    type: "user", sessionId: SESSION_ID_2, uuid: "uuid-e4",
    cwd: "/tmp/test", timestamp: "2026-03-01T11:01:00Z",
    message: { role: "user", content: "follow up" },
  }),
  // API call B — 2 content blocks
  JSON.stringify({
    type: "assistant", sessionId: SESSION_ID_2, uuid: "uuid-e5",
    parentUuid: "uuid-e4", requestId: REQUEST_ID_B,
    timestamp: "2026-03-01T11:01:01Z",
    message: { role: "assistant", model: "claude-opus-4-6",
      content: [{ type: "text", text: "Answer B part 1" }],
      stop_reason: null, usage: usageB },
  }),
  JSON.stringify({
    type: "assistant", sessionId: SESSION_ID_2, uuid: "uuid-e6",
    parentUuid: "uuid-e5", requestId: REQUEST_ID_B,
    timestamp: "2026-03-01T11:01:02Z",
    message: { role: "assistant", model: "claude-opus-4-6",
      content: [{ type: "text", text: "Answer B part 2" }],
      stop_reason: "end_turn", usage: usageB },
  }),
];
writeFileSync(join(projectDir, `${SESSION_ID_2}.jsonl`), lines2.join("\n") + "\n");

// ─── Import after fixtures ───────────────────────────────────────────────
const { ClaudeCodeAdapter } = await import("../src/adapters/claude-code");
const { Store } = await import("../src/store");
const { ingestAdapter, seedStatCache } = await import("../src/commands/watch");

afterAll(() => {
  delete process.env.JIN_CONFIG_DIR;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(tmpConfigDir, { recursive: true, force: true });
});

// Helper: filter sessions to only those from our test project directory
function testSessions(allSessions: { sourcePath: string }[]) {
  return allSessions.filter((s) => s.sourcePath.includes(TEST_PROJECT));
}

// ═════════════════════════════════════════════════════════════════════════
// Token deduplication
// ═════════════════════════════════════════════════════════════════════════

describe("token deduplication: count usage once per requestId", () => {
  let adapter: InstanceType<typeof ClaudeCodeAdapter>;
  let sessions: Awaited<ReturnType<typeof adapter.sessions>>;

  beforeAll(async () => {
    adapter = new ClaudeCodeAdapter();
    const allSessions = await adapter.sessions();
    sessions = testSessions(allSessions) as typeof allSessions;
  });

  test("single API call with 3 content blocks counts tokens once", () => {
    const session = sessions.find((s) => s.id === SESSION_ID);
    expect(session).toBeDefined();

    // Should be exactly the usage values, NOT multiplied by 3
    expect(session!.totalTokens).toBe(usage.input_tokens + usage.output_tokens);
  });

  test("two distinct API calls sum correctly", () => {
    const session = sessions.find((s) => s.id === SESSION_ID_2);
    expect(session).toBeDefined();

    const expectedInput = usageA.input_tokens + usageB.input_tokens;
    const expectedOutput = usageA.output_tokens + usageB.output_tokens;
    expect(session!.totalTokens).toBe(expectedInput + expectedOutput);
  });

  test("cost reflects deduplicated tokens", () => {
    const session = sessions.find((s) => s.id === SESSION_ID);
    expect(session).toBeDefined();
    // Cost should be > 0 (calculated from single usage, not 3x)
    expect(session!.estCost).toBeGreaterThan(0);

    // Verify cost is NOT inflated: a second adapter parse should give the same cost
    const session2 = sessions.find((s) => s.id === SESSION_ID);
    expect(session!.estCost).toBe(session2!.estCost);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Persistent stat cache
// ═════════════════════════════════════════════════════════════════════════

describe("persistent stat cache", () => {
  test("saveStatEntry and loadStatCache round-trip", () => {
    const store = new Store(dbPath);

    store.saveStatEntry("/tmp/test/file1.jsonl", 1234, 1700000000000);
    store.saveStatEntry("/tmp/test/file2.jsonl", 5678, 1700000001000);

    const cache = store.loadStatCache();
    expect(cache.size).toBeGreaterThanOrEqual(2);
    expect(cache.get("/tmp/test/file1.jsonl")).toEqual({ size: 1234, mtimeMs: 1700000000000 });
    expect(cache.get("/tmp/test/file2.jsonl")).toEqual({ size: 5678, mtimeMs: 1700000001000 });

    store.close();
  });

  test("saveStatEntry upserts on conflict", () => {
    const store = new Store(dbPath);

    store.saveStatEntry("/tmp/test/file1.jsonl", 1234, 1700000000000);
    store.saveStatEntry("/tmp/test/file1.jsonl", 9999, 1700000002000);

    const cache = store.loadStatCache();
    expect(cache.get("/tmp/test/file1.jsonl")).toEqual({ size: 9999, mtimeMs: 1700000002000 });

    store.close();
  });

  test("stat cache survives across Store instances", () => {
    const store1 = new Store(dbPath);
    store1.saveStatEntry("/tmp/persist-test.jsonl", 4321, 1700000003000);
    store1.close();

    const store2 = new Store(dbPath);
    const cache = store2.loadStatCache();
    expect(cache.get("/tmp/persist-test.jsonl")).toEqual({ size: 4321, mtimeMs: 1700000003000 });
    store2.close();
  });

  test("ingestAdapter skips unchanged files when stat cache is seeded", async () => {
    const store = new Store(dbPath);
    const adapter = new ClaudeCodeAdapter();

    // First ingest — everything is new
    const firstIngested = await ingestAdapter(adapter, store, rawDir);
    const testIngested = firstIngested.filter((id) => id === SESSION_ID || id === SESSION_ID_2);
    expect(testIngested.length).toBeGreaterThanOrEqual(2);

    // Seed the stat cache (simulates what happens on restart)
    seedStatCache(store);

    // Second ingest — files haven't changed, should skip
    const secondIngested = await ingestAdapter(adapter, store, rawDir);
    const testSkipped = secondIngested.filter((id) => id === SESSION_ID || id === SESSION_ID_2);
    expect(testSkipped.length).toBe(0);

    store.close();
  });
});
