import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CursorAdapter } from "../src/adapters/cursor";

const LAYER3_ROOT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LAYER3_NESTED_ROOT_ID = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const LAYER3_USER_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const LAYER3_ASSISTANT_ID = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const LAYER3_TOOL_RESULT_ID =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const LAYER3_FINAL_ID = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const LAYER3_TOOL_CALL_ID = "toolu_cursor_live_read";

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
    expect(childBundle.messages[1]?.thinkingContent).toBe(
      "Trace the adapter state.",
    );
    expect(childBundle.messages[1]?.recordType).toBe("");
    expect(childBundle.conversation.cwd).toBe(
      "/Users/edenmendel/Documents/GitHub/jin",
    );

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

  it("loads live-style Layer 3 pointer roots and stitches tool results onto the prior assistant message", async () => {
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
      `cli-session:${LAYER3_USER_ID}`,
      `cli-session:${LAYER3_ASSISTANT_ID}`,
      `cli-session:${LAYER3_FINAL_ID}`,
    ]);
    expect(bundle.messages[0]?.turn).toBe(0);
    expect(bundle.messages[1]?.turn).toBe(0);
    expect(bundle.messages[2]?.turn).toBe(0);
    expect(bundle.messages[1]?.toolUses[0]?.id).toBe(
      `cli-session:${LAYER3_TOOL_CALL_ID}`,
    );
    expect(bundle.messages[1]?.toolUses[0]?.name).toBe("Read");
    expect(bundle.messages[1]?.toolUses[0]?.output).toBe(
      "export const ok = true;",
    );
    expect(bundle.messages[1]?.content).toBe("Thinking through the workspace");
    expect(bundle.messages[1]?.thinkingContent).toBe(
      "Thinking through the workspace",
    );
    expect(bundle.messages[1]?.thinkingTokens).toBe(0);
    expect(bundle.messages[2]?.content).toBe("Done reading the file.");
    expect(bundleAgain.conversation.id).toBe(bundle.conversation.id);
  });

  it("prefixes Layer 3 message ids by conversation so content-addressed blobs stay unique across sessions", async () => {
    seedLayer3Session(join(chatsDir, "workspace-a", "cli-session"));
    seedLayer3Session(join(chatsDir, "workspace-a", "cli-session-copy"), {
      sessionId: "cli-session-copy",
    });
    const adapter = makeAdapter(chatsDir, stateDbPath);

    const refs = await adapter.findChanged({ kind: "startup-scan" });
    const first = refs.find((ref) => ref.id === "cli-session");
    const second = refs.find((ref) => ref.id === "cli-session-copy");

    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const firstBundle = await adapter.loadConversation(first!);
    const secondBundle = await adapter.loadConversation(second!);

    expect(firstBundle).not.toBeNull();
    expect(secondBundle).not.toBeNull();

    if (!firstBundle || !secondBundle) {
      throw new Error("expected both Cursor layer3 bundles to load");
    }

    expect(firstBundle.messages[0]?.id).toBe(`cli-session:${LAYER3_USER_ID}`);
    expect(secondBundle.messages[0]?.id).toBe(
      `cli-session-copy:${LAYER3_USER_ID}`,
    );
    expect(firstBundle.messages[0]?.id).not.toBe(secondBundle.messages[0]?.id);
    expect(firstBundle.messages[1]?.toolUses[0]?.id).toBe(
      `cli-session:${LAYER3_TOOL_CALL_ID}`,
    );
    expect(secondBundle.messages[1]?.toolUses[0]?.id).toBe(
      `cli-session-copy:${LAYER3_TOOL_CALL_ID}`,
    );
  });

  it("matches repeated same-name Layer 3 tool results by toolCallId before falling back to tool name", async () => {
    seedLayer3RepeatedToolSession(
      join(chatsDir, "workspace-a", "cli-session-repeated-tools"),
    );
    const adapter = makeAdapter(chatsDir, stateDbPath);

    const ref = (
      await adapter.findChanged({ kind: "startup-scan" })
    ).find((conversationRef) => conversationRef.id === "cli-session-repeated-tools");
    expect(ref).toBeDefined();

    const bundle = ref ? await adapter.loadConversation(ref) : null;
    expect(bundle).not.toBeNull();

    if (!bundle) {
      throw new Error("expected repeated-tool Cursor bundle to load");
    }

    expect(bundle.messages[1]?.toolUses.map((toolUse) => toolUse.id)).toEqual([
      "cli-session-repeated-tools:read-0",
      "cli-session-repeated-tools:read-1",
      "cli-session-repeated-tools:read-2",
    ]);
    expect(
      bundle.messages[1]?.toolUses.map((toolUse) => toolUse.output),
    ).toEqual(["first file", "second file", "third file"]);
  });

  it("searches older Layer 3 messages by toolCallId before falling back to newer same-name tools", async () => {
    seedLayer3LateToolResultSession(
      join(chatsDir, "workspace-a", "cli-session-late-tool-result"),
    );
    const adapter = makeAdapter(chatsDir, stateDbPath);

    const ref = (
      await adapter.findChanged({ kind: "startup-scan" })
    ).find((conversationRef) => conversationRef.id === "cli-session-late-tool-result");
    expect(ref).toBeDefined();

    const bundle = ref ? await adapter.loadConversation(ref) : null;
    expect(bundle).not.toBeNull();

    if (!bundle) {
      throw new Error("expected late-tool-result Cursor bundle to load");
    }

    expect(bundle.messages[1]?.toolUses[0]?.id).toBe(
      "cli-session-late-tool-result:read-older",
    );
    expect(bundle.messages[1]?.toolUses[0]?.output).toBe("older output");
    expect(bundle.messages[2]?.toolUses[0]?.id).toBe(
      "cli-session-late-tool-result:read-newer",
    );
    expect(bundle.messages[2]?.toolUses[0]?.output).toBe("");
  });

  it("skips the synthetic Cursor session prelude when naming Layer 3 conversations", async () => {
    seedLayer3PreludeSession(join(chatsDir, "workspace-a", "cli-session-prelude"));
    const adapter = makeAdapter(chatsDir, stateDbPath);

    const ref = (
      await adapter.findChanged({ kind: "startup-scan" })
    ).find((conversationRef) => conversationRef.id === "cli-session-prelude");
    expect(ref).toBeDefined();

    const bundle = ref ? await adapter.loadConversation(ref) : null;
    expect(bundle).not.toBeNull();

    if (!bundle) {
      throw new Error("expected prelude Cursor bundle to load");
    }

    expect(bundle.conversation.name).toBe("Summarize the adapter regressions.");
  });

  it("preserves user-authored wrapper-like tags when they are not a leading synthetic prelude", async () => {
    seedLayer3LiteralWrapperSession(
      join(chatsDir, "workspace-a", "cli-session-literal-tags"),
    );
    const adapter = makeAdapter(chatsDir, stateDbPath);

    const ref = (
      await adapter.findChanged({ kind: "startup-scan" })
    ).find((conversationRef) => conversationRef.id === "cli-session-literal-tags");
    expect(ref).toBeDefined();

    const bundle = ref ? await adapter.loadConversation(ref) : null;
    expect(bundle).not.toBeNull();

    if (!bundle) {
      throw new Error("expected literal-tag Cursor bundle to load");
    }

    expect(bundle.conversation.name).toBe(
      "Keep literal <rules>do-not-strip</rules> and <user_query>tag</user_query> text.",
    );
  });

  it("unwraps top-level user_query envelopes without stripping embedded user-authored tags", async () => {
    seedLayer3UserQueryEnvelopeSession(
      join(chatsDir, "workspace-a", "cli-session-user-query-envelope"),
    );
    const adapter = makeAdapter(chatsDir, stateDbPath);

    const ref = (
      await adapter.findChanged({ kind: "startup-scan" })
    ).find((conversationRef) => conversationRef.id === "cli-session-user-query-envelope");
    expect(ref).toBeDefined();

    const bundle = ref ? await adapter.loadConversation(ref) : null;
    expect(bundle).not.toBeNull();

    if (!bundle) {
      throw new Error("expected user-query-envelope Cursor bundle to load");
    }

    expect(bundle.conversation.name).toBe("Say hello from a wrapped query.");
  });

  it("warns and continues with Layer 3 discovery when the shared Layer 1 DB path exists but cannot be opened", async () => {
    seedLayer3Session(join(chatsDir, "workspace-a", "cli-session"));
    const unreadableLayer1Path = join(rootDir, "not-a-db");
    mkdirSync(unreadableLayer1Path, { recursive: true });

    const adapter = makeAdapter(chatsDir, unreadableLayer1Path);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args.map(String).join(" "));
    };

    try {
      expect(await adapter.detect()).toBe(true);
      const refs = await adapter.findChanged({ kind: "startup-scan" });
      expect(refs.map((ref) => ref.id)).toEqual(["cli-session"]);
    } finally {
      console.warn = originalWarn;
    }

    expect(
      warnings.some((warning) =>
        warning.includes("Failed to open SQLite database"),
      ),
    ).toBe(true);
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
      workspaceUris: ["file:///Users/edenmendel/Documents/GitHub/jin"],
      workspaceProjectDir:
        "/Users/edenmendel/.cursor/projects/Users-edenmendel-Documents-GitHub-jin",
      tokenCount: { inputTokens: 8, outputTokens: 0 },
    });
    upsertCursorKv(dbPath, "bubbleId:child-session:child-assistant", {
      type: 2,
      text: "I found the adapter logic.",
      createdAt: "2026-04-02T00:05:30.000Z",
      workspaceUris: ["file:///Users/edenmendel/Documents/GitHub/jin"],
      workspaceProjectDir:
        "/Users/edenmendel/.cursor/projects/Users-edenmendel-Documents-GitHub-jin",
      thinking: {
        text: "Trace the adapter state.",
        signature: "cursor-thinking-signature",
      },
      thinkingDurationMs: 365,
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

function seedLayer3Session(
  sessionDir: string,
  options: { sessionId?: string } = {},
): string {
  const sessionId = options.sessionId ?? "cli-session";
  mkdirSync(sessionDir, { recursive: true });
  const dbPath = join(sessionDir, "store.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
  db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
    encodeHexJson({
      agentId: sessionId,
      latestRootBlobId: LAYER3_ROOT_ID,
      name: "New Agent",
      mode: "search",
      createdAt: 1774308018582,
    }),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_ROOT_ID,
    encodeLayer3PointerBlob([LAYER3_USER_ID, LAYER3_NESTED_ROOT_ID]),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_NESTED_ROOT_ID,
    encodeLayer3PointerBlob([
      LAYER3_ASSISTANT_ID,
      LAYER3_TOOL_RESULT_ID,
      LAYER3_FINAL_ID,
    ]),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_USER_ID,
    Buffer.from(
      JSON.stringify({
        role: "user",
        content: "List the adapter files",
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_ASSISTANT_ID,
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking through the workspace" },
          {
            type: "tool-call",
            toolCallId: LAYER3_TOOL_CALL_ID,
            toolName: "Read",
            args: { path: "src/index.ts" },
          },
        ],
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_TOOL_RESULT_ID,
    Buffer.from(
      JSON.stringify({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: LAYER3_TOOL_CALL_ID,
            toolName: "Read",
            result: "export const ok = true;",
          },
        ],
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_FINAL_ID,
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        content: [{ type: "text", text: "Done reading the file." }],
      }),
      "utf-8",
    ),
  ]);
  db.close();

  const updatedTime = new Date("2026-04-02T00:10:00.000Z");
  utimesSync(dbPath, updatedTime, updatedTime);

  return dbPath;
}

function seedLayer3RepeatedToolSession(sessionDir: string): string {
  mkdirSync(sessionDir, { recursive: true });
  const dbPath = join(sessionDir, "store.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
  db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
    encodeHexJson({
      agentId: "cli-session-repeated-tools",
      latestRootBlobId: LAYER3_ROOT_ID,
      name: "New Agent",
      mode: "search",
      createdAt: 1774308018582,
    }),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_ROOT_ID,
    encodeLayer3PointerBlob([LAYER3_USER_ID, LAYER3_NESTED_ROOT_ID]),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_NESTED_ROOT_ID,
    encodeLayer3PointerBlob([
      LAYER3_ASSISTANT_ID,
      LAYER3_TOOL_RESULT_ID,
      LAYER3_FINAL_ID,
    ]),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_USER_ID,
    Buffer.from(
      JSON.stringify({
        role: "user",
        content: "Inspect repeated Layer 3 tool results.",
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_ASSISTANT_ID,
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "read-0",
            toolName: "Read",
            args: { path: "src/a.ts" },
          },
          {
            type: "tool-call",
            toolCallId: "read-1",
            toolName: "Read",
            args: { path: "src/b.ts" },
          },
          {
            type: "tool-call",
            toolCallId: "read-2",
            toolName: "Read",
            args: { path: "src/c.ts" },
          },
        ],
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_TOOL_RESULT_ID,
    Buffer.from(
      JSON.stringify({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "read-0",
            toolName: "Read",
            result: "first file",
          },
          {
            type: "tool-result",
            toolCallId: "read-1",
            toolName: "Read",
            result: "second file",
          },
          {
            type: "tool-result",
            toolCallId: "read-2",
            toolName: "Read",
            result: "third file",
          },
        ],
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_FINAL_ID,
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        content: [{ type: "text", text: "All files inspected." }],
      }),
      "utf-8",
    ),
  ]);
  db.close();

  const updatedTime = new Date("2026-04-02T02:10:00.000Z");
  utimesSync(dbPath, updatedTime, updatedTime);

  return dbPath;
}

