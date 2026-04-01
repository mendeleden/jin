import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  computeBundleHash,
  getStore,
  LATEST_USER_VERSION,
  openStoreAtPath,
  type SqliteConversationStore,
} from "../src/db";
import type {
  ConversationBundle,
  ParsedConversation,
  ParsedMessage,
  ParsedToolCall,
} from "../src/contracts/conversations";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("v2 db store spine", () => {
  test("runs migrations on open and reuses the config-dir singleton", () => {
    const dir = mkdtempSync(join(tmpdir(), "jin-db-v2-"));
    const first = getStore(dir);
    const second = getStore(dir);
    cleanups.push(createCleanup(dir, first));

    const versionRow = first.database
      .prepare("PRAGMA user_version")
      .get() as { user_version?: number } | undefined;

    expect(second).toBe(first);
    expect(first.dbPath).toBe(join(dir, "store.db"));
    expect(versionRow?.user_version).toBe(LATEST_USER_VERSION);
  });

  test("computes a deterministic bundle hash across equivalent ordering", () => {
    const firstMessage = makeMessage("m-1", {
      sequence: 2,
      toolUses: [
        makeToolCall("tc-b"),
        makeToolCall("tc-a"),
      ],
    });
    const secondMessage = makeMessage("m-0", {
      sequence: 1,
      content: "First message",
      toolUses: [makeToolCall("tc-c")],
    });

    const base = makeBundle("hash-conv", {
      messages: [firstMessage, secondMessage],
    });
    const equivalent = makeBundle("hash-conv", {
      messages: [
        {
          ...secondMessage,
          toolUses: [...secondMessage.toolUses].reverse(),
        },
        {
          ...firstMessage,
          toolUses: [...firstMessage.toolUses].reverse(),
        },
      ],
    });
    const changed = makeBundle("hash-conv", {
      messages: [
        {
          ...firstMessage,
          content: "Changed content",
        },
        secondMessage,
      ],
    });

    expect(computeBundleHash(base)).toBe(computeBundleHash(equivalent));
    expect(computeBundleHash(base)).not.toBe(computeBundleHash(changed));
  });

  test("keeps revision stable for unchanged bundles and bumps exactly once for real changes", () => {
    const { store } = createStoreEnv();
    const original = makeBundle("rev-conv", {
      messages: [
        makeMessage("rev-2", {
          sequence: 2,
          content: "world",
          toolUses: [makeToolCall("rev-tool-b"), makeToolCall("rev-tool-a")],
        }),
        makeMessage("rev-1", {
          sequence: 1,
          content: "hello",
        }),
      ],
    });

    const firstWrite = store.writeBundle(original);
    const secondWrite = store.writeBundle(
      makeBundle("rev-conv", {
        messages: [...original.messages].reverse().map((message) => ({
          ...message,
          toolUses: [...message.toolUses].reverse(),
        })),
      }),
    );
    const thirdWrite = store.writeBundle(
      makeBundle("rev-conv", {
        messages: [
          original.messages[0],
          {
            ...original.messages[1],
            content: "hello, changed",
          },
        ],
      }),
    );
    const fourthWrite = store.writeBundle(
      makeBundle("rev-conv", {
        messages: [
          {
            ...original.messages[1],
            content: "hello, changed",
          },
          original.messages[0],
        ],
      }),
    );

    expect(firstWrite).toEqual({ changed: true, revision: 1 });
    expect(secondWrite).toEqual({ changed: false, revision: 1 });
    expect(thirdWrite).toEqual({ changed: true, revision: 2 });
    expect(fourthWrite).toEqual({ changed: false, revision: 2 });
    expect(store.getRevision("rev-conv")).toBe(2);
  });

  test("uses revision mismatch instead of timestamps for push eligibility", () => {
    const { store } = createStoreEnv();
    const bundle = makeBundle("push-conv");

    store.writeBundle(bundle);
    expect(store.conversationsNeedingPush("sink-a")).toEqual(["push-conv"]);

    store.recordPushResult("push-conv", "sink-a", 1, { ok: true });
    expect(store.conversationsNeedingPush("sink-a")).toEqual([]);

    const before = readIngestedAt(store, "push-conv");
    Bun.sleepSync(5);
    const unchanged = store.writeBundle({
      ...bundle,
      messages: [...bundle.messages].reverse(),
    });
    const after = readIngestedAt(store, "push-conv");

    expect(unchanged).toEqual({ changed: false, revision: 1 });
    expect(after > before).toBe(true);
    expect(store.conversationsNeedingPush("sink-a")).toEqual([]);

    const changed = store.writeBundle(
      makeBundle("push-conv", {
        messages: [
          {
            ...bundle.messages[0],
            content: "content changed for revision two",
          },
        ],
      }),
    );

    expect(changed).toEqual({ changed: true, revision: 2 });
    expect(store.conversationsNeedingPush("sink-a")).toEqual(["push-conv"]);

    store.recordPushResult("push-conv", "sink-a", 2, {
      ok: false,
      error: "temporary failure",
    });
    expect(store.conversationsNeedingPush("sink-a")).toEqual(["push-conv"]);

    store.recordPushResult("push-conv", "sink-a", 2, { ok: true });
    expect(store.conversationsNeedingPush("sink-a")).toEqual([]);
  });

  test("allows child conversations before parents and converges orphan checks later", () => {
    const { store } = createStoreEnv();
    const child = makeBundle("child-conv", {
      conversation: {
        traceId: "root-conv",
        parentId: "root-conv",
        relationship: "spawned",
        forkPoint: 3,
      },
    });
    const root = makeBundle("root-conv");

    expect(store.writeBundle(child)).toEqual({ changed: true, revision: 1 });
    expect(store.findOrphanedConversations()).toEqual([
      {
        id: "child-conv",
        parentId: "root-conv",
        adapterId: "test-adapter",
        relationship: "spawned",
      },
    ]);

    expect(store.writeBundle(root)).toEqual({ changed: true, revision: 1 });
    expect(store.findOrphanedConversations()).toEqual([]);
    expect(store.getConversation("child-conv")?.parentId).toBe("root-conv");
  });

  test("replaces message and tool-call rows fully and refreshes FTS content", () => {
    const { store } = createStoreEnv();
    const original = makeBundle("replace-conv", {
      messages: [
        makeMessage("replace-1", {
          sequence: 1,
          content: "alpha search token",
          toolUses: [makeToolCall("replace-tool")],
        }),
        makeMessage("replace-2", {
          sequence: 2,
          content: "beta content",
        }),
      ],
    });
    const replacement = makeBundle("replace-conv", {
      messages: [
        makeMessage("replace-3", {
          sequence: 1,
          content: "gamma replacement token",
          toolUses: [],
          turn: 7,
          inputTokens: 30,
          outputTokens: 50,
        }),
      ],
    });

    store.writeBundle(original);

    const originalMessages = store.getMessages("replace-conv");
    expect(originalMessages).toHaveLength(2);
    expect(originalMessages[0].toolUses).toEqual([
      {
        ...makeToolCall("replace-tool"),
      },
    ]);
    expect(store.getToolCalls("replace-conv")).toHaveLength(1);
    expect(store.searchMessages({ query: "alpha" })).toHaveLength(1);

    store.writeBundle(replacement);

    const messages = store.getMessages("replace-conv");
    const toolCalls = store.getToolCalls("replace-conv");
    const conversation = store.getConversation("replace-conv");

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("replace-3");
    expect(messages[0].toolUses).toEqual([]);
    expect(toolCalls).toEqual([]);
    expect(conversation?.messageCount).toBe(1);
    expect(conversation?.toolCount).toBe(0);
    expect(conversation?.turnCount).toBe(7);
    expect(conversation?.inputTokens).toBe(30);
    expect(conversation?.outputTokens).toBe(50);
    expect(store.searchMessages({ query: "alpha" })).toEqual([]);
    expect(store.searchMessages({ query: "gamma" })).toHaveLength(1);
  });

  test("detects missing sync rows as an integrity failure", () => {
    const { store } = createStoreEnv();

    store.writeBundle(makeBundle("sync-conv"));
    expect(store.findConversationsMissingSync()).toEqual([]);

    store.database.run(
      "DELETE FROM _jin_sync WHERE conversation_id = ?",
      ["sync-conv"],
    );

    expect(store.findConversationsMissingSync()).toEqual(["sync-conv"]);
  });
});

