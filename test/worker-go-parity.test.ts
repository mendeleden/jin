import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code";
import type { ConversationStore } from "../src/contracts/store";
import { openStoreAtPath, type SqliteConversationStore } from "../src/db";
import { ingestConversationViaWorker } from "../src/pipeline/ingest-worker";

const FIXTURE_PROJECTS_DIR = join(process.cwd(), "test", "fixtures", "claude-code");
const MULTI_REF_FIXTURE_PATH = join(process.cwd(), ".spike-target.jsonl");
const TS_WORKER_COMMAND = [process.execPath, join(process.cwd(), "src/index.ts"), "__worker"];
const cleanupPaths: string[] = [];
let goWorkerBinaryPath: string | null = null;

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