function seedLayer3LateToolResultSession(sessionDir: string): string {
  const userId = "1212121212121212121212121212121212121212121212121212121212121212";
  const assistantOlderId =
    "1313131313131313131313131313131313131313131313131313131313131313";
  const assistantNewerId =
    "1414141414141414141414141414141414141414141414141414141414141414";
  const toolResultId =
    "1515151515151515151515151515151515151515151515151515151515151515";
  const finalId = "1616161616161616161616161616161616161616161616161616161616161616";

  mkdirSync(sessionDir, { recursive: true });
  const dbPath = join(sessionDir, "store.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
  db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
    encodeHexJson({
      agentId: "cli-session-late-tool-result",
      latestRootBlobId: LAYER3_ROOT_ID,
      name: "New Agent",
      mode: "search",
      createdAt: 1774308018582,
    }),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_ROOT_ID,
    encodeLayer3PointerBlob([userId, LAYER3_NESTED_ROOT_ID]),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_NESTED_ROOT_ID,
    encodeLayer3PointerBlob([
      assistantOlderId,
      assistantNewerId,
      toolResultId,
      finalId,
    ]),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    userId,
    Buffer.from(
      JSON.stringify({
        role: "user",
        content: "Attach this tool result to the older tool call.",
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    assistantOlderId,
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "read-older",
            toolName: "Read",
            args: { path: "src/older.ts" },
          },
        ],
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    assistantNewerId,
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "read-newer",
            toolName: "Read",
            args: { path: "src/newer.ts" },
          },
        ],
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    toolResultId,
    Buffer.from(
      JSON.stringify({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "read-older",
            toolName: "Read",
            result: "older output",
          },
        ],
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    finalId,
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        content: [{ type: "text", text: "Applied the tool result." }],
      }),
      "utf-8",
    ),
  ]);
  db.close();

  const updatedTime = new Date("2026-04-02T02:40:00.000Z");
  utimesSync(dbPath, updatedTime, updatedTime);

  return dbPath;
}