function createStoreEnv(): { dir: string; store: SqliteConversationStore } {
  const dir = mkdtempSync(join(tmpdir(), "jin-db-v2-"));
  const store = openStoreAtPath(join(dir, "store.db"));
  cleanups.push(createCleanup(dir, store));
  return { dir, store };
}

function createCleanup(dir: string, store: SqliteConversationStore): () => void {
  return () => {
    try {
      store.close();
    } catch {
      // Ignore close errors during cleanup so we can still remove temp dirs.
    }

    const delays = [50, 100, 200, 400, 800];
    for (let index = 0; index < delays.length; index += 1) {
      try {
        rmSync(dir, { recursive: true, force: true });
        return;
      } catch {
        if (index < delays.length - 1) {
          Bun.sleepSync(delays[index]);
        }
      }
    }
  };
}

function readIngestedAt(store: SqliteConversationStore, conversationId: string): string {
  const row = store.database
    .prepare(
      `SELECT ingested_at
       FROM _jin_sync
       WHERE conversation_id = ?`,
    )
    .get(conversationId) as { ingested_at: string };

  return row.ingested_at;
}

function makeBundle(
  id: string,
  overrides: {
    conversation?: Partial<ParsedConversation>;
    messages?: ParsedMessage[];
  } = {},
): ConversationBundle {
  const conversation: ParsedConversation = {
    id,
    traceId: id,
    parentId: "",
    relationship: "root",
    forkPoint: -1,
    adapterId: "test-adapter",
    name: `Conversation ${id}`,
    cwd: "/tmp/project",
    gitRemote: "git@github.com:acme/test.git",
    branch: "main",
    model: "claude-sonnet-4-20250514",
    startedAt: "2026-04-01T10:00:00.000Z",
    endedAt: "2026-04-01T10:05:00.000Z",
    sourcePath: `/tmp/${id}.jsonl`,
    sourceFormat: "jsonl",
    ...overrides.conversation,
  };

  return {
    conversation,
    messages:
      overrides.messages ??
      [
        makeMessage(`${id}-m-1`, {
          content: `Message for ${id}`,
          sequence: 1,
        }),
      ],
  };
}

