import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code";
import type { ConversationStore } from "../src/contracts/store";
import { openStoreAtPath, type SqliteConversationStore } from "../src/db";
import { ingestConversationViaWorker } from "../src/pipeline/ingest-worker";

const FIXTURE_PROJECTS_DIR = join(process.cwd(), "test", "fixtures", "claude-code");
const MULTI_REF_FIXTURE_PATH = join(process.cwd(), ".spike-target.jsonl");
const TS_WORKER_COMMAND = [process.execPath, join(process.cwd(), "src/index.ts"), "__worker"];
const cleanupPaths: string[] = [];
let goWorkerBinaryPath: string | null = null;
const LIVE_PARENT_SESSION_ID = "11111111-1111-1111-1111-111111111111";
const LIVE_AGENT_ID = "a1bbe96";

afterAll(() => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (!target) continue;
    rmSync(target, { recursive: true, force: true });
  }
});

test("Go worker streams the same persisted Claude Code conversation as the TS worker on a real fixture", async () => {
  await expectWorkerParity(FIXTURE_PROJECTS_DIR, 1);
});

test("Go worker streams the same persisted Claude Code conversations as the TS worker on a real multi-ref fixture", async () => {
  const projectsDir = stageClaudeFixture("worker-go-parity-multiref", MULTI_REF_FIXTURE_PATH);
  await expectWorkerParity(projectsDir, 2);
});

test("Go worker streams the same persisted Claude Code subagent conversation as the TS worker for the live agentId path shape", async () => {
  const projectsDir = stageLiveLikeSubagentFixture();
  await expectWorkerParity(projectsDir, 2);
});

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

async function expectWorkerParity(projectsDir: string, expectedRefCount: number): Promise<void> {
  const adapter = new ClaudeCodeAdapter({ projectsDir });
  const refs = await adapter.findChanged({ kind: "startup-scan" });

  expect(refs).toHaveLength(expectedRefCount);

  const tsStore = createStore("worker-go-parity-ts");
  const goStore = createStore("worker-go-parity-go");
  const tsSnapshots: Array<ReturnType<typeof snapshotStore>> = [];
  const goSnapshots: Array<ReturnType<typeof snapshotStore>> = [];

  try {
    for (const ref of refs) {
      const request = {
        ref,
        adapter: {
          adapterId: "claude-code",
          adapterConfig: {
            enabled: true,
            dataDir: projectsDir,
          },
        },
      };
      const tsEvents: Array<Record<string, unknown>> = [];
      const goEvents: Array<Record<string, unknown>> = [];

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

      expect(tsResult).toEqual(goResult);
      expect(normalizeEvents(goEvents)).toEqual(normalizeEvents(tsEvents));

      if (tsResult.kind !== "loaded" || goResult.kind !== "loaded") {
        throw new Error("expected both workers to load the fixture conversation");
      }

      const tsSnapshot = snapshotStore(tsStore, tsResult.conversationId);
      const goSnapshot = snapshotStore(goStore, goResult.conversationId);
      expect(goSnapshot).toEqual(tsSnapshot);
      tsSnapshots.push(tsSnapshot);
      goSnapshots.push(goSnapshot);
    }

    expect(goSnapshots).toEqual(tsSnapshots);
  } finally {
    tsStore.close();
    goStore.close();
  }
}

function stageClaudeFixture(name: string, fixturePath: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  cleanupPaths.push(root);
  const projectDir = join(root, "project-a");
  mkdirSync(projectDir, { recursive: true });
  copyFileSync(fixturePath, join(projectDir, "fixture.jsonl"));
  return root;
}

function stageLiveLikeSubagentFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "worker-go-parity-subagent-"));
  cleanupPaths.push(root);
  const projectDir = join(root, "project-a");
  const parentPath = join(projectDir, `${LIVE_PARENT_SESSION_ID}.jsonl`);
  const childPath = join(
    projectDir,
    LIVE_PARENT_SESSION_ID,
    "subagents",
    `agent-${LIVE_AGENT_ID}.jsonl`,
  );

  writeJsonl(parentPath, [
    {
      parentUuid: null,
      isSidechain: false,
      cwd: "/tmp/jin-reference-project",
      sessionId: LIVE_PARENT_SESSION_ID,
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
      sessionId: LIVE_PARENT_SESSION_ID,
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
              agent_id: LIVE_AGENT_ID,
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
  ]);

  writeJsonl(childPath, [
    {
      parentUuid: null,
      isSidechain: true,
      cwd: "/tmp/jin-reference-project",
      sessionId: LIVE_PARENT_SESSION_ID,
      agentId: LIVE_AGENT_ID,
      gitBranch: "",
      type: "user",
      message: {
        role: "user",
        content: "Inspect the logs and report anything suspicious.",
      },
      uuid: `${LIVE_AGENT_ID}-user-1`,
      timestamp: "2026-02-08T17:51:17.500Z",
    },
    {
      parentUuid: `${LIVE_AGENT_ID}-user-1`,
      isSidechain: true,
      cwd: "/tmp/jin-reference-project",
      sessionId: LIVE_PARENT_SESSION_ID,
      agentId: LIVE_AGENT_ID,
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
      uuid: `${LIVE_AGENT_ID}-assistant-1`,
      timestamp: "2026-02-08T17:51:19.000Z",
    },
  ]);

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
