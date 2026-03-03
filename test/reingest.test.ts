/**
 * Tests for the `jin reingest` command.
 *
 * Covers:
 * - Re-ingests sessions from adapters into the local store
 * - Updates session metadata (e.g. names) when source files haven't changed
 * - Respects --adapter filter
 * - Stores messages and artifacts
 * - Refreshes project stats after re-ingest
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ─── Config setup ────────────────────────────────────────────────────────
const tmpConfigDir = join(homedir(), ".config", "jin-test-reingest");
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

// ─── Create fixture sessions ─────────────────────────────────────────────
const TEST_PROJECT = "jin-reingest-test";
const projectDir = join(homedir(), ".config", "claude", "projects", TEST_PROJECT);
mkdirSync(projectDir, { recursive: true });

const SESSION_ID = "reingest-0001-0000-0000-000000000000";

function writeFixture(userMessage: string): void {
  const lines = [
    JSON.stringify({
      type: "user",
      sessionId: SESSION_ID,
      uuid: "uuid-r1",
      cwd: "/tmp/test",
      timestamp: "2026-03-01T10:00:00Z",
      message: { role: "user", content: userMessage },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: SESSION_ID,
      uuid: "uuid-r2",
      parentUuid: "uuid-r1",
      timestamp: "2026-03-01T10:00:05Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "Done." }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }),
  ];
  writeFileSync(join(projectDir, `${SESSION_ID}.jsonl`), lines.join("\n") + "\n");
}

// Start with original message
writeFixture("Original task description");

// ─── Import after fixtures ───────────────────────────────────────────────
const { reingestCommand } = await import("../src/commands/reingest");
const { Store } = await import("../src/store");

afterAll(() => {
  delete process.env.JIN_CONFIG_DIR;
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(tmpConfigDir, { recursive: true, force: true });
});

describe("jin reingest command", () => {
  test("ingests sessions into the store", async () => {
    // Capture console output
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    await reingestCommand({});

    console.log = origLog;

    // Should report ingested sessions
    const doneLine = logs.find((l) => l.includes("Done."));
    expect(doneLine).toBeDefined();
    expect(doneLine).toContain("sessions");
    expect(doneLine).toContain("messages");

    // Verify in store
    const store = new Store(dbPath);
    const session = store.getSession(SESSION_ID);
    expect(session).toBeDefined();
    expect(session!.name).toBe("Original task description");

    const messages = store.getMessages(SESSION_ID);
    expect(messages.length).toBe(2);
    store.close();
  });

  test("re-ingest updates session name when source file changes", async () => {
    // Overwrite the fixture with a different user message
    writeFixture("Updated task description after refactor");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    await reingestCommand({});

    console.log = origLog;

    // Session name should now reflect the new content
    const store = new Store(dbPath);
    const session = store.getSession(SESSION_ID);
    expect(session).toBeDefined();
    expect(session!.name).toBe("Updated task description after refactor");
    store.close();
  });

  test("--adapter flag filters to specific adapter", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    await reingestCommand({ adapter: "nonexistent-adapter" });

    console.log = origLog;

    // Should still complete but with 0 sessions
    const doneLine = logs.find((l) => l.includes("Done."));
    expect(doneLine).toBeDefined();
    expect(doneLine).toContain("0 sessions");
  });

  test("--adapter=claude-code ingests only claude-code", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    await reingestCommand({ adapter: "claude-code" });

    console.log = origLog;

    // Should see Claude Code in the output
    const ccLine = logs.find((l) => l.includes("Claude Code"));
    expect(ccLine).toBeDefined();
  });

  test("skips push when no sinks configured", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    await reingestCommand({ push: true });

    console.log = origLog;

    const skipLine = logs.find((l) => l.includes("No sinks configured"));
    expect(skipLine).toBeDefined();
  });

  test("raw directory is created if missing", async () => {
    // Remove raw dir
    rmSync(rawDir, { recursive: true, force: true });
    expect(existsSync(rawDir)).toBe(false);

    const origLog = console.log;
    console.log = () => {};
    await reingestCommand({});
    console.log = origLog;

    expect(existsSync(rawDir)).toBe(true);
  });
});
