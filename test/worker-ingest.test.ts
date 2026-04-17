import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { CodexAdapter } from "../src/adapters/codex";
import type { Adapter } from "../src/contracts/adapters";
import { openStoreAtPath, type SqliteConversationStore } from "../src/db";
import { ingestOne } from "../src/pipeline/ingest";

const SIMPLE_FIXTURE = join(
  process.cwd(),
  "test/fixtures/codex/2026-02-21T12-48-43-testcodex.jsonl",
);

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

test("worker ingest routes heavy codex startup refs through the worker path", async () => {
  const codexHome = makeCodexHome();
  const discoveryAdapter = new CodexAdapter(codexHome);
  const refs = await discoveryAdapter.findChanged({ kind: "startup-scan" });
  expect(refs).toHaveLength(1);

  const storeEnv = createStoreEnv("worker-ingest");
  const workerTrapAdapter: Adapter = {
    id: "codex",
    name: "Codex",
    async detect() {
      return true;
    },
    async findChanged() {
      return refs;
    },
    async loadConversation() {
      throw new Error("inline loadConversation should not run when worker ingest is enabled");
    },
    watchPaths() {
      return [];
    },
  };

  const result = await ingestOne(workerTrapAdapter, storeEnv.store, {
    kind: "startup-scan",
  }, {
    workerIngest: {
      command: [process.execPath, join(process.cwd(), "src/index.ts")],
      adapterConfigs: {
        codex: {
          enabled: true,
          dataDir: codexHome,
        },
      },
    },
  });

  expect(result).toMatchObject({
    scannedRefCount: 1,
    loadedConversationCount: 1,
    anyChanged: true,
    changedConversationIds: [refs[0]!.id],
  });
  expect(storeEnv.store.getMessages(refs[0]!.id).length).toBeGreaterThan(0);
});

function makeCodexHome(): string {
  const root = mkdtempSync(join(tmpdir(), "jin-worker-codex-"));
  const relativePath = "sessions/2026/02/21/rollout-simple.jsonl";
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${readFileSync(SIMPLE_FIXTURE, "utf8").trim()}\n`, "utf8");
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function createStoreEnv(name: string): { dir: string; store: SqliteConversationStore } {
  const dir = mkdtempSync(join(tmpdir(), `jin-worker-store-${name}-`));
  const store = openStoreAtPath(join(dir, "store.db"));
  cleanups.push(() => {
    try {
      store.close();
    } catch {
      // Best effort cleanup.
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store };
}
