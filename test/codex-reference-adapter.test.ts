import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { CodexAdapter } from "../src/adapters/codex";

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
