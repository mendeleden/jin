import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { CodexAdapter } from "../src/adapters/codex";
import { computeBundleHash } from "../src/db/bundle";
import { openStoreAtPath, type SqliteConversationStore } from "../src/db";
import type { ConversationStore } from "../src/contracts/store";
import { ingestConversationViaWorker } from "../src/pipeline/ingest-worker";

const SIMPLE_FIXTURE = join(
  process.cwd(),
  "test",
  "fixtures",
  "codex",
  "2026-02-21T12-48-43-testcodex.jsonl",
);
const TS_WORKER_COMMAND = [
  process.execPath,
  join(process.cwd(), "src/index.ts"),
  "__worker",
];

const cleanupPaths: string[] = [];
let goWorkerBinaryPath: string | null = null;

afterAll(() => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (!target) continue;
    rmSync(target, { recursive: true, force: true });
  }
});

test("Codex Go worker preserves TS parser semantics for root, compacted, and spawned refs", async () => {
  const codexHome = stageCodexSemanticsFixture();
  const adapter = new CodexAdapter(codexHome);
  const refs = await adapter.findChanged({ kind: "startup-scan" });

  expect(refs).toHaveLength(3);

  const bundles = new Map<string, NonNullable<Awaited<ReturnType<CodexAdapter["loadConversation"]>>>>();
  for (const ref of refs) {
    const bundle = await adapter.loadConversation(ref);
    if (bundle) {
      bundles.set(ref.id, bundle);
    }
  }

  expect(bundles.size).toBe(3);

  const rootBundle = Array.from(bundles.values()).find(
    (bundle) => bundle.conversation.relationship === "root",
  )!;
  const compactedBundle = Array.from(bundles.values()).find(
    (bundle) => bundle.conversation.relationship === "compacted",
  )!;
  const spawnedBundle = Array.from(bundles.values()).find(
    (bundle) => bundle.conversation.relationship === "spawned",
  )!;

  expect(rootBundle.conversation.traceId).toBe(rootBundle.conversation.id);
  expect(rootBundle.conversation.parentId).toBe("");
  expect(rootBundle.conversation.name).toBe(
    "Plan the migration steps for the project",
  );
  expect(rootBundle.messages).toHaveLength(2);
  expect(rootBundle.messages[1]?.toolUses).toHaveLength(1);
  expect(rootBundle.messages[1]?.toolUses[0]).toMatchObject({
    name: "spawn_agent",
    output: JSON.stringify({
      agent_id: "codex-child-session",
      nickname: "planner",
    }),
  });

  expect(compactedBundle.conversation.traceId).toBe(rootBundle.conversation.id);
  expect(compactedBundle.conversation.parentId).toBe(rootBundle.conversation.id);
  expect(compactedBundle.messages.map((message) => message.recordType)).toEqual([
    "message",
    "compaction",
    "message",
  ]);

  expect(spawnedBundle.conversation.traceId).toBe(rootBundle.conversation.id);
  expect(spawnedBundle.conversation.parentId).toBe(rootBundle.conversation.id);
  expect(spawnedBundle.conversation.relationship).toBe("spawned");
  expect(spawnedBundle.conversation.forkPoint).toBe(1);
  expect(spawnedBundle.messages).toHaveLength(2);
  expect(spawnedBundle.messages[1]).toMatchObject({
    inputTokens: 11,
    outputTokens: 6,
    cacheRead: 1,
    thinkingTokens: 3,
    thinkingContent: "Risk review complete.",
  });
  expect(spawnedBundle.messages[1]?.toolUses[0]).toMatchObject({
    name: "shell",
    output: "src\npackage.json",
    durationMs: 250,
  });

  const reloaded = await adapter.loadConversation(
    refs.find((ref) => ref.id === spawnedBundle.conversation.id)!,
  );
  expect(reloaded).toEqual(spawnedBundle);

  await expectCodexWorkerParity(adapter, refs);
});

