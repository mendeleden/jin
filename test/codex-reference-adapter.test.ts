import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { CodexAdapter } from "../src/adapters/codex";
import type { ConversationBundle, ConversationRef } from "../src/contracts/conversations";
import { computeBundleHash } from "../src/db/bundle";

const SIMPLE_FIXTURE = join(process.cwd(), "test/fixtures/codex/2026-02-21T12-48-43-testcodex.jsonl");
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("CodexAdapter v2 reference contract", () => {
  test("findChanged is deterministic and repeated loads keep conversation/message/tool ids stable", async () => {
    const codexHome = makeCodexHome([
      {
        relativePath: "sessions/2026/02/21/rollout-simple.jsonl",
        contents: readFileSync(SIMPLE_FIXTURE, "utf8"),
      },
    ]);

    const adapter = new CodexAdapter(codexHome);
    expect(await adapter.detect()).toBe(true);

    const startupRefs = await adapter.findChanged({ kind: "startup-scan" });
    expect(startupRefs).toHaveLength(1);
    expect(startupRefs[0]).toEqual({
      id: "019c8151-6c9c-7e10-a36d-28730314db0a",
      sourcePath: join(codexHome, "sessions/2026/02/21/rollout-simple.jsonl"),
      adapterId: "codex",
    });

    expect(await adapter.findChanged({ kind: "periodic-scan" })).toEqual([]);
    expect(
      await adapter.findChanged({
        kind: "fs-change",
        changedPaths: [join(codexHome, "sessions/2026/02/21/rollout-simple.jsonl")],
      }),
    ).toEqual(startupRefs);

    const bundle1 = await adapter.loadConversation(startupRefs[0]);
    const bundle2 = await adapter.loadConversation(startupRefs[0]);
    expect(bundle1).not.toBeNull();
    expect(bundle2).not.toBeNull();

    expect(bundle1!.conversation.id).toBe(bundle2!.conversation.id);
    expect(bundle1!.conversation.traceId).toBe(bundle1!.conversation.id);
    expect(bundle1!.conversation.relationship).toBe("root");
    expect(bundle1!.conversation.parentId).toBe("");
    expect(bundle1!.messages.map((message) => message.id)).toEqual(bundle2!.messages.map((message) => message.id));

    const assistant = bundle1!.messages.find((message) => message.role === "assistant");
    expect(assistant).toBeDefined();
    expect(assistant!.toolUses).toHaveLength(1);
    expect(assistant!.toolUses[0]).toMatchObject({
      name: "shell",
      input: "{\"command\": [\"find\", \".\", \"-type\", \"f\", \"-name\", \"*.ts\"]}",
      output: "./src/index.ts\n./src/app.ts\n./src/routes/api.ts",
      isError: false,
      durationMs: -1,
    });
  });

  test("compaction splitting, spawned linkage, and desktop tool calls map onto the frozen relationship model", async () => {
    const codexHome = makeCodexHome([
      {
        relativePath: "sessions/2026/03/25/rollout-parent.jsonl",
        contents: parentFixture(),
      },
      {
        relativePath: "sessions/2026/03/25/rollout-child.jsonl",
        contents: childFixture(),
      },
    ]);

    const adapter = new CodexAdapter(codexHome);
    const startupRefs = await adapter.findChanged({ kind: "startup-scan" });
    expect(startupRefs).toHaveLength(3);

    const bundles = (
      await Promise.all(startupRefs.map((ref) => adapter.loadConversation(ref)))
    ).filter((bundle): bundle is NonNullable<typeof bundle> => bundle !== null);

    const root = bundles.find((bundle) => bundle.conversation.id === "parent-thread");
    const compacted = bundles.find((bundle) => bundle.conversation.relationship === "compacted");
    const child = bundles.find((bundle) => bundle.conversation.id === "child-thread");

    expect(root).toBeDefined();
    expect(compacted).toBeDefined();
    expect(child).toBeDefined();

    expect(root!.conversation).toMatchObject({
      id: "parent-thread",
      traceId: "parent-thread",
      parentId: "",
      relationship: "root",
      forkPoint: -1,
    });

    expect(compacted!.conversation.traceId).toBe("parent-thread");
    expect(compacted!.conversation.parentId).toBe("parent-thread");
    expect(compacted!.messages[0]).toMatchObject({
      role: "user",
      content: "Compacted investigation summary",
    });
    expect(compacted!.messages[1]).toMatchObject({
      role: "system",
      recordType: "compaction",
      content: "Context compacted",
    });

    expect(child!.conversation.relationship).toBe("spawned");
    expect(child!.conversation.traceId).toBe("parent-thread");
    expect(child!.conversation.parentId).toBe(compacted!.conversation.id);
    expect(child!.conversation.forkPoint).toBe(2);

    const compactedAssistant = compacted!.messages.findLast((message) => message.role === "assistant");
    expect(compactedAssistant).toBeDefined();
    expect(compactedAssistant!.thinkingTokens).toBe(11);
    expect(compactedAssistant!.toolUses.map((tool) => tool.name)).toEqual(["spawn_agent", "apply_patch"]);

    const spawnTool = compactedAssistant!.toolUses[0];
    expect(spawnTool.output).toContain("\"agent_id\":\"child-thread\"");

    const patchTool = compactedAssistant!.toolUses[1];
    expect(patchTool.input).toContain("*** Begin Patch");
    expect(patchTool.output).toBe("Applied 1 file");
    expect(patchTool.isError).toBe(false);
    expect(patchTool.durationMs).toBe(1250);

    const childRefs = await adapter.findChanged({
      kind: "fs-change",
      changedPaths: [join(codexHome, "sessions/2026/03/25/rollout-child.jsonl")],
    });
    expect(childRefs).toEqual([
      {
        id: "child-thread",
        sourcePath: join(codexHome, "sessions/2026/03/25/rollout-child.jsonl"),
        adapterId: "codex",
      },
    ]);
  });

  test("cached compacted loads retain the root name when the first user appears after segment detection", async () => {
    const codexHome = makeCodexHome([
      {
        relativePath: "sessions/2026/03/26/rollout-delayed-name.jsonl",
        contents: delayedNameFixture(),
      },
    ]);

    const coldAdapter = new CodexAdapter(codexHome);
    const refs = await coldAdapter.findChanged({ kind: "startup-scan" });
    expect(refs).toHaveLength(2);

    const compactedRef = refs.find((ref) => ref.id !== "delayed-name-thread");
    expect(compactedRef).toBeDefined();

    const state = coldAdapter.exportDiscoveryState();
    expect(state.sources[0]?.payload).toMatchObject({
      rootName: "Name this conversation from the delayed user turn",
    });

    const warmAdapter = new CodexAdapter(codexHome);
    warmAdapter.importDiscoveryState(state);
    const compacted = await warmAdapter.loadConversation(compactedRef!);
    const fullParsed = await loadFullParsedBundle(coldAdapter, compactedRef!);

    expect(compacted).not.toBeNull();
    expect(compacted!.conversation.name).toBe("Name this conversation from the delayed user turn");
    expect(compacted!.conversation.relationship).toBe("compacted");
    expect(compacted!.conversation.startedAt).toBe("2026-03-26T10:05:00.000Z");
    expect(compacted!.conversation.endedAt).toBe("2026-03-26T10:05:01.000Z");
    expect(computeBundleHash(compacted!)).toBe(computeBundleHash(fullParsed));
  });

  test("discovery indexing tolerates formatted JSON and reordered envelope keys", async () => {
    const codexHome = makeCodexHome([
      {
        relativePath: "sessions/2026/03/27/rollout-formatted-envelope.jsonl",
        contents: formattedEnvelopeFixture(),
      },
    ]);

    const coldAdapter = new CodexAdapter(codexHome);
    const refs = await coldAdapter.findChanged({ kind: "startup-scan" });
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({
      id: "formatted-thread",
      adapterId: "codex",
    });

    const compactedRef = refs.find((ref) => ref.id !== "formatted-thread");
    expect(compactedRef).toBeDefined();

    const state = coldAdapter.exportDiscoveryState();
    expect(state.sources[0]?.payload).toMatchObject({
      rootName: "Formatted root name",
      cwd: "/tmp/formatted",
      branch: "format-main",
      gitRemote: "git@example.com:formatted/repo.git",
    });

    const warmAdapter = new CodexAdapter(codexHome);
    warmAdapter.importDiscoveryState(state);
    const compacted = await warmAdapter.loadConversation(compactedRef!);
    const fullParsed = await loadFullParsedBundle(coldAdapter, compactedRef!);

    expect(compacted).not.toBeNull();
    expect(compacted!.conversation.name).toBe("Formatted root name");
    expect(compacted!.conversation.relationship).toBe("compacted");
    expect(compacted!.messages[0]).toMatchObject({
      role: "user",
      content: "Formatted compacted history",
    });
    expect(computeBundleHash(compacted!)).toBe(computeBundleHash(fullParsed));
  });
});

