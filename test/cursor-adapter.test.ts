/**
 * Cursor adapter tests: real SQLite fixtures under a temp chats root.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CursorAdapter } from "../src/adapters/cursor";
import type { Message } from "../src/adapters/types";

// ─── Test adapter: same as production but pins chats root ─────────────────

class TestCursorAdapter extends CursorAdapter {
  constructor(chatsDir: string) {
    super(chatsDir);
  }
}

// Private API surface for white-box tests (production keeps these private).
type CursorInternals = CursorAdapter & {
  readSessionMeta(
    dbPath: string,
  ): { agentId: string; name: string; createdAt: string } | null;
  readMessages(dbPath: string): Message[];
  collectMessages(
    blobs: Map<string, Buffer>,
    rootId: string,
    messages: Message[],
  ): void;
};

function internals(adapter: CursorAdapter): CursorInternals {
  return adapter as CursorInternals;
}

// ─── SQLite helpers ───────────────────────────────────────────────────────

function metaToHex(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj), "utf-8").toString("hex");
}

function createStoreDb(
  sessionDir: string,
  meta: Record<string, unknown>,
  blobs: { id: string; data: Buffer }[],
): string {
  mkdirSync(sessionDir, { recursive: true });
  const dbPath = join(sessionDir, "store.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
  db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [metaToHex(meta)]);
  const ins = db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)");
  for (const b of blobs) {
    ins.run(b.id, b.data);
  }
  ins.finalize();
  db.close();
  return dbPath;
}

function createMetaOnlyDb(sessionDir: string, meta: Record<string, unknown>): string {
  mkdirSync(sessionDir, { recursive: true });
  const dbPath = join(sessionDir, "store.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
  db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [metaToHex(meta)]);
  db.close();
  return dbPath;
}

// ─── Temp layout: <chatsRoot>/<workspace>/<sessionId>/store.db ─────────────

describe("CursorAdapter", () => {
  let chatsRoot: string;
  let adapter: TestCursorAdapter;

  beforeEach(() => {
    chatsRoot = mkdtempSync(join(tmpdir(), "jin-cursor-"));
    adapter = new TestCursorAdapter(chatsRoot);
  });

  afterEach(() => {
    rmSync(chatsRoot, { recursive: true, force: true });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. readSessionMeta()
  // ═══════════════════════════════════════════════════════════════════════

  describe("readSessionMeta()", () => {
    it("decodes hex-encoded JSON and maps agentId, name, createdAt", () => {
      const ws = "ws1";
      const sid = "sess-aa";
      const sessionDir = join(chatsRoot, ws, sid);
      const createdMs = Date.UTC(2026, 2, 23, 12, 0, 0);
      createMetaOnlyDb(sessionDir, {
        agentId: "11111111-1111-1111-1111-111111111111",
        name: "My session",
        createdAt: createdMs,
        latestRootBlobId: "",
      });
      const dbPath = join(sessionDir, "store.db");
      const meta = internals(adapter).readSessionMeta(dbPath);
      expect(meta).not.toBeNull();
      expect(meta!.agentId).toBe("11111111-1111-1111-1111-111111111111");
      expect(meta!.name).toBe("My session");
      expect(meta!.createdAt).toBe(new Date(createdMs).toISOString());
    });

    it("uses meta.id when agentId is absent", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      createMetaOnlyDb(sessionDir, {
        id: "22222222-2222-2222-2222-222222222222",
        name: "Named",
        createdAt: 1,
      });
      const meta = internals(adapter).readSessionMeta(join(sessionDir, "store.db"));
      expect(meta!.agentId).toBe("22222222-2222-2222-2222-222222222222");
    });

    it("returns empty agentId and name when those fields are missing", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      createMetaOnlyDb(sessionDir, {
        createdAt: 1000,
        latestRootBlobId: "abc",
      });
      const meta = internals(adapter).readSessionMeta(join(sessionDir, "store.db"));
      expect(meta!.agentId).toBe("");
      expect(meta!.name).toBe("");
      expect(meta!.createdAt).toBe(new Date(1000).toISOString());
    });

    it("returns empty createdAt string when createdAt is missing", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      createMetaOnlyDb(sessionDir, {
        agentId: "33333333-3333-3333-3333-333333333333",
        name: "No time",
      });
      const meta = internals(adapter).readSessionMeta(join(sessionDir, "store.db"));
      expect(meta!.createdAt).toBe("");
    });

    it("returns null when meta row key 0 is missing", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.close();
      expect(internals(adapter).readSessionMeta(dbPath)).toBeNull();
    });

    it("returns null when meta value is empty", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.run("INSERT INTO meta (key, value) VALUES ('0', '')");
      db.close();
      expect(internals(adapter).readSessionMeta(dbPath)).toBeNull();
    });

    it("returns null for corrupt hex (non-hex characters)", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.run("INSERT INTO meta (key, value) VALUES ('0', 'zznothex')");
      db.close();
      expect(internals(adapter).readSessionMeta(dbPath)).toBeNull();
    });

    it("returns null when hex decodes to non-JSON text", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      insertMetaRowAfterCreate(sessionDir, Buffer.from("not json at all", "utf-8").toString("hex"));
      expect(internals(adapter).readSessionMeta(join(sessionDir, "store.db"))).toBeNull();
    });

    it("returns null when createdAt is present but not a valid date", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      createMetaOnlyDb(sessionDir, {
        agentId: "44444444-4444-4444-4444-444444444444",
        name: "Bad date",
        createdAt: "not-a-date",
      });
      expect(internals(adapter).readSessionMeta(join(sessionDir, "store.db"))).toBeNull();
    });

    it("returns null when JSON root is not an object (e.g. array)", () => {
      const sessionDir = join(chatsRoot, "w", "arr-meta");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
        Buffer.from(JSON.stringify([1, 2, 3]), "utf-8").toString("hex"),
      ]);
      db.close();
      expect(internals(adapter).readSessionMeta(dbPath)).toBeNull();
    });

    it("returns null when JSON root is a primitive", () => {
      const sessionDir = join(chatsRoot, "w", "prim-meta");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
        Buffer.from(JSON.stringify("surprise"), "utf-8").toString("hex"),
      ]);
      db.close();
      expect(internals(adapter).readSessionMeta(dbPath)).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. collectMessages() / readMessages()
  // ═══════════════════════════════════════════════════════════════════════

  describe("collectMessages() / readMessages()", () => {
    it("walks parentId chain oldest-first and collects user then assistant", () => {
      const b1 = Buffer.from(
        JSON.stringify({
          role: "user",
          content: "hello",
        }),
        "utf-8",
      );
      const b2 = Buffer.from(
        JSON.stringify({
          role: "assistant",
          content: "hi",
          parentId: "blob-1",
        }),
        "utf-8",
      );
      const b3 = Buffer.from(
        JSON.stringify({
          role: "user",
          content: "again",
          parentId: "blob-2",
        }),
        "utf-8",
      );
      const map = new Map<string, Buffer>([
        ["blob-1", b1],
        ["blob-2", b2],
        ["blob-3", b3],
      ]);
      const messages: Message[] = [];
      internals(adapter).collectMessages(map, "blob-3", messages);
      expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
      expect(messages.map((m) => m.content)).toEqual(["hello", "hi", "again"]);
    });

    it("skips protobuf-like blobs without throwing; still emits later JSON nodes in chain", () => {
      const proto = Buffer.from([0x0a, 0x03, 0x41, 0x41, 0x41]);
      const jsonUser = Buffer.from(
        JSON.stringify({ role: "user", content: "ok", parentId: "proto-1" }),
        "utf-8",
      );
      const jsonRoot = Buffer.from(
        JSON.stringify({ role: "assistant", content: "done", parentId: "user-1" }),
        "utf-8",
      );
      const map = new Map<string, Buffer>([
        ["proto-1", proto],
        ["user-1", jsonUser],
        ["root-1", jsonRoot],
      ]);
      const messages: Message[] = [];
      internals(adapter).collectMessages(map, "root-1", messages);
      expect(messages.length).toBe(2);
      expect(messages[0].content).toBe("ok");
      expect(messages[1].content).toBe("done");
    });

    it("maps role tool to assistant with recordType tool (Message.role has no tool variant)", () => {
      const toolBlob = Buffer.from(
        JSON.stringify({
          role: "tool",
          content: [{ type: "tool-result", toolName: "Read", result: "file" }],
        }),
        "utf-8",
      );
      const map = new Map([["t1", toolBlob]]);
      const messages: Message[] = [];
      internals(adapter).collectMessages(map, "t1", messages);
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].recordType).toBe("tool");
    });

    it("maps role system to system per Message union type", () => {
      const blob = Buffer.from(
        JSON.stringify({ role: "system", content: "You are a helpful agent." }),
        "utf-8",
      );
      const map = new Map([["s1", blob]]);
      const messages: Message[] = [];
      internals(adapter).collectMessages(map, "s1", messages);
      expect(messages[0]!.role).toBe("system");
      expect(messages[0]!.recordType).toBe("");
    });

    it("joins array content using block.text; reasoning contributes text", () => {
      const blob = Buffer.from(
        JSON.stringify({
          role: "assistant",
          content: [
            { type: "reasoning", text: "think" },
            { type: "text", text: "say" },
          ],
        }),
        "utf-8",
      );
      const map = new Map([["a1", blob]]);
      const messages: Message[] = [];
      internals(adapter).collectMessages(map, "a1", messages);
      expect(messages[0].content).toBe("think\nsay");
    });

    it("does not populate thinkingBlocks; reasoning stays in content only", () => {
      const blob = Buffer.from(
        JSON.stringify({
          role: "assistant",
          content: [{ type: "reasoning", text: "hidden chain" }],
        }),
        "utf-8",
      );
      const map = new Map([["a1", blob]]);
      const messages: Message[] = [];
      internals(adapter).collectMessages(map, "a1", messages);
      expect(messages[0]!.thinkingBlocks).toEqual([]);
      expect(messages[0]!.content).toBe("hidden chain");
    });

    it("tool-call and tool-result blocks add empty segments (only .text is read)", () => {
      const blob = Buffer.from(
        JSON.stringify({
          role: "assistant",
          content: [
            { type: "text", text: "before" },
            {
              type: "tool-call",
              toolName: "Glob",
              args: { glob_pattern: "**/*" },
            },
            {
              type: "tool-result",
              toolName: "Read",
              result: "line1\nline2",
            },
            { type: "text", text: "after" },
          ],
        }),
        "utf-8",
      );
      const map = new Map([["a1", blob]]);
      const messages: Message[] = [];
      internals(adapter).collectMessages(map, "a1", messages);
      expect(messages[0].content).toBe("before\n\n\nafter");
      expect(messages[0].toolUses).toEqual([]);
    });

    it("parentId cycle: RangeError from deep recursion is swallowed by per-blob try/catch (no cycle guard)", () => {
      const a = Buffer.from(
        JSON.stringify({
          role: "user",
          content: "a",
          parentId: "blob-b",
        }),
        "utf-8",
      );
      const b = Buffer.from(
        JSON.stringify({
          role: "user",
          content: "b",
          parentId: "blob-a",
        }),
        "utf-8",
      );
      const map = new Map<string, Buffer>([
        ["blob-a", a],
        ["blob-b", b],
      ]);
      const messages: Message[] = [];
      expect(() => internals(adapter).collectMessages(map, "blob-a", messages)).not.toThrow();
      expect(messages.length).toBeGreaterThanOrEqual(0);
    });

    it("handles a deep linear chain without stack overflow (depth 150)", () => {
      const ids: string[] = [];
      for (let i = 0; i < 150; i++) {
        ids.push(`b${i}`);
      }
      const map = new Map<string, Buffer>();
      for (let i = 0; i < 150; i++) {
        const id = ids[i]!;
        const parentId = i === 0 ? undefined : ids[i - 1];
        map.set(
          id,
          Buffer.from(
            JSON.stringify({
              role: "user",
              content: `m${i}`,
              ...(parentId ? { parentId } : {}),
            }),
            "utf-8",
          ),
        );
      }
      const messages: Message[] = [];
      const root = ids[149]!;
      internals(adapter).collectMessages(map, root, messages);
      expect(messages.length).toBe(150);
      expect(messages[0]!.content).toBe("m0");
      expect(messages[149]!.content).toBe("m149");
    });

    it("continues when parentId points to a missing blob (partial history)", () => {
      const root = Buffer.from(
        JSON.stringify({
          role: "assistant",
          content: "only root",
          parentId: "ghost",
        }),
        "utf-8",
      );
      const map = new Map([["root", root]]);
      const messages: Message[] = [];
      internals(adapter).collectMessages(map, "root", messages);
      expect(messages.length).toBe(1);
      expect(messages[0]!.content).toBe("only root");
    });

    it("readMessages returns [] when latestRootBlobId blob is absent", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      createStoreDb(
        sessionDir,
        {
          agentId: "aaaa",
          latestRootBlobId: "missing-root",
          createdAt: 1000,
        },
        [],
      );
      const out = internals(adapter).readMessages(join(sessionDir, "store.db"));
      expect(out).toEqual([]);
    });

    it("readMessages returns [] when meta key 0 is missing", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.close();
      expect(internals(adapter).readMessages(dbPath)).toEqual([]);
    });

    it("readMessages returns [] when meta JSON is an array", () => {
      const sessionDir = join(chatsRoot, "w", "bad-read-meta");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
        Buffer.from(JSON.stringify([{ latestRootBlobId: "x" }]), "utf-8").toString("hex"),
      ]);
      db.close();
      expect(internals(adapter).readMessages(dbPath)).toEqual([]);
    });

    it("readMessages returns [] when createdAt is invalid but blobs parse (outer catch)", () => {
      const sessionDir = join(chatsRoot, "w", "s");
      const rootJson = { role: "user", content: "x" };
      createStoreDb(
        sessionDir,
        {
          agentId: "x",
          latestRootBlobId: "r1",
          createdAt: "not-a-date",
        },
        [{ id: "r1", data: Buffer.from(JSON.stringify(rootJson), "utf-8") }],
      );
      expect(internals(adapter).readMessages(join(sessionDir, "store.db"))).toEqual([]);
    });

    it("stringifies non-array non-string content (e.g. null)", () => {
      const blob = Buffer.from(
        JSON.stringify({
          role: "user",
          content: null,
        }),
        "utf-8",
      );
      const map = new Map([["n1", blob]]);
      const messages: Message[] = [];
      internals(adapter).collectMessages(map, "n1", messages);
      expect(messages.length).toBe(1);
      expect(messages[0]!.content).toBe("null");
    });

    it("readMessages decodes BLOB columns when the driver returns Uint8Array (Bun file-backed sqlite)", () => {
      const sessionDir = join(chatsRoot, "w", "uint8");
      const payload = { role: "user", content: "from-db" };
      createStoreDb(
        sessionDir,
        {
          agentId: "uint8-test",
          createdAt: 1,
          latestRootBlobId: "b1",
        },
        [{ id: "b1", data: Buffer.from(JSON.stringify(payload), "utf-8") }],
      );
      const dbPath = join(sessionDir, "store.db");
      const probe = new Database(dbPath, { readonly: true });
      const raw = (probe.query("SELECT data FROM blobs WHERE id = 'b1'").get() as { data: unknown }).data;
      probe.close();
      expect(Buffer.isBuffer(raw) || raw instanceof Uint8Array).toBe(true);

      const out = internals(adapter).readMessages(dbPath);
      expect(out.length).toBe(1);
      expect(out[0]!.content).toBe("from-db");
    });

    it("readMessages skips rows with null blob data", () => {
      const sessionDir = join(chatsRoot, "w", "null-blob");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
        metaToHex({
          agentId: "n",
          createdAt: 1,
          latestRootBlobId: "good",
        }),
      ]);
      db.run("INSERT INTO blobs (id, data) VALUES ('good', ?)", [
        Buffer.from(JSON.stringify({ role: "user", content: "ok" }), "utf-8"),
      ]);
      db.run("INSERT INTO blobs (id, data) VALUES ('bad', NULL)");
      db.close();

      const out = internals(adapter).readMessages(dbPath);
      expect(out.length).toBe(1);
      expect(out[0]!.content).toBe("ok");
    });

    it("last duplicate blob id in table wins (same PRIMARY KEY normally prevents this)", () => {
      const sessionDir = join(chatsRoot, "w", "dup");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
        metaToHex({
          agentId: "d",
          createdAt: 1,
          latestRootBlobId: "same",
        }),
      ]);
      db.run("INSERT INTO blobs (id, data) VALUES ('same', ?)", [
        Buffer.from(JSON.stringify({ role: "user", content: "first" }), "utf-8"),
      ]);
      db.run("UPDATE blobs SET data = ? WHERE id = 'same'", [
        Buffer.from(JSON.stringify({ role: "user", content: "second" }), "utf-8"),
      ]);
      db.close();

      const out = internals(adapter).readMessages(dbPath);
      expect(out[0]!.content).toBe("second");
    });

    it("JSON blob without role produces no message row", () => {
      const sessionDir = join(chatsRoot, "w", "norole");
      createStoreDb(
        sessionDir,
        {
          agentId: "nr",
          createdAt: 1,
          latestRootBlobId: "empty",
        },
        [{ id: "empty", data: Buffer.from("{}", "utf-8") }],
      );
      expect(internals(adapter).readMessages(join(sessionDir, "store.db"))).toEqual([]);
    });

    it("binds string UTF-8 to BLOB column and still parses after Buffer.from branch", () => {
      const sessionDir = join(chatsRoot, "w", "strblob");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
        metaToHex({
          agentId: "s",
          createdAt: 1,
          latestRootBlobId: "r",
        }),
      ]);
      const jsonText = JSON.stringify({ role: "assistant", content: "string-bound" });
      db.run("INSERT INTO blobs (id, data) VALUES ('r', ?)", [jsonText]);
      db.close();

      const out = internals(adapter).readMessages(dbPath);
      expect(out.length).toBe(1);
      expect(out[0]!.content).toBe("string-bound");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. sessions()
  // ═══════════════════════════════════════════════════════════════════════

  describe("sessions()", () => {
    it("enumerates multiple workspaces and session folders with store.db", async () => {
      const meta = {
        agentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "Alpha",
        createdAt: 1000,
        latestRootBlobId: "r",
      };
      const blob = Buffer.from(JSON.stringify({ role: "user", content: "u" }), "utf-8");
      createStoreDb(join(chatsRoot, "ws-a", "sess-1"), meta, [{ id: "r", data: blob }]);
      createStoreDb(join(chatsRoot, "ws-b", "sess-2"), { ...meta, agentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Beta" }, [
        { id: "r", data: blob },
      ]);
      const sessions = await adapter.sessions();
      expect(sessions.length).toBe(2);
      const ids = sessions.map((s) => s.id).sort();
      expect(ids).toEqual([
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      ]);
      expect(sessions.every((s) => s.sourcePath.endsWith("store.db"))).toBe(true);
      expect(sessions.map((s) => s.metadata.workspace).sort()).toEqual(["ws-a", "ws-b"]);
    });

    it("returns [] when chats root directory does not exist", async () => {
      rmSync(chatsRoot, { recursive: true, force: true });
      const ghost = new TestCursorAdapter(chatsRoot);
      expect(await ghost.sessions()).toEqual([]);
    });

    it("returns [] for empty chats root", async () => {
      expect(readdirSync(chatsRoot).length).toBe(0);
      expect(await adapter.sessions()).toEqual([]);
    });

    it("skips workspace with no store.db under session folders", async () => {
      mkdirSync(join(chatsRoot, "empty-ws", "folder"), { recursive: true });
      writeFileSync(join(chatsRoot, "empty-ws", "folder", "readme.txt"), "x");
      expect(await adapter.sessions()).toEqual([]);
    });

    it("uses meta.name when set and not the default New Agent", async () => {
      createStoreDb(
        join(chatsRoot, "w", "s1"),
        {
          agentId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          name: "Custom title",
          createdAt: 1,
          latestRootBlobId: "r",
        },
        [{ id: "r", data: Buffer.from(JSON.stringify({ role: "assistant", content: "x" }), "utf-8") }],
      );
      const sessions = await adapter.sessions();
      expect(sessions[0]!.name).toBe("Custom title");
    });

    it("falls back to first user message when name is New Agent", async () => {
      const longUser = "this is the user prompt text that should appear in the session name";
      createStoreDb(
        join(chatsRoot, "w", "s2"),
        {
          agentId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
          name: "New Agent",
          createdAt: 1,
          latestRootBlobId: "r2",
        },
        [
          {
            id: "r2",
            data: Buffer.from(JSON.stringify({ role: "user", content: longUser }), "utf-8"),
          },
        ],
      );
      const sessions = await adapter.sessions();
      expect(sessions[0]!.name).toBe(longUser.slice(0, 50));
    });

    it("falls back to session directory prefix when name is New Agent and no user content", async () => {
      const dirId = "abcdef12-3456-7890-abcd-ef1234567890";
      createStoreDb(
        join(chatsRoot, "w", dirId),
        {
          agentId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
          name: "New Agent",
          createdAt: 1,
          latestRootBlobId: "r3",
        },
        [
          {
            id: "r3",
            data: Buffer.from(JSON.stringify({ role: "assistant", content: "only assistant" }), "utf-8"),
          },
        ],
      );
      const sessions = await adapter.sessions();
      expect(sessions[0]!.name).toBe(dirId.slice(0, 8));
    });

    it("skips sessions where readSessionMeta returns null", async () => {
      const sessionDir = join(chatsRoot, "w", "bad-meta");
      mkdirSync(sessionDir, { recursive: true });
      const dbPath = join(sessionDir, "store.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
      db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
      db.run("INSERT INTO meta (key, value) VALUES ('0', 'gg')");
      db.close();
      expect(await adapter.sessions()).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. messages() — end-to-end + timestamp interpolation
  // ═══════════════════════════════════════════════════════════════════════

  describe("messages()", () => {
    it("loads messages via session folder id and interpolates timestamps from createdAt to mtime", async () => {
      const sessionId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      const sessionDir = join(chatsRoot, "proj", sessionId);
      const tStart = Date.UTC(2020, 5, 1, 0, 0, 0);
      const tEnd = Date.UTC(2020, 5, 1, 0, 0, 30);
      createStoreDb(
        sessionDir,
        {
          agentId: sessionId,
          name: "E2E",
          createdAt: tStart,
          latestRootBlobId: "leaf",
        },
        [
          {
            id: "root",
            data: Buffer.from(JSON.stringify({ role: "user", content: "first" }), "utf-8"),
          },
          {
            id: "leaf",
            data: Buffer.from(
              JSON.stringify({ role: "assistant", content: "second", parentId: "root" }),
              "utf-8",
            ),
          },
        ],
      );
      const dbPath = join(sessionDir, "store.db");
      utimesSync(dbPath, new Date(tEnd), new Date(tEnd));

      const sessions = await adapter.sessions();
      expect(sessions.some((s) => s.id === sessionId)).toBe(true);

      const messages = await adapter.messages(sessionId);
      expect(messages.length).toBe(2);
      expect(messages[0]!.content).toBe("first");
      expect(messages[1]!.content).toBe("second");
      expect(messages[0]!.timestamp).toBe(new Date(tStart).toISOString());
      expect(messages[1]!.timestamp).toBe(new Date(tEnd).toISOString());
    });

    it("returns [] when sessionId does not match any session directory", async () => {
      createStoreDb(
        join(chatsRoot, "w", "real-id"),
        {
          agentId: "99999999-9999-9999-9999-999999999999",
          name: "X",
          createdAt: 1,
          latestRootBlobId: "r",
        },
        [{ id: "r", data: Buffer.from(JSON.stringify({ role: "user", content: "z" }), "utf-8") }],
      );
      expect(await adapter.messages("nonexistent-id")).toEqual([]);
    });

    it("findSessionDb uses session folder name; agentId alone fails without sourcePath", async () => {
      const folderName = "folder-uuid-1111";
      const agentIdMeta = "agent-uuid-2222";
      const dbPath = createStoreDb(
        join(chatsRoot, "w", folderName),
        {
          agentId: agentIdMeta,
          name: "Split",
          createdAt: 1,
          latestRootBlobId: "r",
        },
        [{ id: "r", data: Buffer.from(JSON.stringify({ role: "user", content: "q" }), "utf-8") }],
      );
      const byFolder = await adapter.messages(folderName);
      expect(byFolder.length).toBe(1);
      const byAgent = await adapter.messages(agentIdMeta);
      expect(byAgent.length).toBe(0);
    });

    it("when sourcePath is provided, loads that store.db even if sessionId does not match folder name", async () => {
      const folderName = "folder-uuid-1111";
      const agentIdMeta = "agent-uuid-2222";
      const dbPath = createStoreDb(
        join(chatsRoot, "w", folderName),
        {
          agentId: agentIdMeta,
          name: "Split",
          createdAt: 1,
          latestRootBlobId: "r",
        },
        [{ id: "r", data: Buffer.from(JSON.stringify({ role: "user", content: "via-path" }), "utf-8") }],
      );
      const msgs = await adapter.messages(agentIdMeta, dbPath);
      expect(msgs.length).toBe(1);
      expect(msgs[0]!.content).toBe("via-path");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. detect()
  // ═══════════════════════════════════════════════════════════════════════

  describe("detect()", () => {
    it("returns false when chats directory does not exist", async () => {
      rmSync(chatsRoot, { recursive: true, force: true });
      const ghost = new TestCursorAdapter(chatsRoot);
      expect(await ghost.detect()).toBe(false);
    });

    it("returns false when chats directory is empty", async () => {
      expect(await adapter.detect()).toBe(false);
    });

    it("returns false when workspace has no store.db", async () => {
      mkdirSync(join(chatsRoot, "only-ws"), { recursive: true });
      expect(await adapter.detect()).toBe(false);
    });

    it("returns true when at least one workspace contains session/store.db", async () => {
      createMetaOnlyDb(join(chatsRoot, "p", "s"), {
        agentId: "a",
        createdAt: 1,
      });
      expect(await adapter.detect()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. watchPaths()
  // ═══════════════════════════════════════════════════════════════════════

  describe("watchPaths()", () => {
    it("returns [] when chats root does not exist", () => {
      rmSync(chatsRoot, { recursive: true, force: true });
      const ghost = new TestCursorAdapter(chatsRoot);
      expect(ghost.watchPaths()).toEqual([]);
    });

    it("returns [chatsDir] when the directory exists", () => {
      expect(adapter.watchPaths()).toEqual([chatsRoot]);
    });
  });
});

// Helper: create empty meta/blobs tables then set hex value (for non-JSON hex test)
function insertMetaRowAfterCreate(sessionDir: string, hexValue: string): void {
  mkdirSync(sessionDir, { recursive: true });
  const dbPath = join(sessionDir, "store.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
  db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [hexValue]);
  db.close();
}
