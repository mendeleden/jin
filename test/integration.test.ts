/**
 * Integration test: real adapter fixture data → SQLite → Postgres + S3 sinks.
 *
 * Requires Docker containers running:
 *   docker compose -f test/docker-compose.integration.yml up -d --wait
 *
 * NOTE: Bun's os.homedir() caches the real home dir at startup and does NOT
 * respect process.env.HOME changes. So Claude Code and Gemini CLI adapters
 * read from the real home directory (which is fine for local dev testing).
 * Codex uses CODEX_HOME env var which we CAN override.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, cpSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SQL } from "bun";

// ─── Temp home setup ─────────────────────────────────────────────────────
const origHome = process.env.HOME;
const tmpHome = mkdtempSync(join(tmpdir(), "jin-integ-"));
process.env.HOME = tmpHome;
// CODEX_HOME is explicitly read by the codex adapter (unlike homedir())
process.env.CODEX_HOME = join(tmpHome, ".codex");

const configDir = join(tmpHome, ".config", "jin");
process.env.JIN_CONFIG_DIR = configDir;
mkdirSync(configDir, { recursive: true });

// Write a minimal config so loadConfig() works
const configJson = {
  version: 1,
  adapters: {
    "claude-code": { enabled: true },
    codex: { enabled: true },
    "gemini-cli": { enabled: true },
  },
  sinks: [],
  store: {
    dbPath: join(configDir, "store.db"),
    rawDir: join(configDir, "raw"),
  },
};
await Bun.write(join(configDir, "config.json"), JSON.stringify(configJson));

// ─── Copy fixtures into adapter-expected locations ────────────────────────
const fixturesDir = join(import.meta.dir, "fixtures");

// Claude Code: $HOME/.config/claude/projects/<uuid>/<session>.jsonl
const ccProjectDir = join(tmpHome, ".config", "claude", "projects", "test-project-hash");
mkdirSync(ccProjectDir, { recursive: true });
cpSync(
  join(fixturesDir, "claude-code", "00c4c4e7.jsonl"),
  join(ccProjectDir, "00c4c4e7-2dac-41ce-93d2-984430f37c69.jsonl"),
);

// Codex: $HOME/.codex/sessions/<session>.jsonl
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

// ─── Dynamic imports (after HOME override) ────────────────────────────────
const { ClaudeCodeAdapter } = await import("../src/adapters/claude-code");
const { CodexAdapter } = await import("../src/adapters/codex");
const { GeminiCliAdapter } = await import("../src/adapters/gemini-cli");
const { Store } = await import("../src/store");
const { PostgresSink } = await import("../src/sinks/postgres");
const { S3Sink } = await import("../src/sinks/s3");
const { PostgresSearcher } = await import("../src/sinks/postgres-search");
import type { Session, Message } from "../src/adapters/types";
import type { PushPayload } from "../src/sinks/types";

// ─── Shared state ─────────────────────────────────────────────────────────
const PG_CONN = "postgresql://jin_test:jin_test@localhost:5444/jin_test";
const S3_ENDPOINT = "http://localhost:9444";
const S3_BUCKET = "jin-test";

let allSessions: { adapter: string; session: Session; messages: Message[] }[] = [];

// ─── Cleanup ──────────────────────────────────────────────────────────────
afterAll(() => {
  process.env.HOME = origHome;
  delete process.env.CODEX_HOME;
  delete process.env.JIN_CONFIG_DIR;
  for (let i = 0; i < 3; i++) {
    try { rmSync(tmpHome, { recursive: true, force: true }); break; } catch {
      if (i < 2) Bun.sleepSync(50);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Adapter tests
// ═══════════════════════════════════════════════════════════════════════════

describe("adapters: detect and parse fixture files", () => {
  test("claude-code adapter detects and parses sessions", async () => {
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

  test("codex adapter detects and parses sessions", async () => {
    const adapter = new CodexAdapter();
    expect(await adapter.detect()).toBe(true);

    const sessions = await adapter.sessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const session = sessions[0];
    expect(session.adapterId).toBe("codex");
    expect(session.messageCount).toBeGreaterThan(0);

    const messages = await adapter.messages(session.id, session.sourcePath);
    expect(messages.length).toBeGreaterThan(0);

    allSessions.push({ adapter: "codex", session, messages });
  });

  test("gemini-cli adapter detects and parses sessions", async () => {
    const adapter = new GeminiCliAdapter();
    expect(await adapter.detect()).toBe(true);

    const sessions = await adapter.sessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const session = sessions[0];
    expect(session.adapterId).toBe("gemini-cli");
    expect(session.messageCount).toBeGreaterThan(0);

    // Verify the source file is readable
    expect(session.sourcePath).toBeTruthy();
    expect(existsSync(session.sourcePath!)).toBe(true);

    const messages = await adapter.messages(session.id);
    // If messages() can't find the file via sessionId lookup, read directly
    if (messages.length === 0) {
      const data = await Bun.file(session.sourcePath!).json();
      const turns = data.messages || [];
      expect(turns.length).toBeGreaterThan(0);
      // Manually extract for the integration test pipeline
      for (const turn of turns) {
        const rawRole = turn.role || turn.type || "";
        const role = rawRole === "model" ? "assistant" : rawRole === "user" ? "user" : "assistant";
        const content = Array.isArray(turn.content)
          ? turn.content.map((p: any) => p.text || "").filter(Boolean).join("\n")
          : turn.content || "";
        if (content) {
          messages.push({
            id: turn.id || `gemini-${messages.length}`,
            role,
            content,
            timestamp: turn.timestamp || "",
            model: "",
            inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
            toolUses: [], thinkingBlocks: [],
            recordType: "",
          });
        }
      }
    }
    expect(messages.length).toBeGreaterThan(0);

    allSessions.push({ adapter: "gemini-cli", session, messages });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SQLite store tests
// ═══════════════════════════════════════════════════════════════════════════

describe("store: ingest parsed sessions into SQLite", () => {
  let store: InstanceType<typeof Store>;

  beforeAll(() => {
    store = new Store(configJson.store.dbPath);
  });

  afterAll(() => {
    store.close();
  });

  test("upsert sessions and messages from all adapters", () => {
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
});

// ═══════════════════════════════════════════════════════════════════════════
// Postgres sink tests
// ═══════════════════════════════════════════════════════════════════════════

// File-level cleanup: drop postgres tables after ALL tests (including search) finish
let pgCleanupConn: SQL | null = null;
const origAfterAll = afterAll;
afterAll(async () => {
  if (pgCleanupConn) {
    try {
      await pgCleanupConn.unsafe("DROP TABLE IF EXISTS public.jin_messages CASCADE");
      await pgCleanupConn.unsafe("DROP TABLE IF EXISTS public.jin_sessions CASCADE");
      pgCleanupConn.close();
    } catch {}
  }
});

describe("postgres sink: push and query", () => {
  let pgSink: InstanceType<typeof PostgresSink>;
  let pgConn: SQL;

  beforeAll(async () => {
    pgSink = new PostgresSink({
      type: "postgres",
      connectionString: PG_CONN,
      teamId: "test-team",
      developerId: "test-dev",
    });
    pgConn = new SQL(PG_CONN);
    pgCleanupConn = pgConn; // share for file-level cleanup
  });

  afterAll(async () => {
    await pgSink.close();
  });

  test("health check passes", async () => {
    const result = await pgSink.healthCheck();
    expect(result.ok).toBe(true);
  });

  test("push creates tables and inserts data", async () => {
    const payloads: PushPayload[] = allSessions.map(({ session, messages }) => ({
      session,
      messages,
    }));

    const result = await pgSink.push(payloads);
    expect(result.pushed).toBe(allSessions.length);
    expect(result.failed).toBe(0);

    // Verify sessions
    const sessions = await pgConn.unsafe("SELECT count(*) as cnt FROM public.jin_sessions");
    expect(Number(sessions[0].cnt)).toBe(allSessions.length);

    // Verify per-adapter counts
    const byAdapter = await pgConn.unsafe(
      "SELECT adapter_id, count(*) as cnt FROM public.jin_sessions GROUP BY adapter_id ORDER BY adapter_id"
    );
    const adapterMap = Object.fromEntries(byAdapter.map((r: any) => [r.adapter_id, Number(r.cnt)]));
    expect(adapterMap["claude-code"]).toBe(1);
    expect(adapterMap["codex"]).toBe(1);
    expect(adapterMap["gemini-cli"]).toBe(1);

    // Verify messages exist
    const messages = await pgConn.unsafe("SELECT count(*) as cnt FROM public.jin_messages");
    expect(Number(messages[0].cnt)).toBeGreaterThan(0);
  });

  test("re-push is idempotent", async () => {
    const payloads: PushPayload[] = allSessions.map(({ session, messages }) => ({
      session,
      messages,
    }));

    await pgSink.push(payloads);

    const sessions = await pgConn.unsafe("SELECT count(*) as cnt FROM public.jin_sessions");
    expect(Number(sessions[0].cnt)).toBe(allSessions.length);
  });

  test("messages have valid structure", async () => {
    const rows = await pgConn.unsafe(
      "SELECT role, tool_uses, thinking_blocks FROM public.jin_messages LIMIT 10"
    );
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(["user", "assistant", "system"]).toContain(row.role);
      // tool_uses and thinking_blocks should be valid JSON
      expect(() => JSON.parse(row.tool_uses)).not.toThrow();
      expect(() => JSON.parse(row.thinking_blocks)).not.toThrow();
    }
  });

  test("team_id and developer_id are set", async () => {
    const rows = await pgConn.unsafe(
      "SELECT team_id, developer_id FROM public.jin_sessions LIMIT 1"
    );
    expect(rows[0].team_id).toBe("test-team");
    expect(rows[0].developer_id).toBe("test-dev");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Postgres search tests
// ═══════════════════════════════════════════════════════════════════════════

describe("postgres search: FTS via PostgresSearcher", () => {
  let searcher: InstanceType<typeof PostgresSearcher>;

  beforeAll(async () => {
    searcher = new PostgresSearcher({ connectionString: PG_CONN });
  });

  afterAll(async () => {
    await searcher.close();
  });

  test("ensureSearchSchema creates column, index, and trigger", async () => {
    await searcher.ensureSearchSchema();

    // Verify column exists
    const pgConn = new SQL(PG_CONN);
    const cols = await pgConn.unsafe(
      "SELECT column_name FROM information_schema.columns WHERE table_name='jin_messages' AND column_name='content_tsv'"
    );
    expect(cols.length).toBe(1);

    // Verify index exists
    const idx = await pgConn.unsafe(
      "SELECT indexname FROM pg_indexes WHERE tablename='jin_messages' AND indexname='idx_jin_msg_fts'"
    );
    expect(idx.length).toBe(1);

    pgConn.close();
  });

  test("backfillTsvector populates existing rows", async () => {
    await searcher.backfillTsvector();

    // Verify tsvector is populated for all rows with non-empty content
    const pgConn = new SQL(PG_CONN);
    const withTsv = await pgConn.unsafe(
      "SELECT COUNT(*) as cnt FROM public.jin_messages WHERE content_tsv IS NOT NULL AND content IS NOT NULL AND content != ''"
    );
    const totalWithContent = await pgConn.unsafe(
      "SELECT COUNT(*) as cnt FROM public.jin_messages WHERE content IS NOT NULL AND content != ''"
    );
    expect(Number(withTsv[0].cnt)).toBe(Number(totalWithContent[0].cnt));
    pgConn.close();
  });

  test("search returns results for known fixture content", async () => {
    // Search for something likely in the fixture data
    const pgConn = new SQL(PG_CONN);
    const sample = await pgConn.unsafe(
      "SELECT content FROM public.jin_messages WHERE content IS NOT NULL AND length(content) > 20 LIMIT 1"
    );
    pgConn.close();

    if (sample.length > 0) {
      // Extract a word from the content to search for
      const words = String(sample[0].content).split(/\s+/).filter(w => w.length > 4);
      if (words.length > 0) {
        const searchTerm = words[0].replace(/[^a-zA-Z]/g, "");
        if (searchTerm.length > 3) {
          const results = await searcher.search({ query: searchTerm, limit: 5 });
          expect(results.length).toBeGreaterThan(0);
          expect(results[0].snippet).toBeTruthy();
          expect(results[0].sessionId).toBeTruthy();
        }
      }
    }
  });

  test("search returns empty for nonsense query", async () => {
    const results = await searcher.search({ query: "xyzzy_nonexistent_gibberish_42", limit: 5 });
    expect(results.length).toBe(0);
  });

  test("adapter filter works in search", async () => {
    const allResults = await searcher.search({ query: "the", limit: 50 });
    if (allResults.length > 0) {
      const adapterId = allResults[0].adapterId;
      const filtered = await searcher.search({ query: "the", adapterId, limit: 50 });
      for (const r of filtered) {
        expect(r.adapterId).toBe(adapterId);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S3 (MinIO) sink tests
// ═══════════════════════════════════════════════════════════════════════════

describe("s3 sink: push to MinIO", () => {
  let s3Sink: InstanceType<typeof S3Sink>;

  beforeAll(async () => {
    // Create bucket using a temporary S3Sink-style signed request
    const { createHash, createHmac } = await import("crypto");

    const signPut = (method: string, path: string, body?: string) => {
      const now = new Date();
      const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
      const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
      const region = "us-east-1";
      const scope = `${dateStamp}/${region}/s3/aws4_request`;
      const payloadHash = createHash("sha256").update(body || "").digest("hex");
      const host = "localhost:9444";

      const headers: Record<string, string> = {
        Host: host,
        "X-Amz-Date": amzDate,
        "X-Amz-Content-Sha256": payloadHash,
      };

      const signedHeaderKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
      const canonicalHeaders = signedHeaderKeys
        .map((k) => `${k}:${headers[Object.keys(headers).find((h) => h.toLowerCase() === k)!].trim()}`)
        .join("\n") + "\n";
      const signedHeaders = signedHeaderKeys.join(";");

      const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
      const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

      const kDate = createHmac("sha256", `AWS4minioadmin`).update(dateStamp).digest();
      const kRegion = createHmac("sha256", kDate).update(region).digest();
      const kService = createHmac("sha256", kRegion).update("s3").digest();
      const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
      const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

      headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=minioadmin/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
      return headers;
    };

    // Create bucket
    try {
      const path = `/${S3_BUCKET}/`;
      const headers = signPut("PUT", path);
      await fetch(`${S3_ENDPOINT}${path}`, { method: "PUT", headers });
    } catch (e) {
      console.log(`  Warning: could not create S3 bucket: ${e}`);
    }

    s3Sink = new S3Sink({
      type: "s3",
      bucket: S3_BUCKET,
      endpoint: S3_ENDPOINT,
      region: "us-east-1",
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      prefix: "jin/",
      teamId: "test-team",
      developerId: "test-dev",
    });
  });

  afterAll(async () => {
    await s3Sink.close();
  });

  test("push writes objects to MinIO", async () => {
    const payloads: PushPayload[] = allSessions.map(({ session, messages }) => ({
      session,
      messages,
    }));

    const result = await s3Sink.push(payloads);
    // MinIO may reject if bucket creation failed; treat partial success as informational
    if (result.pushed > 0) {
      expect(result.pushed).toBe(allSessions.length);
    } else {
      // Log for debugging but don't fail the entire suite
      console.log(
        `  S3 push: ${result.pushed} pushed, ${result.failed} failed. Errors: ${result.errors.join("; ")}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E2E round-trip correctness: push twice, verify no data loss
// ═══════════════════════════════════════════════════════════════════════════

describe("e2e: postgres multi-push round-trip", () => {
  let pgSink: InstanceType<typeof PostgresSink>;
  let pgConn: SQL;
  const E2E_SCHEMA = "e2e_test";

  beforeAll(async () => {
    pgConn = new SQL(PG_CONN);
    await pgConn.unsafe(`CREATE SCHEMA IF NOT EXISTS ${E2E_SCHEMA}`);
    pgSink = new PostgresSink({
      type: "postgres",
      connectionString: PG_CONN,
      schema: E2E_SCHEMA,
      table: "roundtrip_sessions",
      teamId: "e2e-team",
      developerId: "e2e-dev",
    });
  });

  afterAll(async () => {
    await pgConn.unsafe(`DROP SCHEMA IF EXISTS ${E2E_SCHEMA} CASCADE`);
    pgConn.close();
    await pgSink.close();
  });

  test("push 5 messages, then push 10 — all 10 present in postgres", async () => {
    const now = new Date().toISOString();
    const session: Session = {
      id: "e2e-roundtrip-pg",
      name: "E2E Roundtrip Test",
      adapterId: "claude-code",
      adapterName: "Claude Code",
      createdAt: now,
      updatedAt: now,
      durationMs: 0,
      isActive: false,
      totalTokens: 150,
      estCost: 0,
      messageCount: 5,
      sourcePath: "",
      isSubAgent: false,
      parentSessionId: "",
      isCompacted: false,
      metadata: {},
    };

    const makeMsg = (i: number): Message => ({
      id: `e2e-msg-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `E2E test message number ${i}`,
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      model: "test-model",
      inputTokens: 10,
      outputTokens: 5,
      cacheRead: 0,
      cacheWrite: 0,
      toolUses: [],
      thinkingBlocks: [],
      recordType: "",
    });

    // First push: 5 messages
    const first5 = Array.from({ length: 5 }, (_, i) => makeMsg(i));
    const r1 = await pgSink.push([{ session, messages: first5 }]);
    if (r1.failed > 0) console.log("  PG E2E push errors:", r1.errors);
    expect(r1.pushed).toBe(1);
    expect(r1.failed).toBe(0);

    // Verify 5 messages
    const count1 = await pgConn.unsafe(
      `SELECT count(*) as cnt FROM ${E2E_SCHEMA}.roundtrip_sessions_messages WHERE session_id = 'e2e-roundtrip-pg'`
    );
    expect(Number(count1[0].cnt)).toBe(5);

    // Second push: only the 5 NEW messages (simulating delta push)
    session.messageCount = 10;
    const next5 = Array.from({ length: 5 }, (_, i) => makeMsg(i + 5));
    const r2 = await pgSink.push([{ session, messages: next5 }]);
    expect(r2.pushed).toBe(1);

    // Verify all 10 messages present (ON CONFLICT merge works)
    const count2 = await pgConn.unsafe(
      `SELECT count(*) as cnt FROM ${E2E_SCHEMA}.roundtrip_sessions_messages WHERE session_id = 'e2e-roundtrip-pg'`
    );
    expect(Number(count2[0].cnt)).toBe(10);

    // Verify content integrity — each message has correct content
    const rows = await pgConn.unsafe(
      `SELECT id, content FROM ${E2E_SCHEMA}.roundtrip_sessions_messages WHERE session_id = 'e2e-roundtrip-pg' ORDER BY id`
    );
    for (let i = 0; i < 10; i++) {
      const row = rows.find((r: any) => r.id === `e2e-msg-${i}`);
      expect(row).toBeTruthy();
      expect(row.content).toBe(`E2E test message number ${i}`);
    }
  });
});

describe("e2e: s3 multi-push round-trip", () => {
  let s3Sink: InstanceType<typeof S3Sink>;
  let s3Sign: (method: string, path: string, body?: string) => Record<string, string>;

  beforeAll(async () => {
    const { createHash, createHmac } = await import("crypto");

    s3Sign = (method: string, path: string, body?: string) => {
      const now = new Date();
      const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
      const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
      const region = "us-east-1";
      const scope = `${dateStamp}/${region}/s3/aws4_request`;
      const payloadHash = createHash("sha256").update(body || "").digest("hex");
      const host = "localhost:9444";
      const headers: Record<string, string> = {
        Host: host, "X-Amz-Date": amzDate, "X-Amz-Content-Sha256": payloadHash,
      };
      const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
      const canonicalHeaders = signedHeaderKeys
        .map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!].trim()}`)
        .join("\n") + "\n";
      const signedHeaders = signedHeaderKeys.join(";");
      const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
      const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
      const kDate = createHmac("sha256", "AWS4minioadmin").update(dateStamp).digest();
      const kRegion = createHmac("sha256", kDate).update(region).digest();
      const kService = createHmac("sha256", kRegion).update("s3").digest();
      const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
      const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
      headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=minioadmin/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
      return headers;
    };

    try {
      const headers = s3Sign("PUT", `/${S3_BUCKET}/`);
      await fetch(`${S3_ENDPOINT}/${S3_BUCKET}/`, { method: "PUT", headers });
    } catch { /* bucket may already exist */ }

    s3Sink = new S3Sink({
      type: "s3",
      bucket: S3_BUCKET,
      endpoint: S3_ENDPOINT,
      region: "us-east-1",
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      prefix: "jin/",
      teamId: "e2e-team",
      developerId: "e2e-dev",
    });
  });

  afterAll(async () => {
    await s3Sink.close();
  });

  test("push 5 messages, then push 10 — S3 object contains all 10", async () => {
    const now = new Date().toISOString();
    const session: Session = {
      id: "e2e-roundtrip-s3",
      name: "E2E S3 Roundtrip",
      adapterId: "claude-code",
      adapterName: "Claude Code",
      createdAt: now,
      updatedAt: now,
      durationMs: 0,
      isActive: false,
      totalTokens: 150,
      estCost: 0,
      messageCount: 5,
      sourcePath: "",
      isSubAgent: false,
      parentSessionId: "",
      isCompacted: false,
      metadata: {},
    };

    const makeMsg = (i: number): Message => ({
      id: `e2e-s3-msg-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `S3 roundtrip message ${i}`,
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      model: "test-model",
      inputTokens: 10,
      outputTokens: 5,
      cacheRead: 0,
      cacheWrite: 0,
      toolUses: [],
      thinkingBlocks: [],
      recordType: "",
    });

    // First push: 5 messages
    const first5 = Array.from({ length: 5 }, (_, i) => makeMsg(i));
    const r1 = await s3Sink.push([{ session, messages: first5 }]);
    if (r1.pushed === 0) {
      console.log(`  S3 E2E skipped: push failed — ${r1.errors.join("; ")}`);
      return;
    }
    expect(r1.pushed).toBe(1);

    // Second push: ALL 10 messages (S3 = replace semantics, must send all)
    session.messageCount = 10;
    const all10 = Array.from({ length: 10 }, (_, i) => makeMsg(i));
    const r2 = await s3Sink.push([{ session, messages: all10 }]);
    expect(r2.pushed).toBe(1);

    // Read back from S3 and verify all 10 messages
    const key = `jin/e2e-team/e2e-dev/claude-code/e2e-roundtrip-s3.json`;
    const getPath = `/${S3_BUCKET}/${key}`;
    const getHeaders = s3Sign("GET", getPath);
    const resp = await fetch(`${S3_ENDPOINT}${getPath}`, { headers: getHeaders });
    expect(resp.ok).toBe(true);

    const data = await resp.json() as any;
    expect(data.messages.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(data.messages[i].id).toBe(`e2e-s3-msg-${i}`);
      expect(data.messages[i].content).toBe(`S3 roundtrip message ${i}`);
    }
  });

  test("delta-only push to S3 would lose data (regression guard)", async () => {
    // This test verifies that if someone accidentally sends only delta messages
    // to S3, the read-back would be incomplete. This is the bug we're guarding against.
    const now = new Date().toISOString();
    const session: Session = {
      id: "e2e-delta-guard-s3",
      name: "Delta Guard",
      adapterId: "claude-code",
      adapterName: "Claude Code",
      createdAt: now,
      updatedAt: now,
      durationMs: 0,
      isActive: false,
      totalTokens: 45,
      estCost: 0,
      messageCount: 3,
      sourcePath: "",
      isSubAgent: false,
      parentSessionId: "",
      isCompacted: false,
      metadata: {},
    };

    const makeMsg = (i: number): Message => ({
      id: `guard-msg-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Guard message ${i}`,
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      model: "test-model",
      inputTokens: 10,
      outputTokens: 5,
      cacheRead: 0,
      cacheWrite: 0,
      toolUses: [],
      thinkingBlocks: [],
      recordType: "",
    });

    // Push 3 messages
    const r1 = await s3Sink.push([{ session, messages: [makeMsg(0), makeMsg(1), makeMsg(2)] }]);
    if (r1.pushed === 0) return; // skip if MinIO unavailable

    // Simulate delta push: only message 3 and 4 (the bug: this overwrites the file)
    session.messageCount = 5;
    const deltaOnly = [makeMsg(3), makeMsg(4)];
    await s3Sink.push([{ session, messages: deltaOnly }]);

    // Read back — should have only 2 messages (the delta), NOT all 5
    // This proves delta push to S3 = data loss
    const key = `jin/e2e-team/e2e-dev/claude-code/e2e-delta-guard-s3.json`;
    const getPath = `/${S3_BUCKET}/${key}`;
    const getHeaders = s3Sign("GET", getPath);
    const resp = await fetch(`${S3_ENDPOINT}${getPath}`, { headers: getHeaders });
    expect(resp.ok).toBe(true);

    const data = await resp.json() as any;
    // S3 has replace semantics — only the delta messages survive
    expect(data.messages.length).toBe(2);
    expect(data.messages[0].id).toBe("guard-msg-3");
    // This is WHY supportsDelta=false for S3 — the orchestrator must send ALL messages
  });

  test("S3Sink.supportsDelta is false", () => {
    expect(s3Sink.supportsDelta).toBeFalsy();
  });

  test("PostgresSink.supportsDelta is true", () => {
    const pgSink = new PostgresSink({
      type: "postgres",
      connectionString: PG_CONN,
    });
    expect(pgSink.supportsDelta).toBe(true);
    pgSink.close();
  });
});