function makeMessage(
  id: string,
  overrides: Partial<ParsedMessage> = {},
): ParsedMessage {
  return {
    id,
    role: overrides.role ?? "assistant",
    content: overrides.content ?? `Content for ${id}`,
    recordType: overrides.recordType ?? "assistant",
    model: overrides.model ?? "claude-sonnet-4-20250514",
    sequence: overrides.sequence ?? 1,
    turn: overrides.turn ?? 1,
    isSidechain: overrides.isSidechain ?? false,
    parentMessageId: overrides.parentMessageId ?? "",
    inputTokens: overrides.inputTokens ?? 10,
    outputTokens: overrides.outputTokens ?? 20,
    cacheRead: overrides.cacheRead ?? 0,
    cacheWrite: overrides.cacheWrite ?? 0,
    thinkingContent: overrides.thinkingContent ?? "",
    thinkingTokens: overrides.thinkingTokens ?? 0,
    timestamp: overrides.timestamp ?? "2026-04-01T10:01:00.000Z",
    toolUses: overrides.toolUses ?? [],
  };
}

function makeToolCall(
  id: string,
  overrides: Partial<ParsedToolCall> = {},
): ParsedToolCall {
  return {
    id,
    name: overrides.name ?? "shell",
    input: overrides.input ?? "echo hello",
    output: overrides.output ?? "hello",
    isError: overrides.isError ?? false,
    durationMs: overrides.durationMs ?? 12,
    timestamp: overrides.timestamp ?? "2026-04-01T10:01:01.000Z",
  };
}
