import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CursorAdapter } from "../src/adapters/cursor";

describe("W2-ADAPTER-03 Cursor reference adapter", () => {
  let rootDir: string;
  let chatsDir: string;
  let stateDbPath: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "jin-cursor-reference-"));
    chatsDir = join(rootDir, "chats");
    stateDbPath = join(rootDir, "state.vscdb");
    mkdirSync(chatsDir, { recursive: true });
    createStateDb(stateDbPath);
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("detects both Cursor storage roots and reports the watch paths", async () => {
    seedLayer1ParentAndChild(stateDbPath, { includeChild: false });
    seedLayer3Session(join(chatsDir, "workspace-a", "cli-session"));

    const adapter = makeAdapter(chatsDir, stateDbPath);

    expect(await adapter.detect()).toBe(true);
    expect(adapter.watchPaths().sort()).toEqual([chatsDir, rootDir].sort());
  });

  it("tracks shared-db changes without assuming pipeline cache state", async () => {
    const parentId = seedLayer1ParentAndChild(stateDbPath, { includeChild: false });
    const adapter = makeAdapter(chatsDir, stateDbPath);

    const startupRefs = await adapter.findChanged({ kind: "startup-scan" });
    expect(startupRefs.map((ref) => ref.id)).toEqual([parentId]);

    expect(await adapter.findChanged({ kind: "periodic-scan" })).toEqual([]);

    const childId = "child-session";
    upsertCursorKv(stateDbPath, `composerData:${parentId}`, {
      name: "Parent session",
      createdAt: "2026-04-02T00:00:00.000Z",
      lastUpdatedAt: "2026-04-02T00:06:00.000Z",
      modelConfig: { modelName: "composer-2-fast" },
      subagentComposerIds: [childId],
      fullConversationHeadersOnly: [
        { bubbleId: "parent-user", type: 1 },
        { bubbleId: "parent-spawn", type: 2 },
      ],
    });
    upsertCursorKv(stateDbPath, "bubbleId:parent-session:parent-spawn", {
      type: 2,
      text: "",
      createdAt: "2026-04-02T00:05:00.000Z",
      toolFormerData: {
        name: "task_v2",
        rawArgs: "{\"prompt\":\"Investigate child\"}",
        status: "completed",
        result: { agentId: childId },
        additionalData: { subagentComposerId: childId, status: "success" },
      },
    });
    upsertCursorKv(stateDbPath, `composerData:${childId}`, {
      name: "Child session",
      createdAt: "2026-04-02T00:05:00.000Z",
      lastUpdatedAt: "2026-04-02T00:05:30.000Z",
      modelConfig: { modelName: "composer-2" },
      subagentComposerIds: [],
      fullConversationHeadersOnly: [
        { bubbleId: "child-user", type: 1 },
        { bubbleId: "child-assistant", type: 2 },
      ],
    });
    upsertCursorKv(stateDbPath, "bubbleId:child-session:child-user", {
      type: 1,
      text: "Please inspect the repo",
      createdAt: "2026-04-02T00:05:00.000Z",
      tokenCount: { inputTokens: 12, outputTokens: 0 },
    });
    upsertCursorKv(stateDbPath, "bubbleId:child-session:child-assistant", {
      type: 2,
      text: "I found the relevant files.",
      createdAt: "2026-04-02T00:05:30.000Z",
      tokenCount: { inputTokens: 0, outputTokens: 21 },
      toolFormerData: {
        name: "glob_file_search",
        rawArgs: "{\"pattern\":\"src/**/*.ts\"}",
        status: "completed",
      },
    });

    const changedRefs = await adapter.findChanged({ kind: "periodic-scan" });
    expect(changedRefs.map((ref) => ref.id).sort()).toEqual(
      [childId, parentId].sort(),
    );
    expect(await adapter.findChanged({ kind: "periodic-scan" })).toEqual([]);
  });

  it("loads Layer 1 conversations with spawned relationship semantics and stable ids", async () => {
    const parentId = seedLayer1ParentAndChild(stateDbPath, { includeChild: true });
    const adapter = makeAdapter(chatsDir, stateDbPath);

    const refs = await adapter.findChanged({ kind: "startup-scan" });
    const childRef = refs.find((ref) => ref.id === "child-session");
    const parentRef = refs.find((ref) => ref.id === parentId);
    expect(childRef).toBeDefined();
    expect(parentRef).toBeDefined();

    const childBundle = await adapter.loadConversation(childRef!);
    const childBundleAgain = await adapter.loadConversation(childRef!);
    const parentBundle = await adapter.loadConversation(parentRef!);

    expect(childBundle).not.toBeNull();
    expect(childBundleAgain).not.toBeNull();
    expect(parentBundle).not.toBeNull();

    if (!childBundle || !childBundleAgain || !parentBundle) {
      throw new Error("expected Cursor bundles to load");
    }

    expect(childBundle.conversation.id).toBe("child-session");
    expect(childBundle.conversation.relationship).toBe("spawned");
    expect(childBundle.conversation.parentId).toBe(parentId);
    expect(childBundle.conversation.traceId).toBe(parentId);
    expect(childBundle.conversation.forkPoint).toBe(1);
    expect(childBundle.messages[0]?.id).toBe("child-user");
    expect(childBundle.messages[1]?.id).toBe("child-assistant");
    expect(childBundle.messages[0]?.turn).toBe(0);
    expect(childBundle.messages[1]?.turn).toBe(0);
    expect(childBundle.messages[1]?.toolUses[0]?.id).toBe(
      `${childRef!.id}:child-assistant:tool:1`,
    );
    expect(childBundle.messages[1]?.toolUses[0]?.name).toBe(
      "glob_file_search",
    );
    expect(childBundle.messages[1]?.outputTokens).toBe(21);
    expect(childBundle.messages[1]?.thinkingTokens).toBe(0);
    expect(childBundle.messages[1]?.recordType).toBe("");

    expect(childBundleAgain.conversation.id).toBe(childBundle.conversation.id);
    expect(childBundleAgain.messages.map((message) => message.id)).toEqual(
      childBundle.messages.map((message) => message.id),
    );

    expect(parentBundle.messages[1]?.turn).toBe(0);
    expect(parentBundle.messages[1]?.toolUses[0]?.name).toBe("task_v2");
    expect(parentBundle.messages[1]?.toolUses[0]?.output).toContain(
      "\"agentId\":\"child-session\"",
    );
  });

  it("tracks Layer 3 store.db changes by file stats and keeps ref ids stable", async () => {
    const dbPath = seedLayer3Session(join(chatsDir, "workspace-a", "cli-session"));
    const adapter = makeAdapter(chatsDir, stateDbPath);

    const startupRefs = await adapter.findChanged({ kind: "startup-scan" });
    expect(startupRefs.map((ref) => ref.id)).toEqual(["cli-session"]);
    expect(await adapter.findChanged({ kind: "periodic-scan" })).toEqual([]);

    updateLayer3AssistantMessage(dbPath, {
      role: "assistant",
      parentId: "cli-user",
      content: [
        { type: "reasoning", text: "Thinking through the workspace" },
        { type: "tool-call", toolName: "Read", args: { path: "src/index.ts" } },
        { type: "tool-result", toolName: "Read", result: "export const ok = true;" },
        { type: "text", text: "Done reading the file." },
      ],
    });

    const updatedTime = new Date("2026-04-02T01:00:00.000Z");
    utimesSync(dbPath, updatedTime, updatedTime);

    const changedRefs = await adapter.findChanged({ kind: "periodic-scan" });
    expect(changedRefs.map((ref) => ref.id)).toEqual(["cli-session"]);
    expect(changedRefs[0]?.sourcePath).toBe(dbPath);
  });

  it("loads Layer 3 bundles as root conversations and extracts representative tool calls", async () => {
    seedLayer3Session(join(chatsDir, "workspace-a", "cli-session"));
    const adapter = makeAdapter(chatsDir, stateDbPath);

    const [ref] = await adapter.findChanged({ kind: "startup-scan" });
    const bundle = await adapter.loadConversation(ref);
    const bundleAgain = await adapter.loadConversation(ref);

    expect(bundle).not.toBeNull();
    expect(bundleAgain).not.toBeNull();

    if (!bundle || !bundleAgain) {
      throw new Error("expected Layer 3 bundle to load");
    }

    expect(bundle.conversation.relationship).toBe("root");
    expect(bundle.conversation.traceId).toBe("cli-session");
    expect(bundle.messages.map((message) => message.id)).toEqual([
      "cli-user",
      "cli-assistant",
    ]);
    expect(bundle.messages[0]?.turn).toBe(0);
    expect(bundle.messages[1]?.turn).toBe(0);
    expect(bundle.messages[1]?.toolUses[0]?.id).toBe(
      "cli-assistant:tool:0",
    );
    expect(bundle.messages[1]?.toolUses[0]?.name).toBe("Read");
    expect(bundle.messages[1]?.toolUses[0]?.output).toBe(
      "export const ok = true;",
    );
    expect(bundle.messages[1]?.content).toBe(
      "Thinking through the workspace\nDone reading the file.",
    );
    expect(bundle.messages[1]?.thinkingContent).toBe(
      "Thinking through the workspace",
    );
    expect(bundle.messages[1]?.thinkingTokens).toBe(0);
    expect(bundleAgain.conversation.id).toBe(bundle.conversation.id);
  });
});

