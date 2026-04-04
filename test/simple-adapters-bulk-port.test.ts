import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { AmpAdapter } from "../src/adapters/amp";
import { GeminiCliAdapter } from "../src/adapters/gemini-cli";
import { KiroAdapter } from "../src/adapters/kiro";
import { OpenCodeAdapter } from "../src/adapters/opencode";
import { PiAdapter } from "../src/adapters/pi";
import { PiAgentAdapter } from "../src/adapters/piagent";
import { WarpAdapter } from "../src/adapters/warp";
import type { Adapter, V2Adapter } from "../src/adapters/types";

type TestAdapter = Adapter & V2Adapter;
type SourceFormat = "json" | "jsonl" | "sqlite";

interface Harness {
  adapter: TestAdapter;
  sourcePath: string;
  sourceFormat: SourceFormat;
  expectedId?: string;
}

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("simple adapters bulk port", () => {
  const fileBackedCases: Array<{ name: string; setup: () => Harness }> = [
    {
      name: "AmpAdapter",
      setup: () => {
        const root = makeTempRoot("jin-amp-");
        const sessionsDir = join(root, "amp", "threads");
        const sourcePath = join(sessionsDir, "amp-thread.jsonl");
        writeJsonl(sourcePath, [
          {
            thread_id: "amp-thread",
            role: "user",
            content: [{ text: "Review the adapter contract" }],
            timestamp: "2026-04-01T10:00:00.000Z",
            cwd: "/tmp/amp-project",
          },
          {
            thread_id: "amp-thread",
            role: "assistant",
            content: [{ text: "Reviewing the adapter contract." }],
            timestamp: "2026-04-01T10:00:01.000Z",
            model: "amp-model",
          },
        ]);

        return {
          adapter: new AmpAdapter(sessionsDir),
          sourcePath,
          sourceFormat: "jsonl",
          expectedId: "amp-thread",
        };
      },
    },
    {
      name: "GeminiCliAdapter",
      setup: () => {
        const root = makeTempRoot("jin-gemini-");
        const sourcePath = join(root, "tmp", "session-gemini-thread.json");
        writeJson(sourcePath, {
          sessionId: "gemini-thread",
          startTime: "2026-04-01T11:00:00.000Z",
          lastUpdated: "2026-04-01T11:00:05.000Z",
          messages: [
            {
              id: "gemini-user",
              type: "user",
              timestamp: "2026-04-01T11:00:00.000Z",
              content: [{ text: "Summarize the current branch." }],
            },
            {
              id: "gemini-assistant",
              type: "model",
              timestamp: "2026-04-01T11:00:05.000Z",
              model: "gemini-2.5-pro",
              content: [{ text: "The branch ports the simple adapters to the v2 contract." }],
            },
          ],
        });

        return {
          adapter: new GeminiCliAdapter(root),
          sourcePath,
          sourceFormat: "json",
          expectedId: "gemini-thread",
        };
      },
    },
    {
      name: "OpenCodeAdapter",
      setup: () => {
        const root = makeTempRoot("jin-opencode-");
        const storageDir = join(root, "storage");
        const sourcePath = join(storageDir, "sessions", "opencode-thread.json");
        writeJson(sourcePath, {
          id: "opencode-thread",
          cwd: "/tmp/opencode-project",
          messages: [
            {
              id: "oc-user",
              role: "user",
              timestamp: "2026-04-01T12:00:00.000Z",
              content: "Inspect the generated diff.",
            },
            {
              id: "oc-assistant",
              role: "assistant",
              timestamp: "2026-04-01T12:00:03.000Z",
              model: "opencode-model",
              content: "The diff is scoped to adapter files and tests.",
            },
          ],
        });

        return {
          adapter: new OpenCodeAdapter(storageDir),
          sourcePath,
          sourceFormat: "json",
          expectedId: "opencode-thread",
        };
      },
    },
    {
      name: "PiAdapter",
      setup: () => {
        const root = makeTempRoot("jin-pi-");
        const sessionsDir = join(root, "pi", "sessions");
        const sourcePath = join(sessionsDir, "pi-thread.jsonl");
        writeJsonl(sourcePath, [
          {
            session_id: "pi-thread",
            role: "user",
            content: "Map the conversation fields.",
            timestamp: "2026-04-01T13:00:00.000Z",
            cwd: "/tmp/pi-project",
          },
          {
            session_id: "pi-thread",
            role: "assistant",
            content: "Mapped the conversation fields.",
            timestamp: "2026-04-01T13:00:04.000Z",
            model: "pi-model",
          },
        ]);

        return {
          adapter: new PiAdapter(sessionsDir),
          sourcePath,
          sourceFormat: "jsonl",
          expectedId: "pi-thread",
        };
      },
    },
    {
      name: "PiAgentAdapter",
      setup: () => {
        const root = makeTempRoot("jin-piagent-");
        const sessionsDir = join(root, "piagent", "sessions");
        const sourcePath = join(sessionsDir, "piagent-thread.jsonl");
        writeJsonl(sourcePath, [
          {
            session_id: "piagent-thread",
            type: "user",
            message: { content: "Validate the handoff report." },
            timestamp: "2026-04-01T14:00:00.000Z",
            cwd: "/tmp/piagent-project",
          },
          {
            session_id: "piagent-thread",
            type: "assistant",
            message: { content: "The handoff report is valid.", model: "piagent-model" },
            timestamp: "2026-04-01T14:00:02.000Z",
          },
        ]);

        return {
          adapter: new PiAgentAdapter(sessionsDir),
          sourcePath,
          sourceFormat: "jsonl",
          expectedId: "piagent-thread",
        };
      },
    },
  ];

  for (const scenario of fileBackedCases) {
    test(`${scenario.name} emits deterministic root bundles and preserves the legacy bridge`, async () => {
      const harness = scenario.setup();
      await assertAdapterCase(harness);
    });
  }

  test("KiroAdapter emits deterministic root bundles from a shared SQLite source", async () => {
    const root = makeTempRoot("jin-kiro-");
    const sourcePath = join(root, "data.sqlite3");
    const db = new Database(sourcePath);
    db.exec(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at TEXT,
        updated_at TEXT,
        cwd TEXT,
        model TEXT,
        message_count INTEGER
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        role TEXT,
        content TEXT,
        created_at TEXT,
        model TEXT
      );
    `);
    db.query(
      `INSERT INTO conversations (id, title, created_at, updated_at, cwd, model, message_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "kiro-thread",
      "Kiro thread",
      "2026-04-01T15:00:00.000Z",
      "2026-04-01T15:00:04.000Z",
      "/tmp/kiro-project",
      "kiro-model",
      2,
    );
    db.query(
      `INSERT INTO messages (id, conversation_id, role, content, created_at, model)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("kiro-user", "kiro-thread", "user", "Read the Kiro database.", "2026-04-01T15:00:00.000Z", "");
    db.query(
      `INSERT INTO messages (id, conversation_id, role, content, created_at, model)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "kiro-assistant",
      "kiro-thread",
      "assistant",
      "The database has one root conversation.",
      "2026-04-01T15:00:04.000Z",
      "kiro-model",
    );
    db.close();

    await assertAdapterCase({
      adapter: new KiroAdapter(sourcePath),
      sourcePath,
      sourceFormat: "sqlite",
      expectedId: "kiro-thread",
    });
  });

  test("WarpAdapter emits deterministic root bundles from grouped terminal queries", async () => {
    const root = makeTempRoot("jin-warp-");
    const sourcePath = join(root, "warp.sqlite");
    const db = new Database(sourcePath);
    db.exec(`
      CREATE TABLE ai_queries (
        working_directory TEXT,
        query TEXT,
        response TEXT,
        created_at TEXT,
        model TEXT
      );
    `);
    db.query(
      `INSERT INTO ai_queries (working_directory, query, response, created_at, model)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "/tmp/warp-project",
      "Explain the refactor plan.",
      "The refactor keeps the adapter bridge local to each file.",
      "2026-04-01T16:00:00.000Z",
      "warp-model",
    );
    db.close();

    await assertAdapterCase({
      adapter: new WarpAdapter(sourcePath),
      sourcePath,
      sourceFormat: "sqlite",
    });
  });
});

async function assertAdapterCase(harness: Harness): Promise<void> {
  expect(await harness.adapter.detect()).toBe(true);

  const startupRefs = await harness.adapter.findChanged({ kind: "startup-scan" });
  expect(startupRefs).toHaveLength(1);
  expect(startupRefs[0]?.adapterId).toBe(harness.adapter.id);
  expect(startupRefs[0]?.sourcePath).toBe(harness.sourcePath);
  if (harness.expectedId) {
    expect(startupRefs[0]?.id).toBe(harness.expectedId);
  }

  expect(await harness.adapter.findChanged({ kind: "periodic-scan" })).toEqual([]);
  expect(
    await harness.adapter.findChanged({
      kind: "fs-change",
      changedPaths: [harness.sourcePath],
    }),
  ).toEqual(startupRefs);

  const bundle1 = await harness.adapter.loadConversation(startupRefs[0]!);
  const bundle2 = await harness.adapter.loadConversation(startupRefs[0]!);
  expect(bundle1).not.toBeNull();
  expect(bundle2).not.toBeNull();

  expect(bundle1!.conversation.id).toBe(bundle2!.conversation.id);
  expect(bundle1!.conversation.traceId).toBe(bundle1!.conversation.id);
  expect(bundle1!.conversation.parentId).toBe("");
  expect(bundle1!.conversation.relationship).toBe("root");
  expect(bundle1!.conversation.forkPoint).toBe(-1);
  expect(bundle1!.conversation.sourcePath).toBe(harness.sourcePath);
  expect(bundle1!.conversation.sourceFormat).toBe(harness.sourceFormat);
  expect(bundle1!.messages.map((message) => message.id)).toEqual(
    bundle2!.messages.map((message) => message.id),
  );
  expect(bundle1!.messages.length).toBeGreaterThan(0);
  expect(bundle1!.messages[0]?.sequence).toBe(0);
  expect(bundle1!.messages[0]?.turn).toBe(0);
  expect(bundle1!.messages.every((message) => message.timestamp.length > 0)).toBe(true);

  const sessions = await harness.adapter.sessions();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.id).toBe(bundle1!.conversation.id);
  expect(sessions[0]?.sourcePath).toBe(harness.sourcePath);

  const messages = await harness.adapter.messages(bundle1!.conversation.id, harness.sourcePath);
  expect(messages.map((message) => message.id)).toEqual(bundle1!.messages.map((message) => message.id));
}

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath: string, values: unknown[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf8",
  );
}