function makeCodexHome(files: Array<{ relativePath: string; contents: string }>): string {
  const root = mkdtempSync(join(tmpdir(), "jin-codex-"));
  tempRoots.push(root);

  for (const file of files) {
    const fullPath = join(root, file.relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, `${file.contents.trim()}\n`, "utf8");
  }

  return root;
}

async function loadFullParsedBundle(
  adapter: CodexAdapter,
  ref: ConversationRef,
): Promise<ConversationBundle> {
  const harness = adapter as unknown as {
    buildFileModel(filePath: string): Promise<unknown | null>;
    resolveBase(model: unknown): Promise<unknown>;
    resolveConversationGit(model: unknown): unknown;
    buildBundle(
      model: unknown,
      base: unknown,
      git: unknown,
      index: number,
    ): ConversationBundle;
  };
  const model = await harness.buildFileModel(ref.sourcePath);
  if (!model) {
    throw new Error(`expected full Codex model for ${ref.sourcePath}`);
  }

  const segments = (model as { segments: Array<{ id: string }> }).segments;
  const segmentIndex = segments.findIndex((segment) => segment.id === ref.id);
  if (segmentIndex < 0) {
    throw new Error(`expected full Codex model to include segment ${ref.id}`);
  }

  const base = await harness.resolveBase(model);
  const git = harness.resolveConversationGit(model);
  return harness.buildBundle(model, base, git, segmentIndex);
}