function makeAdapter(chatsDir: string, globalStorageDbPath: string): CursorAdapter {
  return new CursorAdapter({ chatsDir, globalStorageDbPath });
}

function createStateDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.run("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
  db.close();
}

function upsertCursorKv(
  dbPath: string,
  key: string,
  value: Record<string, unknown>,
): void {
  const db = new Database(dbPath);
  db.run("INSERT OR REPLACE INTO cursorDiskKV (key, value) VALUES (?, ?)", [
    key,
    JSON.stringify(value),
  ]);
  db.close();
}

function seedLayer1ParentAndChild(
  dbPath: string,
  options: { includeChild: boolean },
): string {
  const parentId = "parent-session";

  upsertCursorKv(dbPath, `composerData:${parentId}`, {
    name: "Parent session",
    createdAt: "2026-04-02T00:00:00.000Z",
    lastUpdatedAt: "2026-04-02T00:05:00.000Z",
    modelConfig: { modelName: "composer-2-fast" },
    subagentComposerIds: options.includeChild ? ["child-session"] : [],
    fullConversationHeadersOnly: [
      { bubbleId: "parent-user", type: 1 },
      { bubbleId: "parent-spawn", type: 2 },
    ],
  });
  upsertCursorKv(dbPath, "bubbleId:parent-session:parent-user", {
    type: 1,
    text: "Launch a subagent for the adapter review.",
    createdAt: "2026-04-02T00:00:00.000Z",
    tokenCount: { inputTokens: 7, outputTokens: 0 },
  });
  upsertCursorKv(dbPath, "bubbleId:parent-session:parent-spawn", {
    type: 2,
    text: "",
    createdAt: "2026-04-02T00:05:00.000Z",
    toolFormerData: {
      name: "task_v2",
      rawArgs: "{\"prompt\":\"Inspect the adapter\"}",
      status: "completed",
      result: { agentId: "child-session" },
      additionalData: { subagentComposerId: "child-session", status: "success" },
    },
  });

  if (options.includeChild) {
    upsertCursorKv(dbPath, "composerData:child-session", {
      name: "Child session",
      createdAt: "2026-04-02T00:05:00.000Z",
      lastUpdatedAt: "2026-04-02T00:05:30.000Z",
      modelConfig: { modelName: "composer-2" },
      subagentComposerIds: [],
      fullConversationHeadersOnly: [
        { bubbleId: "child-user", type: 1 },
        { bubbleId: "child-assistant", type: 2 },
      ],
    });
    upsertCursorKv(dbPath, "bubbleId:child-session:child-user", {
      type: 1,
      text: "Inspect src/adapters/cursor.ts",
      createdAt: "2026-04-02T00:05:00.000Z",
      tokenCount: { inputTokens: 8, outputTokens: 0 },
    });
    upsertCursorKv(dbPath, "bubbleId:child-session:child-assistant", {
      type: 2,
      text: "I found the adapter logic.",
      createdAt: "2026-04-02T00:05:30.000Z",
      tokenCount: { inputTokens: 0, outputTokens: 21 },
      toolFormerData: {
        name: "glob_file_search",
        rawArgs: "{\"pattern\":\"src/**/*.ts\"}",
        status: "completed",
      },
    });
  }

  return parentId;
}

