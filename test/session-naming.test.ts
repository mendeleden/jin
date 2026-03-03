/**
 * Tests for session naming in the claude-code adapter.
 *
 * Covers:
 * - Normal sessions use the first user message as the name
 * - Resumed sessions skip "[Request interrupted..." and use the next real prompt
 * - Custom titles (set via /rename) take highest priority
 * - Auto-generated summaries (from compaction) take priority over firstPrompt
 * - XML tags in messages are stripped from session names
 * - Names are truncated to 120 characters
 * - Fallback to slug, then sessionId when no user message exists
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ─── Config setup ────────────────────────────────────────────────────────
const tmpConfigDir = join(homedir(), ".config", "jin-test-session-naming");
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

// ─── Helpers ─────────────────────────────────────────────────────────────
const TEST_PROJECT = "jin-session-naming-test";
const projectDir = join(homedir(), ".config", "claude", "projects", TEST_PROJECT);
mkdirSync(projectDir, { recursive: true });

let sessionCounter = 0;

function makeSessionId(): string {
  sessionCounter++;
  const hex = sessionCounter.toString(16).padStart(8, "0");
  return `${hex}-0000-0000-0000-000000000000`;
}

function writeSession(sessionId: string, lines: Record<string, unknown>[]): void {
  const jsonl = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), jsonl);
}

function userMsg(sessionId: string, content: string | unknown[], ts = "2026-03-01T10:00:00Z") {
  return {
    type: "user",
    sessionId,
    uuid: `uuid-${Math.random().toString(36).slice(2)}`,
    cwd: "/tmp/test",
    timestamp: ts,
    message: { role: "user", content },
  };
}

function assistantMsg(sessionId: string, text: string, ts = "2026-03-01T10:00:05Z") {
  return {
    type: "assistant",
    sessionId,
    uuid: `uuid-${Math.random().toString(36).slice(2)}`,
    timestamp: ts,
    message: {
      role: "assistant",
      model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  };
}

// ─── Create fixture sessions ─────────────────────────────────────────────

// 1. Normal session — first user message becomes the name
const normalId = makeSessionId();
writeSession(normalId, [
  userMsg(normalId, "Fix the login page redirect bug"),
  assistantMsg(normalId, "I'll look into that."),
]);

// 2. Resumed session — first msg is "[Request interrupted...", second is the real prompt
const resumedId = makeSessionId();
writeSession(resumedId, [
  userMsg(resumedId, "[Request interrupted by user for tool use]"),
  userMsg(resumedId, "Add dark mode support to the dashboard", "2026-03-01T10:01:00Z"),
  assistantMsg(resumedId, "I'll implement dark mode.", "2026-03-01T10:01:05Z"),
]);

// 3. Session with customTitle (set via /rename)
const renamedId = makeSessionId();
writeSession(renamedId, [
  userMsg(renamedId, "Refactor the auth module to use JWT"),
  assistantMsg(renamedId, "Starting refactor."),
  { type: "custom-title", customTitle: "Auth JWT Refactor", sessionId: renamedId, uuid: "uuid-ct", timestamp: "2026-03-01T10:02:00Z" },
]);

// 4. Session with summary (auto-generated during compaction)
const compactedId = makeSessionId();
writeSession(compactedId, [
  userMsg(compactedId, "We need to implement a webhook system for real-time notifications"),
  assistantMsg(compactedId, "I'll design the webhook architecture."),
  { type: "summary", summary: "Implement webhook notification system", sessionId: compactedId, uuid: "uuid-sum", timestamp: "2026-03-01T10:03:00Z" },
  { type: "system", subtype: "compact_boundary", content: "Conversation compacted", sessionId: compactedId, uuid: "uuid-cb", timestamp: "2026-03-01T10:03:01Z" },
]);

// 5. customTitle beats summary — both present
const bothId = makeSessionId();
writeSession(bothId, [
  userMsg(bothId, "Help me with the database migration"),
  assistantMsg(bothId, "Sure."),
  { type: "summary", summary: "Database migration assistance", sessionId: bothId, uuid: "uuid-sum2", timestamp: "2026-03-01T10:04:00Z" },
  { type: "custom-title", customTitle: "DB Migration v2", sessionId: bothId, uuid: "uuid-ct2", timestamp: "2026-03-01T10:04:01Z" },
]);

// 6. XML tags in user message should be stripped
const xmlId = makeSessionId();
writeSession(xmlId, [
  userMsg(xmlId, '<system-reminder>context here</system-reminder>Implement the new API endpoint'),
  assistantMsg(xmlId, "Working on it."),
]);

// 7. Content blocks (array format) — uses first text block
const blocksId = makeSessionId();
writeSession(blocksId, [
  userMsg(blocksId, [
    { type: "text", text: "Deploy the staging environment" },
  ]),
  assistantMsg(blocksId, "Deploying now."),
]);

// 8. Long message is truncated to 120 chars
const longId = makeSessionId();
const longMessage = "A".repeat(200);
writeSession(longId, [
  userMsg(longId, longMessage),
  assistantMsg(longId, "Got it."),
]);

// 9. Only "[Request interrupted" messages — falls back to slug
const interruptOnlyId = makeSessionId();
writeSession(interruptOnlyId, [
  {
    type: "user",
    sessionId: interruptOnlyId,
    uuid: "uuid-io1",
    cwd: "/tmp/test",
    slug: "fuzzy-green-llama",
    timestamp: "2026-03-01T10:06:00Z",
    message: { role: "user", content: "[Request interrupted by user for tool use]" },
  },
  assistantMsg(interruptOnlyId, "Resumed.", "2026-03-01T10:06:05Z"),
]);

// 10. Summary with "No prompt" is ignored (matches Claude Code behavior)
const noPromptId = makeSessionId();
writeSession(noPromptId, [
  userMsg(noPromptId, "Check disk usage"),
  assistantMsg(noPromptId, "Here's the usage."),
  { type: "summary", summary: "No prompt", sessionId: noPromptId, uuid: "uuid-np", timestamp: "2026-03-01T10:07:00Z" },
]);

// 11. Newlines in user message are replaced with spaces
const newlineId = makeSessionId();
writeSession(newlineId, [
  userMsg(newlineId, "Fix the bug in\nthe login\npage"),
  assistantMsg(newlineId, "On it."),
]);

// 12. Multiple [Request interrupted] messages before real prompt
const multiResumeId = makeSessionId();
writeSession(multiResumeId, [
  userMsg(multiResumeId, "[Request interrupted by user for tool use]"),
  userMsg(multiResumeId, "[Request interrupted by user]", "2026-03-01T10:08:30Z"),
  userMsg(multiResumeId, "Optimize the database queries", "2026-03-01T10:09:00Z"),
  assistantMsg(multiResumeId, "I'll optimize.", "2026-03-01T10:09:05Z"),
]);

// ─── Import adapter after fixtures are created ───────────────────────────
const { ClaudeCodeAdapter } = await import("../src/adapters/claude-code");

afterAll(() => {
  delete process.env.JIN_CONFIG_DIR;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(tmpConfigDir, { recursive: true, force: true });
});

// Helper: filter sessions to only those from our test project
function findSession(sessions: { id: string }[], id: string) {
  return sessions.find((s) => s.id === id);
}

// ═════════════════════════════════════════════════════════════════════════
// Session naming tests
// ═════════════════════════════════════════════════════════════════════════

describe("claude-code adapter: session naming", () => {
  let sessions: { id: string; name: string; isCompacted: boolean }[];

  beforeAll(async () => {
    const adapter = new ClaudeCodeAdapter();
    const all = await adapter.sessions();
    sessions = all.filter((s: any) => s.sourcePath.includes(TEST_PROJECT)) as any;
  });

  test("normal session uses first user message as name", () => {
    const s = findSession(sessions, normalId);
    expect(s).toBeDefined();
    expect(s!.name).toBe("Fix the login page redirect bug");
  });

  test("resumed session skips [Request interrupted] and uses real prompt", () => {
    const s = findSession(sessions, resumedId);
    expect(s).toBeDefined();
    expect(s!.name).toBe("Add dark mode support to the dashboard");
    expect(s!.name).not.toContain("Request interrupted");
  });

  test("customTitle takes highest priority", () => {
    const s = findSession(sessions, renamedId);
    expect(s).toBeDefined();
    expect(s!.name).toBe("Auth JWT Refactor");
  });

  test("summary takes priority over first user message", () => {
    const s = findSession(sessions, compactedId);
    expect(s).toBeDefined();
    expect(s!.name).toBe("Implement webhook notification system");
  });

  test("customTitle beats summary when both present", () => {
    const s = findSession(sessions, bothId);
    expect(s).toBeDefined();
    expect(s!.name).toBe("DB Migration v2");
  });

  test("XML tags are stripped from session name", () => {
    const s = findSession(sessions, xmlId);
    expect(s).toBeDefined();
    // Tags are removed but inner text of non-Claude-Code tags stays
    expect(s!.name).not.toContain("<");
    expect(s!.name).not.toContain("system-reminder");
    expect(s!.name).toContain("Implement the new API endpoint");
  });

  test("content block array uses first text block for name", () => {
    const s = findSession(sessions, blocksId);
    expect(s).toBeDefined();
    expect(s!.name).toBe("Deploy the staging environment");
  });

  test("long messages are truncated to 120 chars", () => {
    const s = findSession(sessions, longId);
    expect(s).toBeDefined();
    // Content is sliced to 120 in parseSessionMeta, then truncated to 117+... if still >120
    expect(s!.name.length).toBeLessThanOrEqual(120);
  });

  test("falls back to slug when only [Request interrupted] messages", () => {
    const s = findSession(sessions, interruptOnlyId);
    expect(s).toBeDefined();
    expect(s!.name).toBe("fuzzy-green-llama");
  });

  test('summary "No prompt" is ignored, falls back to first user message', () => {
    const s = findSession(sessions, noPromptId);
    expect(s).toBeDefined();
    expect(s!.name).toBe("Check disk usage");
    expect(s!.name).not.toBe("No prompt");
  });

  test("newlines in user message are replaced with spaces", () => {
    const s = findSession(sessions, newlineId);
    expect(s).toBeDefined();
    expect(s!.name).toBe("Fix the bug in the login page");
    expect(s!.name).not.toContain("\n");
  });

  test("multiple [Request interrupted] messages are all skipped", () => {
    const s = findSession(sessions, multiResumeId);
    expect(s).toBeDefined();
    expect(s!.name).toBe("Optimize the database queries");
  });

  test("compacted session is detected", () => {
    const s = findSession(sessions, compactedId);
    expect(s).toBeDefined();
    expect(s!.isCompacted).toBe(true);
  });
});