function parentFixture(): string {
  return [
    JSON.stringify({
      timestamp: "2026-03-25T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "parent-thread",
        timestamp: "2026-03-25T10:00:00.000Z",
        cwd: "/tmp/project",
        originator: "Codex Desktop",
        source: "vscode",
        git: {
          branch: "feat/rewrite-ontology",
          repository_url: "https://github.com/example/jin.git",
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:00:01.000Z",
      type: "turn_context",
      payload: {
        turn_id: "turn-1",
        cwd: "/tmp/project",
        model: "gpt-5.4",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:00:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Investigate the regression" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        model: "gpt-5.4",
        content: [{ type: "output_text", text: "Starting the investigation." }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:00.000Z",
      type: "compacted",
      payload: {
        replacement_history: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Compacted investigation summary" }],
          },
          {
            type: "compaction",
            encrypted_content: "gAAAAA-test",
          },
        ],
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:01.000Z",
      type: "turn_context",
      payload: {
        turn_id: "turn-2",
        cwd: "/tmp/project",
        model: "gpt-5.4",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:02.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Apply the patch and verify it with a sub-agent" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:03.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        id: "spawn-fc",
        call_id: "call_spawn",
        name: "spawn_agent",
        arguments: "{\"agent_type\":\"default\",\"message\":\"Verify the patch\"}",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:03.500Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_spawn",
        output: "{\"agent_id\":\"child-thread\",\"nickname\":\"Dirac\"}",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:04.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: "call_patch",
        name: "apply_patch",
        input: "*** Begin Patch\\n*** Add File: note.txt\\n+patched\\n*** End Patch",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:04.500Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call_patch",
        output: "{\"exit_code\":0,\"duration_seconds\":1.25,\"output\":\"Applied 1 file\"}",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:05.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 240,
            output_tokens: 60,
            cached_input_tokens: 20,
            reasoning_output_tokens: 11,
          },
        },
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:05.100Z",
      type: "response_item",
      payload: {
        type: "reasoning",
        summary: [],
        encrypted_content: "gAAAAA-reasoning",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:06.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        model: "gpt-5.4",
        content: [{ type: "output_text", text: "I delegated verification and applied the patch." }],
      },
    }),
  ].join("\n");
}

function childFixture(): string {
  return [
    JSON.stringify({
      timestamp: "2026-03-25T10:05:10.000Z",
      type: "session_meta",
      payload: {
        id: "child-thread",
        timestamp: "2026-03-25T10:05:10.000Z",
        cwd: "/tmp/project",
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "parent-thread",
              depth: 1,
              agent_nickname: "Dirac",
              agent_role: "reviewer",
            },
          },
        },
        forked_from_id: "parent-thread",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:11.000Z",
      type: "turn_context",
      payload: {
        turn_id: "child-turn-1",
        cwd: "/tmp/project",
        model: "gpt-5.4-mini",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:12.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Verify the patch from the parent thread" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:13.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        call_id: "child_exec",
        name: "exec_command",
        arguments: "{\"cmd\":\"bun test\"}",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:14.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "child_exec",
        output: "tests passed",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-25T10:05:15.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        model: "gpt-5.4-mini",
        content: [{ type: "output_text", text: "The patch looks correct." }],
      },
    }),
  ].join("\n");
}