function seedLayer3PreludeSession(sessionDir: string): string {
  const preludeUserId =
    "1111111111111111111111111111111111111111111111111111111111111111";
  const promptUserId =
    "2222222222222222222222222222222222222222222222222222222222222222";
  const assistantId =
    "3333333333333333333333333333333333333333333333333333333333333333";
  mkdirSync(sessionDir, { recursive: true });
  const dbPath = join(sessionDir, "store.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
  db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
    encodeHexJson({
      agentId: "cli-session-prelude",
      latestRootBlobId: LAYER3_ROOT_ID,
      name: "New Agent",
      mode: "search",
      createdAt: 1774308018582,
    }),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_ROOT_ID,
    encodeLayer3PointerBlob([preludeUserId, LAYER3_NESTED_ROOT_ID]),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_NESTED_ROOT_ID,
    encodeLayer3PointerBlob([promptUserId, assistantId]),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    preludeUserId,
    Buffer.from(
      JSON.stringify({
        role: "user",
        content:
          "<user_info>\nOS Version: darwin 25.2.0\n</user_info>\n\n<git_status>\n## main\n</git_status>",
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    promptUserId,
    Buffer.from(
      JSON.stringify({
        role: "user",
        content:
          "<rules>\nFollow all instructions.\n</rules>\n\n<user_query>Summarize the adapter regressions.</user_query>",
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    assistantId,
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        content: [{ type: "text", text: "Cursor still needs two follow-ups." }],
      }),
      "utf-8",
    ),
  ]);
  db.close();

  const updatedTime = new Date("2026-04-02T03:10:00.000Z");
  utimesSync(dbPath, updatedTime, updatedTime);

  return dbPath;
}

function seedLayer3LiteralWrapperSession(sessionDir: string): string {
  const userId = "1717171717171717171717171717171717171717171717171717171717171717";
  const assistantId =
    "1818181818181818181818181818181818181818181818181818181818181818";

  mkdirSync(sessionDir, { recursive: true });
  const dbPath = join(sessionDir, "store.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
  db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
    encodeHexJson({
      agentId: "cli-session-literal-tags",
      latestRootBlobId: LAYER3_ROOT_ID,
      name: "New Agent",
      mode: "search",
      createdAt: 1774308018582,
    }),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_ROOT_ID,
    encodeLayer3PointerBlob([userId, assistantId]),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    userId,
    Buffer.from(
      JSON.stringify({
        role: "user",
        content:
          "Keep literal <rules>do-not-strip</rules> and <user_query>tag</user_query> text.",
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    assistantId,
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        content: [{ type: "text", text: "Using literal tags in the prompt." }],
      }),
      "utf-8",
    ),
  ]);
  db.close();

  const updatedTime = new Date("2026-04-02T03:20:00.000Z");
  utimesSync(dbPath, updatedTime, updatedTime);

  return dbPath;
}

function seedLayer3UserQueryEnvelopeSession(sessionDir: string): string {
  const userId = "1919191919191919191919191919191919191919191919191919191919191919";
  const assistantId =
    "2020202020202020202020202020202020202020202020202020202020202020";

  mkdirSync(sessionDir, { recursive: true });
  const dbPath = join(sessionDir, "store.db");
  const db = new Database(dbPath);
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");
  db.run("INSERT INTO meta (key, value) VALUES ('0', ?)", [
    encodeHexJson({
      agentId: "cli-session-user-query-envelope",
      latestRootBlobId: LAYER3_ROOT_ID,
      name: "New Agent",
      mode: "search",
      createdAt: 1774308018582,
    }),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    LAYER3_ROOT_ID,
    encodeLayer3PointerBlob([userId, assistantId]),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    userId,
    Buffer.from(
      JSON.stringify({
        role: "user",
        content: "<user_query>Say hello from a wrapped query.</user_query>",
      }),
      "utf-8",
    ),
  ]);
  db.run("INSERT INTO blobs (id, data) VALUES (?, ?)", [
    assistantId,
    Buffer.from(
      JSON.stringify({
        role: "assistant",
        content: [{ type: "text", text: "Hello there." }],
      }),
      "utf-8",
    ),
  ]);
  db.close();

  const updatedTime = new Date("2026-04-02T03:30:00.000Z");
  utimesSync(dbPath, updatedTime, updatedTime);

  return dbPath;
}

function updateLayer3AssistantMessage(
  dbPath: string,
  payload: Record<string, unknown>,
): void {
  const db = new Database(dbPath);
  db.run("UPDATE blobs SET data = ? WHERE id = ?", [
    Buffer.from(JSON.stringify(payload), "utf-8"),
    LAYER3_ASSISTANT_ID,
  ]);
  db.close();
}

function encodeHexJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("hex");
}

function encodeLayer3PointerBlob(blobIds: string[]): Buffer {
  return Buffer.concat(
    blobIds.map((blobId) =>
      Buffer.concat([Buffer.from([0x0a, 0x20]), Buffer.from(blobId, "hex")]),
    ),
  );
}