test("Codex Go worker matches TS worker streaming, persisted result, and bundle hash on the verified fixture", async () => {
  const codexHome = stageSimpleCodexFixture();
  const adapter = new CodexAdapter(codexHome);
  const refs = await adapter.findChanged({ kind: "startup-scan" });

  expect(refs).toHaveLength(1);
  await expectCodexWorkerParity(adapter, refs);

  const bundle = await adapter.loadConversation(refs[0]!);
  expect(bundle).not.toBeNull();

  const goStore = createStore("worker-go-codex-hash");
  try {
    const result = await ingestConversationViaWorker(
      [ensureGoWorkerBinary(), "worker"],
      goStore,
      {
        ref: refs[0]!,
        adapter: {
          adapterId: "codex",
          adapterConfig: {
            enabled: true,
            dataDir: codexHome,
          },
        },
      },
    );
    expect(result).toMatchObject({
      kind: "loaded",
      conversationId: bundle!.conversation.id,
    });
    expect(computeBundleHash(bundle!)).toBe(
      readBundleHash(goStore, bundle!.conversation.id),
    );
  } finally {
    goStore.close();
  }
});

async function expectCodexWorkerParity(
  adapter: CodexAdapter,
  refs: Array<{ id: string; sourcePath: string; adapterId: string }>,
): Promise<void> {
  const tsStore = createStore("worker-go-codex-ts");
  const goStore = createStore("worker-go-codex-go");

  try {
    for (const ref of refs) {
      const tsEvents: Array<Record<string, unknown>> = [];
      const goEvents: Array<Record<string, unknown>> = [];
      const request = {
        ref,
        adapter: {
          adapterId: "codex",
          adapterConfig: {
            enabled: true,
            dataDir: codexHomeFromRef(ref.sourcePath),
          },
        },
      };

      const tsResult = await ingestConversationViaWorker(
        TS_WORKER_COMMAND,
        tsStore,
        request,
        {
          onWorkerEvent: (phase, fields) => {
            if (phase !== "sample") {
              tsEvents.push({ phase, ...fields });
            }
          },
        },
      );
      const goResult = await ingestConversationViaWorker(
        [ensureGoWorkerBinary(), "worker"],
        goStore,
        request,
        {
          onWorkerEvent: (phase, fields) => {
            if (phase !== "sample") {
              goEvents.push({ phase, ...fields });
            }
          },
        },
      );

      expect(goResult).toEqual(tsResult);
      expect(normalizeEvents(goEvents)).toEqual(normalizeEvents(tsEvents));

      const bundle = await adapter.loadConversation(ref);
      expect(bundle).not.toBeNull();
      expect(computeBundleHash(bundle!)).toBe(
        readBundleHash(goStore, bundle!.conversation.id),
      );

      const tsSnapshot = snapshotStore(tsStore, bundle!.conversation.id);
      const goSnapshot = snapshotStore(goStore, bundle!.conversation.id);
      expect(goSnapshot).toEqual(tsSnapshot);
    }
  } finally {
    tsStore.close();
    goStore.close();
  }
}

function ensureGoWorkerBinary(): string {
  if (goWorkerBinaryPath && existsSync(goWorkerBinaryPath)) {
    return goWorkerBinaryPath;
  }

  const buildDir = mkdtempSync(join(tmpdir(), "jin-go-worker-bin-"));
  cleanupPaths.push(buildDir);
  goWorkerBinaryPath = join(buildDir, "go-parser-bin");
  execFileSync("go", ["build", "-o", goWorkerBinaryPath, "."], {
    cwd: join(process.cwd(), "tools", "parser-spike", "go-parser"),
    stdio: "pipe",
  });
  return goWorkerBinaryPath;
}

