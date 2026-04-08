import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code";

const PARENT_SESSION_ID = "11111111-1111-1111-1111-111111111111";
const CHILD_SESSION_ID = "22222222-2222-2222-2222-222222222222";

const createdRoots: string[] = [];

afterEach(() => {
  while (createdRoots.length > 0) {
    const root = createdRoots.pop();
    if (!root) continue;
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ClaudeCodeAdapter v2 reference contract", () => {
  test("findChanged emits deterministic refs and caches unchanged scans", async () => {
    const fixture = createFixture();
    const { adapter, parentPath } = fixture;

    expect(await adapter.detect()).toBe(true);
    expect(adapter.watchPaths()).toEqual([fixture.projectsDir]);

    const startupRefs = await adapter.findChanged({ kind: "startup-scan" });
    expect(startupRefs).toHaveLength(3);
    expect(new Set(startupRefs.map((ref) => ref.id)).size).toBe(3);

    const rootRef = startupRefs.find((ref) => ref.id === PARENT_SESSION_ID);
    expect(rootRef).toBeDefined();

    const firstLoad = await adapter.loadConversation(rootRef!);
    const secondLoad = await adapter.loadConversation(rootRef!);

    expect(firstLoad).not.toBeNull();
    expect(secondLoad).not.toBeNull();
    expect(firstLoad!.conversation.id).toBe(secondLoad!.conversation.id);
    expect(firstLoad!.messages.map((message) => message.id)).toEqual(
      secondLoad!.messages.map((message) => message.id),
    );
    expect(
      firstLoad!.messages.flatMap((message) => message.toolUses.map((toolUse) => toolUse.id)),
    ).toEqual(
      secondLoad!.messages.flatMap((message) => message.toolUses.map((toolUse) => toolUse.id)),
    );

    expect(await adapter.findChanged({ kind: "periodic-scan" })).toEqual([]);

    const targetedRefs = await adapter.findChanged({
      kind: "fs-change",
      changedPaths: [parentPath],
    });
    expect(targetedRefs).toHaveLength(2);
    expect(targetedRefs.every((ref) => ref.sourcePath === parentPath)).toBe(true);
  });

  test("compacted conversations stay split and linked", async () => {
    const fixture = createFixture();
    const refs = await fixture.adapter.findChanged({ kind: "startup-scan" });

    const rootRef = refs.find((ref) => ref.id === PARENT_SESSION_ID);
    const compactedRef = refs.find(
      (ref) => ref.sourcePath === fixture.parentPath && ref.id !== PARENT_SESSION_ID,
    );

    expect(rootRef).toBeDefined();
    expect(compactedRef).toBeDefined();

    const rootBundle = await fixture.adapter.loadConversation(rootRef!);
    const compactedBundle = await fixture.adapter.loadConversation(compactedRef!);

    expect(rootBundle).not.toBeNull();
    expect(compactedBundle).not.toBeNull();

    expect(rootBundle!.conversation.relationship).toBe("root");
    expect(rootBundle!.conversation.traceId).toBe(PARENT_SESSION_ID);
    expect(rootBundle!.conversation.parentId).toBe("");

    expect(compactedBundle!.conversation.relationship).toBe("compacted");
    expect(compactedBundle!.conversation.traceId).toBe(PARENT_SESSION_ID);
    expect(compactedBundle!.conversation.parentId).toBe(PARENT_SESSION_ID);

    expect(
      rootBundle!.messages.some((message) =>
        message.content.includes("Continue after compaction"),
      ),
    ).toBe(false);
    expect(
      compactedBundle!.messages.some((message) =>
        message.content.includes("Continue after compaction"),
      ),
    ).toBe(true);
    expect(
      compactedBundle!.messages.some((message) =>
        message.content.includes("Summary of earlier work"),
      ),
    ).toBe(true);
  });

  test("spawned conversations inherit trace and parent linkage", async () => {
    const fixture = createFixture();
    const refs = await fixture.adapter.findChanged({ kind: "startup-scan" });
    const childRef = refs.find((ref) => ref.sourcePath === fixture.childPath);

    expect(childRef).toBeDefined();

    const childBundle = await fixture.adapter.loadConversation(childRef!);
    expect(childBundle).not.toBeNull();
    expect(childBundle!.conversation.relationship).toBe("spawned");
    expect(childBundle!.conversation.traceId).toBe(PARENT_SESSION_ID);
    expect(childBundle!.conversation.parentId).toBe(PARENT_SESSION_ID);
    expect(childBundle!.conversation.forkPoint).toBe(1);
  });

  test("tool calls, thinking blocks, and full bundles are extracted without store access", async () => {
    const fixture = createFixture();
    const refs = await fixture.adapter.findChanged({ kind: "startup-scan" });
    const rootRef = refs.find((ref) => ref.id === PARENT_SESSION_ID);

    const bundle = await fixture.adapter.loadConversation(rootRef!);
    expect(bundle).not.toBeNull();
    expect(Object.keys(bundle!)).toEqual(["conversation", "messages"]);
    expect(bundle!.conversation).toEqual(
      expect.objectContaining({
        id: PARENT_SESSION_ID,
        adapterId: "claude-code",
        sourcePath: fixture.parentPath,
        sourceFormat: "jsonl",
      }),
    );

    const thinkingMessage = bundle!.messages.find((message) => message.thinkingContent);
    expect(thinkingMessage?.thinkingContent).toContain("Plan the work before using tools.");
    expect(thinkingMessage?.thinkingTokens).toBeGreaterThan(0);

    const toolMessage = bundle!.messages.find((message) => message.toolUses.length > 0);
    expect(toolMessage).toBeDefined();
    expect(toolMessage!.toolUses).toHaveLength(1);
    expect(toolMessage!.toolUses[0]).toEqual(
      expect.objectContaining({
        name: "Task",
        durationMs: -1,
        isError: false,
        timestamp: toolMessage!.timestamp,
      }),
    );
    expect(toolMessage!.toolUses[0].input).toContain(CHILD_SESSION_ID);
    expect(toolMessage!.toolUses[0].output).toContain("Spawned child");
  });

  test("discovery retains only lightweight ref indexes and load keeps one full source model", async () => {
    const fixture = createFixture({ extraRootSessions: 3 });
    const refs = await fixture.adapter.findChanged({ kind: "startup-scan" });
    const caches = fixture.adapter as unknown as {
      fileIndexCache: Map<
        string,
        {
          size: number;
          mtimeMs: number;
          index: {
            sessionId: string;
            refs: Array<{
              id: string;
              sourcePath: string;
              adapterId: string;
            }>;
          };
        }
      >;
      loadedFileCache: {
        path: string;
        size: number;
        mtimeMs: number;
        model: {
          sessionId: string;
          sourcePath: string;
          refs: Array<{ id: string; sourcePath: string; adapterId: string }>;
          bundles: Array<{ conversation: { id: string } }>;
        };
      } | null;
    };

    expect(refs).toHaveLength(6);
    expect(caches.fileIndexCache.size).toBe(5);
    expect(caches.loadedFileCache).toBeNull();

    for (const [sourcePath, entry] of caches.fileIndexCache.entries()) {
      expect(entry.index.sessionId.length).toBeGreaterThan(0);
      expect(entry.index.refs.length).toBeGreaterThan(0);
      expect(entry.index.refs.every((ref) => ref.sourcePath === sourcePath)).toBe(true);
      expect((entry as { model?: unknown }).model).toBeUndefined();
      expect((entry.index as { bundles?: unknown }).bundles).toBeUndefined();
    }

    const rootRef = refs.find((ref) => ref.id === PARENT_SESSION_ID);
    const compactedRef = refs.find(
      (ref) => ref.sourcePath === fixture.parentPath && ref.id !== PARENT_SESSION_ID,
    );
    const childRef = refs.find((ref) => ref.sourcePath === fixture.childPath);

    expect(rootRef).toBeDefined();
    expect(compactedRef).toBeDefined();
    expect(childRef).toBeDefined();

    await fixture.adapter.loadConversation(rootRef!);
    expect(caches.loadedFileCache?.path).toBe(fixture.parentPath);
    expect(caches.loadedFileCache?.model.bundles.map((bundle) => bundle.conversation.id)).toEqual(
      expect.arrayContaining([PARENT_SESSION_ID, compactedRef!.id]),
    );

    await fixture.adapter.loadConversation(compactedRef!);
    expect(caches.loadedFileCache?.path).toBe(fixture.parentPath);

    await fixture.adapter.loadConversation(childRef!);
    expect(caches.loadedFileCache?.path).toBe(fixture.childPath);
    expect(caches.loadedFileCache?.model.bundles).toHaveLength(1);

    for (const entry of caches.fileIndexCache.values()) {
      expect((entry.index as { bundles?: unknown }).bundles).toBeUndefined();
    }
  });
});

function createFixture(options: { extraRootSessions?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), "jin-claude-reference-"));
  createdRoots.push(root);

  const projectsDir = join(root, ".config", "claude", "projects");
  const claudeDir = join(root, ".claude");
  const projectDir = join(projectsDir, "test-project-hash");
  const parentPath = join(projectDir, `${PARENT_SESSION_ID}.jsonl`);
  const childPath = join(
    projectDir,
    PARENT_SESSION_ID,
    "subagents",
    `agent-${CHILD_SESSION_ID}.jsonl`,
  );
  const extraRootSessionPaths: string[] = [];

  writeJsonl(parentPath, [
    {
      parentUuid: null,
      isSidechain: false,
      cwd: "/tmp/jin-reference-project",
      sessionId: PARENT_SESSION_ID,
      gitBranch: "",
      type: "user",
      message: {
        role: "user",
        content: "Root task: inspect the logs and summarize the result.",
      },
      uuid: "parent-user-1",
      timestamp: "2026-02-08T17:51:13.903Z",
    },
    {
      parentUuid: "parent-user-1",
      isSidechain: false,
      cwd: "/tmp/jin-reference-project",
      sessionId: PARENT_SESSION_ID,
      gitBranch: "",
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-5-20251101",
        content: [
          {
            type: "thinking",
            thinking: "Plan the work before using tools.",
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 3,
          cache_creation_input_tokens: 4,
          cache_read_input_tokens: 2,
        },
      },
      uuid: "parent-assistant-thinking",
      timestamp: "2026-02-08T17:51:15.000Z",
    },
    {
      parentUuid: "parent-assistant-thinking",
      isSidechain: false,
      cwd: "/tmp/jin-reference-project",
      sessionId: PARENT_SESSION_ID,
      gitBranch: "",
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-5-20251101",
        content: [
          {
            type: "text",
            text: "I'll ask a sub-agent to inspect the logs.",
          },
          {
            type: "tool_use",
            id: "tool-task-1",
            name: "Task",
            input: {
              subagent_session_id: CHILD_SESSION_ID,
              prompt: "Inspect the logs and report back.",
            },
          },
        ],
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          cache_creation_input_tokens: 1,
          cache_read_input_tokens: 0,
        },
      },
      uuid: "parent-assistant-task",
      timestamp: "2026-02-08T17:51:17.000Z",
    },
    {
      parentUuid: "parent-assistant-task",
      isSidechain: false,
      cwd: "/tmp/jin-reference-project",
      sessionId: PARENT_SESSION_ID,
      gitBranch: "",
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-task-1",
            content: [
              {
                type: "text",
                text: `Spawned child ${CHILD_SESSION_ID} and received a status update.`,
              },
            ],
            is_error: false,
          },
        ],
      },
      uuid: "parent-tool-result",
      timestamp: "2026-02-08T17:51:18.000Z",
    },
    {
      type: "system",
      subtype: "compact_boundary",
      sessionId: PARENT_SESSION_ID,
      cwd: "/tmp/jin-reference-project",
      uuid: "parent-boundary-1",
      timestamp: "2026-02-08T17:51:20.000Z",
      compactMetadata: {
        trigger: "manual",
        preTokens: 2048,
      },
    },
    {
      type: "summary",
      sessionId: PARENT_SESSION_ID,
      cwd: "/tmp/jin-reference-project",
      uuid: "parent-summary-1",
      timestamp: "2026-02-08T17:51:21.000Z",
      summary: "Summary of earlier work",
    },
    {
      parentUuid: "parent-summary-1",
      isSidechain: false,
      cwd: "/tmp/jin-reference-project",
      sessionId: PARENT_SESSION_ID,
      gitBranch: "",
      type: "user",
      message: {
        role: "user",
        content: "Continue after compaction.",
      },
      uuid: "parent-user-2",
      timestamp: "2026-02-08T17:51:22.000Z",
    },
    {
      parentUuid: "parent-user-2",
      isSidechain: false,
      cwd: "/tmp/jin-reference-project",
      sessionId: PARENT_SESSION_ID,
      gitBranch: "",
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-5-20251101",
        content: [
          {
            type: "text",
            text: "Post-compaction answer.",
          },
        ],
        usage: {
          input_tokens: 6,
          output_tokens: 7,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1,
        },
      },
      uuid: "parent-assistant-2",
      timestamp: "2026-02-08T17:51:24.000Z",
    },
  ]);

  writeJsonl(childPath, [
    {
      parentUuid: null,
      isSidechain: false,
      cwd: "/tmp/jin-reference-project",
      sessionId: CHILD_SESSION_ID,
      gitBranch: "",
      type: "user",
      message: {
        role: "user",
        content: "Inspect the logs and report anything suspicious.",
      },
      uuid: "child-user-1",
      timestamp: "2026-02-08T17:51:17.500Z",
    },
    {
      parentUuid: "child-user-1",
      isSidechain: false,
      cwd: "/tmp/jin-reference-project",
      sessionId: CHILD_SESSION_ID,
      gitBranch: "",
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-5-20251101",
        content: [
          {
            type: "text",
            text: "The logs show one transient timeout but no persistent failure.",
          },
        ],
        usage: {
          input_tokens: 8,
          output_tokens: 9,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      uuid: "child-assistant-1",
      timestamp: "2026-02-08T17:51:19.000Z",
    },
  ]);

  for (let index = 0; index < (options.extraRootSessions ?? 0); index += 1) {
    const extraSessionId = `33333333-3333-3333-3333-${String(index + 1).padStart(12, "0")}`;
    const extraPath = join(projectDir, `${extraSessionId}.jsonl`);
    extraRootSessionPaths.push(extraPath);
    writeJsonl(extraPath, [
      {
        parentUuid: null,
        isSidechain: false,
        cwd: "/tmp/jin-reference-project",
        sessionId: extraSessionId,
        gitBranch: "",
        type: "user",
        message: {
          role: "user",
          content: `Extra session ${index + 1}: gather one more result.`,
        },
        uuid: `extra-user-${index + 1}`,
        timestamp: `2026-02-08T17:5${index}:00.000Z`,
      },
      {
        parentUuid: `extra-user-${index + 1}`,
        isSidechain: false,
        cwd: "/tmp/jin-reference-project",
        sessionId: extraSessionId,
        gitBranch: "",
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-opus-4-5-20251101",
          content: [
            {
              type: "text",
              text: `Extra session ${index + 1} completed.`,
            },
          ],
          usage: {
            input_tokens: 4,
            output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
        uuid: `extra-assistant-${index + 1}`,
        timestamp: `2026-02-08T17:5${index}:30.000Z`,
      },
    ]);
  }

  return {
    adapter: new ClaudeCodeAdapter({ projectsDir, claudeDir }),
    projectsDir,
    parentPath,
    childPath,
    extraRootSessionPaths,
  };
}

function writeJsonl(path: string, records: Array<Record<string, unknown>>) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
}