function delayedNameFixture(): string {
  return [
    JSON.stringify({
      timestamp: "2026-03-26T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "delayed-name-thread",
        timestamp: "2026-03-26T10:00:00.000Z",
        cwd: "/tmp/project",
        originator: "Codex Desktop",
        source: "vscode",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-26T10:00:01.000Z",
      type: "turn_context",
      payload: {
        turn_id: "turn-1",
        cwd: "/tmp/project",
        model: "gpt-5.4",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-26T10:00:02.000Z",
      type: "response_item",
      payload: {
        type: "reasoning",
        summary: [],
        encrypted_content: "gAAAAA-before-user",
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-26T10:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Name this conversation from the delayed user turn" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-26T10:00:04.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        model: "gpt-5.4",
        content: [{ type: "output_text", text: "I will keep that name." }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-26T10:05:00.000Z",
      type: "compacted",
      payload: {
        replacement_history: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Compacted follow-up" }],
          },
        ],
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-26T10:05:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        model: "gpt-5.4",
        content: [{ type: "output_text", text: "Continuing after compaction." }],
      },
    }),
  ].join("\n");
}

function formattedEnvelopeFixture(): string {
  return [
    '{ "payload" : { "git" : { "branch" : "format-main", "repository_url" : "git@example.com:formatted/repo.git" }, "cwd" : "/tmp/formatted", "id" : "formatted-thread", "timestamp" : "2026-03-27T10:00:00.000Z" }, "timestamp" : "2026-03-27T10:00:00.000Z", "type" : "session_meta" }',
    '{ "payload" : { "cwd" : "/tmp/formatted", "model" : "gpt-format", "turn_id" : "turn-1" }, "timestamp" : "2026-03-27T10:00:01.000Z", "type" : "turn_context" }',
    '{ "payload" : { "content" : [ { "text" : "Formatted root name", "type" : "input_text" } ], "role" : "user", "type" : "message" }, "timestamp" : "2026-03-27T10:00:02.000Z", "type" : "response_item" }',
    '{ "payload" : { "content" : [ { "text" : "Root response", "type" : "output_text" } ], "model" : "gpt-format", "role" : "assistant", "type" : "message" }, "timestamp" : "2026-03-27T10:00:03.000Z", "type" : "response_item" }',
    '{ "payload" : { "replacement_history" : [ { "content" : [ { "text" : "Formatted compacted history", "type" : "input_text" } ], "role" : "user", "type" : "message" } ], "turn_id" : "compact-turn" }, "timestamp" : "2026-03-27T10:05:00.000Z", "type" : "compacted" }',
    '{ "payload" : { "content" : [ { "text" : "Continuing formatted thread", "type" : "output_text" } ], "model" : "gpt-format", "role" : "assistant", "type" : "message" }, "timestamp" : "2026-03-27T10:05:01.000Z", "type" : "response_item" }',
  ].join("\n");
}