function createStore(name: string): SqliteConversationStore {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`));
  cleanupPaths.push(dir);
  return openStoreAtPath(join(dir, "store.db"));
}

function stageSimpleCodexFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "worker-go-codex-fixture-"));
  cleanupPaths.push(root);
  const filePath = join(
    root,
    "sessions",
    "2026",
    "02",
    "21",
    "fixture-codex.jsonl",
  );
  mkdirSync(dirname(filePath), { recursive: true });
  copyFileSync(SIMPLE_FIXTURE, filePath);
  return root;
}

function stageCodexSemanticsFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "worker-go-codex-semantics-"));
  cleanupPaths.push(root);

  writeJsonl(
    join(root, "sessions", "2026", "03", "01", "root.jsonl"),
    [
      {
        timestamp: "2026-03-01T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-root-session",
          timestamp: "2026-03-01T10:00:00.000Z",
          cwd: "/tmp/codex-project",
          git: {
            branch: "main",
            repository_url: "https://github.com/example/codex-project.git",
          },
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.100Z",
        type: "turn_context",
        payload: {
          cwd: "/tmp/codex-project",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.200Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Plan the migration steps for the project" }],
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.300Z",
        type: "response_item",
        payload: {
          type: "function_call",
          id: "fc_spawn",
          call_id: "call_spawn",
          name: "spawn_agent",
          arguments: "{\"task\":\"Summarize module risks\"}",
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.350Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_spawn",
          output: "{\"agent_id\":\"codex-child-session\",\"nickname\":\"planner\"}",
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.360Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 18,
              output_tokens: 9,
              cached_input_tokens: 2,
              reasoning_output_tokens: 4,
            },
          },
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.365Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ text: "Need a quick child analysis." }],
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.400Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          model: "gpt-5",
          content: [{ type: "output_text", text: "Spawning a planner subagent now." }],
          usage: {
            input_tokens: 18,
            output_tokens: 9,
            cached_input_tokens: 2,
          },
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.500Z",
        type: "compacted",
        payload: {
          id: "cmp-1",
          replacement_history: [
            {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "Plan the migration steps for the project",
                },
              ],
            },
            { type: "compaction" },
          ],
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.600Z",
        type: "turn_context",
        payload: {
          cwd: "/tmp/codex-project",
          model: "gpt-5",
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.700Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          model: "gpt-5",
          content: [{ type: "output_text", text: "After compaction, continue with implementation." }],
          usage: {
            input_tokens: 5,
            output_tokens: 7,
            cached_input_tokens: 0,
          },
        },
      },
    ],
  );

  writeJsonl(
    join(root, "sessions", "2026", "03", "01", "child.jsonl"),
    [
      {
        timestamp: "2026-03-01T10:00:01.000Z",
        type: "session_meta",
        payload: {
          id: "codex-child-session",
          timestamp: "2026-03-01T10:00:01.000Z",
          cwd: "/tmp/codex-project",
          git: {
            branch: "main",
            repository_url: "https://github.com/example/codex-project.git",
          },
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "codex-root-session",
                agent_nickname: "planner",
              },
            },
          },
        },
      },
      {
        timestamp: "2026-03-01T10:00:01.100Z",
        type: "turn_context",
        payload: {
          cwd: "/tmp/codex-project",
          model: "gpt-5-mini",
        },
      },
      {
        timestamp: "2026-03-01T10:00:01.200Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Summarize module risks" }],
        },
      },
      {
        timestamp: "2026-03-01T10:00:01.300Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 11,
              output_tokens: 6,
              cached_input_tokens: 1,
              reasoning_output_tokens: 3,
            },
          },
        },
      },
      {
        timestamp: "2026-03-01T10:00:01.350Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          id: "ct_1",
          call_id: "call_custom",
          name: "shell",
          input: "ls -la",
        },
      },
      {
        timestamp: "2026-03-01T10:00:01.400Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call_custom",
          output: "{\"stdout\":\"src\\npackage.json\",\"exit_code\":0,\"duration_seconds\":0.25}",
        },
      },
      {
        timestamp: "2026-03-01T10:00:01.450Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ text: "Risk review complete." }],
        },
      },
      {
        timestamp: "2026-03-01T10:00:01.500Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          model: "gpt-5-mini",
          content: [{ type: "output_text", text: "The main risk is the migration order." }],
        },
      },
    ],
  );

  return root;
}

function writeJsonl(path: string, records: Array<Record<string, unknown>>) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
}

function codexHomeFromRef(sourcePath: string): string {
  const separator = process.platform === "win32" ? "\\" : "/";
  const marker = `sessions${separator}`;
  const archivedMarker = `archived_sessions${separator}`;
  const sessionsIndex = sourcePath.indexOf(marker);
  if (sessionsIndex >= 0) {
    return sourcePath.slice(0, sessionsIndex);
  }
  const archivedIndex = sourcePath.indexOf(archivedMarker);
  if (archivedIndex >= 0) {
    return sourcePath.slice(0, archivedIndex);
  }
  throw new Error(`unable to resolve Codex home from ${sourcePath}`);
}

function normalizeEvents(events: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return events.map((event) => {
    const normalized = { ...event };
    delete normalized.childPid;
    return normalized;
  });
}

function snapshotStore(store: ConversationStore, conversationId: string) {
  return {
    conversation: store.getConversation(conversationId),
    messages: store.getMessages(conversationId),
    toolCalls: store.getToolCalls(conversationId),
  };
}

function readBundleHash(store: SqliteConversationStore, conversationId: string): string | null {
  const row = store.database
    .query(
      "SELECT bundle_hash AS bundleHash FROM _jin_sync WHERE conversation_id = ?1",
    )
    .get(conversationId) as { bundleHash?: string } | null;
  return row?.bundleHash ?? null;
}