function seedLayer3Session(sessionDir: string): string {
  mkdirSync(sessionDir, { recursive: true });
  const dbPath = join(sessionDir, "store.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
  db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
    encodeHexJson({
      agentId: "cli-session",
      latestRootBlobId: "cli-assistant",
      name: "New Agent",
      mode: "search",
      createdAt: 1774308018582,
    }),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    "cli-user",
    Buffer.from(
      JSON.stringify({
        role: "user",
        content: "List the adapter files",
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    "cli-assistant",
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        parentId: "cli-user",
        content: [
          { type: "reasoning", text: "Thinking through the workspace" },
          { type: "tool-call", toolName: "Read", args: { path: "src/index.ts" } },
          { type: "tool-result", toolName: "Read", result: "export const ok = true;" },
          { type: "text", text: "Done reading the file." },
        ],
      }),
      "utf-8",
    ),
  ]);
  db.close();

  const updatedTime = new Date("2026-04-02T00:10:00.000Z");
  utimesSync(dbPath, updatedTime, updatedTime);

  return dbPath;
}

function updateLayer3AssistantMessage(
  dbPath: string,
  payload: Record<string, unknown>,
): void {
  const db = new Database(dbPath);
  db.run("UPDATE blobs SET data = ? WHERE id = 'cli-assistant'", [
    Buffer.from(JSON.stringify(payload), "utf-8"),
  ]);
  db.close();
}

function encodeHexJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("hex");
}
