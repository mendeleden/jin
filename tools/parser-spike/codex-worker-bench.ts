import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { argv, cwd, execPath, exit } from "process";
import { CodexAdapter } from "../../src/adapters/codex";
import { openStoreAtPath, getSyncState } from "../../src/db";
import { getOverviewSummary, listConversations } from "../../src/db/query-surface";
import { ingestConversationViaWorker } from "../../src/pipeline/ingest-worker";

type Mode = "ts" | "go";

async function main(): Promise<void> {
  const [modeArg, sourceArg] = argv.slice(2);
  if (!isMode(modeArg) || !sourceArg) {
    console.error(
      "usage: bun run tools/parser-spike/codex-worker-bench.ts <ts|go> <source-jsonl>",
    );
    exit(1);
  }

  const sourcePath = resolve(cwd(), sourceArg);
  const sourceStats = statSync(sourcePath);
  const stagedRoot = process.env.JIN_CODEX_BENCH_STAGE_DIR
    ? resolve(process.env.JIN_CODEX_BENCH_STAGE_DIR)
    : mkdtempSync(join(tmpdir(), "jin-codex-worker-bench-"));
  const stagedPath = stageCodexFile(stagedRoot, sourcePath);
  const storeRoot = mkdtempSync(join(tmpdir(), "jin-codex-worker-bench-store-"));
  const store = openStoreAtPath(join(storeRoot, "store.db"));
  const adapter = new CodexAdapter(stagedRoot);

  try {
    const refs = (await adapter.findChanged({ kind: "startup-scan" }))
      .filter((ref) => ref.sourcePath === stagedPath)
      .sort((left, right) => left.id.localeCompare(right.id));

    const workerCommand =
      modeArg === "go"
        ? [resolveGoWorkerBinary(), "worker"]
        : [execPath, join(process.cwd(), "src/index.ts"), "__worker"];

    const loadResults = [];
    for (const ref of refs) {
      const result = await ingestConversationViaWorker(workerCommand, store, {
        ref,
        adapter: {
          adapterId: "codex",
          adapterConfig: {
            enabled: true,
            dataDir: stagedRoot,
          },
        },
      });
      loadResults.push({ refId: ref.id, result });
    }

    const overview = getOverviewSummary(store.database);
    const conversations = listConversations(store.database, { adapterId: "codex" })
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((conversation) => ({
        id: conversation.id,
        traceId: conversation.traceId,
        parentId: conversation.parentId,
        relationship: conversation.relationship,
        forkPoint: conversation.forkPoint,
        messageCount: conversation.messageCount,
        toolCount: conversation.toolCount,
        bundleHash: getSyncState(store.database, conversation.id)?.bundleHash ?? "",
      }));

    const output = {
      mode: modeArg,
      sourcePath,
      sourceSizeBytes: sourceStats.size,
      stagedRoot,
      stagedPath,
      refCount: refs.length,
      refs: refs.map((ref) => ({ id: ref.id, sourcePath: ref.sourcePath })),
      loadResults,
      overview,
      conversations,
    };
    console.log(JSON.stringify(output, null, 2));
  } finally {
    store.close();
    rmSync(storeRoot, { recursive: true, force: true });
    if (!process.env.JIN_CODEX_BENCH_STAGE_DIR) {
      rmSync(stagedRoot, { recursive: true, force: true });
    }
  }
}

function isMode(value: string | undefined): value is Mode {
  return value === "ts" || value === "go";
}

function resolveGoWorkerBinary(): string {
  return (
    process.env.JIN_EXPERIMENT_CODEX_GO_BINARY ||
    join(process.cwd(), "tools", "parser-spike", "go-parser-bin")
  );
}

function stageCodexFile(stagedRoot: string, sourcePath: string): string {
  const relativePath = codexRelativePath(sourcePath);
  const targetPath = join(stagedRoot, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function codexRelativePath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/");
  const sessionsIndex = normalized.indexOf("/sessions/");
  if (sessionsIndex >= 0) {
    return normalized.slice(sessionsIndex + 1);
  }
  const archivedIndex = normalized.indexOf("/archived_sessions/");
  if (archivedIndex >= 0) {
    return normalized.slice(archivedIndex + 1);
  }
  return join("sessions", "bench", sourcePath.split("/").at(-1) ?? "session.jsonl");
}

void main();
