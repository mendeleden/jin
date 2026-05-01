import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code";
import type { ConversationStore } from "../src/contracts/store";
import { openStoreAtPath, type SqliteConversationStore } from "../src/db";
import { ingestConversationViaWorker } from "../src/pipeline/ingest-worker";

const FIXTURE_PROJECTS_DIR = join(process.cwd(), "test", "fixtures", "claude-code");
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
  const adapter = new ClaudeCodeAdapter({ projectsDir: FIXTURE_PROJECTS_DIR });
  const refs = await adapter.findChanged({ kind: "startup-scan" });

  expect(refs).toHaveLength(1);
  const ref = refs[0]!;
  const request = {
    ref,
    adapter: {
      adapterId: "claude-code",
      adapterConfig: {
        enabled: true,
        dataDir: FIXTURE_PROJECTS_DIR,
      },
    },
  };

  const tsStore = createStore("worker-go-parity-ts");
  const goStore = createStore("worker-go-parity-go");
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

  expect(snapshotStore(goStore, goResult.conversationId)).toEqual(
    snapshotStore(tsStore, tsResult.conversationId),
  );

  tsStore.close();
  goStore.close();
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
