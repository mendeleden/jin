import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Temp config setup ──────────────────────────────────────────────────
const tmpHome = mkdtempSync(join(tmpdir(), "jin-search-"));
const configDir = join(tmpHome, ".config", "jin");
process.env.JIN_CONFIG_DIR = configDir;
mkdirSync(configDir, { recursive: true });

const configJson = {
  version: 1,
  adapters: { "claude-code": { enabled: true }, codex: { enabled: true } },
  sinks: [
    { type: "postgres", id: "pg-team", name: "team-db", connectionString: "postgresql://localhost/test" },
    { type: "s3", id: "s3-backup", bucket: "backups" },
    { type: "postgres", id: "pg-other", name: "other-db", connectionString: "postgresql://localhost/other" },
  ],
  routes: [
    { match: { project: "jin" }, sinks: ["pg-team"] },
    { match: { remote: "github.com/acme/api" }, sinks: ["pg-team", "pg-other"] },
  ],
  defaultSinks: ["pg-other"],
  store: { dbPath: join(configDir, "store.db"), rawDir: join(configDir, "raw") },
};
await Bun.write(join(configDir, "config.json"), JSON.stringify(configJson));

const { Store } = await import("../src/store");
const { resolveSinksForCwd, findSinkById, allPostgresSinks } = await import("../src/sink-resolver");
import type { JinConfig } from "../src/config";

afterAll(() => {
  delete process.env.JIN_CONFIG_DIR;
  const delays = [50, 100, 200, 400, 800];
  for (let i = 0; i < delays.length; i++) {
    try { rmSync(tmpHome, { recursive: true, force: true }); break; } catch {
      if (i < delays.length - 1) Bun.sleepSync(delays[i]);
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════
// Sink resolver tests
// ═════════════════════════════════════════════════════════════════════════

describe("resolveSinksForCwd", () => {
  const config = configJson as unknown as JinConfig;

  test("resolves sinks for project name match", () => {
    // Simulating cwd = /Users/dev/jin — project name "jin" should match route[0]
    const sinks = resolveSinksForCwd("/Users/dev/jin", config);
    expect(sinks.length).toBe(1);
    expect(sinks[0].sinkId).toBe("pg-team");
    expect(sinks[0].sinkName).toBe("team-db");
  });

  test("returns only postgres sinks (filters out s3)", () => {
    const sinks = resolveSinksForCwd("/Users/dev/jin", config);
    for (const s of sinks) {
      expect(s.sinkConfig.type).toBe("postgres");
    }
  });

  test("falls back to defaultSinks for unmatched project", () => {
    const sinks = resolveSinksForCwd("/Users/dev/random-project", config);
    expect(sinks.length).toBe(1);
    expect(sinks[0].sinkId).toBe("pg-other");
  });

  test("returns empty when no routes and no defaults", () => {
    const noRoutesConfig = { ...config, routes: [], defaultSinks: [] };
    const sinks = resolveSinksForCwd("/Users/dev/whatever", noRoutesConfig);
    expect(sinks.length).toBe(0);
  });
});

describe("findSinkById", () => {
  const config = configJson as unknown as JinConfig;

  test("finds postgres sink by id", () => {
    const sink = findSinkById("pg-team", config);
    expect(sink).not.toBeNull();
    expect(sink!.sinkName).toBe("team-db");
  });

  test("returns null for s3 sink", () => {
    const sink = findSinkById("s3-backup", config);
    expect(sink).toBeNull();
  });

  test("returns null for nonexistent id", () => {
    const sink = findSinkById("nope", config);
    expect(sink).toBeNull();
  });
});

describe("allPostgresSinks", () => {
  const config = configJson as unknown as JinConfig;

  test("returns all postgres sinks", () => {
    const sinks = allPostgresSinks(config);
    expect(sinks.length).toBe(2);
    expect(sinks.map(s => s.sinkId).sort()).toEqual(["pg-other", "pg-team"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// SQLite FTS5 search tests
// ═════════════════════════════════════════════════════════════════════════

describe("store.searchMessages (SQLite FTS5)", () => {
  let store: InstanceType<typeof Store>;

  beforeAll(() => {
    store = new Store(configJson.store.dbPath);
    // Insert test sessions and messages
    store.upsertSession({
      id: "sess-1",
      name: "fix auth token handling",
      adapterId: "claude-code",
      adapterName: "Claude Code",
      createdAt: "2026-02-28T10:00:00Z",
      updatedAt: "2026-02-28T11:00:00Z",
      durationMs: 3600000,
      isActive: false,
      totalTokens: 5000,
      estCost: 0.5,
      messageCount: 3,
      sourcePath: "",
      isSubAgent: false,
      parentSessionId: "",
      isCompacted: false,
      metadata: {},
    });
    store.upsertMessages("sess-1", [
      {
        id: "msg-1a",
        role: "user",
        content: "Can you implement the token refresh logic?",
        timestamp: "2026-02-28T10:00:00Z",
        model: "",
        inputTokens: 100,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        toolUses: [],
        thinkingBlocks: [],
        recordType: "",
      },
      {
        id: "msg-1b",
        role: "assistant",
        content: "I implemented the token refresh logic using a sliding window approach. The refresh token was expiring because the TTL was set incorrectly.",
        timestamp: "2026-02-28T10:01:00Z",
        model: "claude-opus-4-20250514",
        inputTokens: 100,
        outputTokens: 500,
        cacheRead: 0,
        cacheWrite: 0,
        toolUses: [],
        thinkingBlocks: [],
        recordType: "",
      },
    ]);

    store.upsertSession({
      id: "sess-2",
      name: "add API routes",
      adapterId: "codex",
      adapterName: "Codex",
      createdAt: "2026-02-25T10:00:00Z",
      updatedAt: "2026-02-25T11:00:00Z",
      durationMs: 1800000,
      isActive: false,
      totalTokens: 3000,
      estCost: 0.3,
      messageCount: 2,
      sourcePath: "",
      isSubAgent: false,
      parentSessionId: "",
      isCompacted: false,
      metadata: {},
    });
    store.upsertMessages("sess-2", [
      {
        id: "msg-2a",
        role: "user",
        content: "Create the REST API routes for user management",
        timestamp: "2026-02-25T10:00:00Z",
        model: "",
        inputTokens: 50,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        toolUses: [],
        thinkingBlocks: [],
        recordType: "",
      },
    ]);
  });

  afterAll(() => {
    store.close();
  });

  test("finds matching content via FTS5", () => {
    const results = store.searchMessages({ query: "token refresh" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].sessionId).toBe("sess-1");
  });

  test("snippet contains highlight markers", () => {
    const results = store.searchMessages({ query: "token refresh" });
    expect(results.length).toBeGreaterThan(0);
    // FTS5 snippet uses >>> and <<< markers
    expect(results[0].snippet).toContain(">>>");
    expect(results[0].snippet).toContain("<<<");
  });

  test("adapter filter narrows results", () => {
    const results = store.searchMessages({ query: "API routes", adapterId: "codex" });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.adapterId).toBe("codex");
    }
  });

  test("adapter filter excludes non-matching", () => {
    const results = store.searchMessages({ query: "token refresh", adapterId: "codex" });
    expect(results.length).toBe(0);
  });

  test("empty results for non-matching query", () => {
    const results = store.searchMessages({ query: "nonexistent_xyzzy_query" });
    expect(results.length).toBe(0);
  });

  test("limit parameter works", () => {
    const results = store.searchMessages({ query: "token", limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
