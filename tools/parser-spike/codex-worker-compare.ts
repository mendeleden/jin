import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { argv, cwd, execPath, exit } from "process";
import { CodexAdapter } from "../../src/adapters/codex";
import { openStoreAtPath, getSyncState } from "../../src/db";
import { ingestConversationViaWorker } from "../../src/pipeline/ingest-worker";

const TS_WORKER_COMMAND = [execPath, join(process.cwd(), "src/index.ts"), "__worker"];

async function main(): Promise<void> {
  const [sourceArg] = argv.slice(2);
  if (!sourceArg) {
    console.error("usage: bun run tools/parser-spike/codex-worker-compare.ts <source-jsonl>");
    exit(1);
  }

  const sourcePath = resolve(cwd(), sourceArg);
  const stageRoot = mkdtempSync(join(tmpdir(), "jin-codex-compare-"));
  const stagePath = stageCodexFile(stageRoot, sourcePath);
  const adapter = new CodexAdapter(stageRoot);
  const tsStore = openStoreAtPath(join(mkdtempSync(join(tmpdir(), "jin-codex-compare-ts-")), "store.db"));
  const goStore = openStoreAtPath(join(mkdtempSync(join(tmpdir(), "jin-codex-compare-go-")), "store.db"));

  try {
    const refs = (await adapter.findChanged({ kind: "startup-scan" }))
      .filter((ref) => ref.sourcePath === stagePath)
      .sort((left, right) => left.id.localeCompare(right.id));

    for (const ref of refs) {
      const request = {
        ref,
        adapter: {
          adapterId: "codex",
          adapterConfig: {
            enabled: true,
            dataDir: stageRoot,
          },
        },
      };
      await ingestConversationViaWorker(TS_WORKER_COMMAND, tsStore, request);
      await ingestConversationViaWorker([resolveGoWorkerBinary(), "worker"], goStore, request);
    }

    const conversationIds = refs.map((ref) => ref.id);
    const comparisons = conversationIds.map((conversationId) => {
      const tsSnapshot = snapshot(tsStore, conversationId);
      const goSnapshot = snapshot(goStore, conversationId);
      const mismatchPath = firstMismatchPath(tsSnapshot, goSnapshot);
      return {
        conversationId,
        tsBundleHash: getSyncState(tsStore.database, conversationId)?.bundleHash ?? "",
        goBundleHash: getSyncState(goStore.database, conversationId)?.bundleHash ?? "",
        equal: mismatchPath === null,
        mismatchPath,
        tsSnapshot: mismatchPath ? tsSnapshot : undefined,
        goSnapshot: mismatchPath ? goSnapshot : undefined,
      };
    });

    console.log(
      JSON.stringify(
        {
          sourcePath,
          stageRoot,
          refCount: refs.length,
          comparisons,
        },
        null,
        2,
      ),
    );
  } finally {
    tsStore.close();
    goStore.close();
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

function resolveGoWorkerBinary(): string {
  return (
    process.env.JIN_EXPERIMENT_CODEX_GO_BINARY ||
    join(process.cwd(), "tools", "parser-spike", "go-parser-bin")
  );
}

function stageCodexFile(stageRoot: string, sourcePath: string): string {
  const relativePath = codexRelativePath(sourcePath);
  const targetPath = join(stageRoot, relativePath);
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
  return join("sessions", "compare", sourcePath.split("/").at(-1) ?? "session.jsonl");
}

function snapshot(
  store: ReturnType<typeof openStoreAtPath>,
  conversationId: string,
): Record<string, unknown> {
  return {
    conversation: store.getConversation(conversationId),
    messages: store.getMessages(conversationId),
    toolCalls: store.getToolCalls(conversationId),
  };
}

function firstMismatchPath(left: unknown, right: unknown, path = "$"): string | null {
  if (Object.is(left, right)) {
    return null;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return `${path}.length`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const child = firstMismatchPath(left[index], right[index], `${path}[${index}]`);
      if (child) {
        return child;
      }
    }
    return null;
  }

  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) {
      if (!(key in leftRecord) || !(key in rightRecord)) {
        return `${path}.${key}`;
      }
      const child = firstMismatchPath(leftRecord[key], rightRecord[key], `${path}.${key}`);
      if (child) {
        return child;
      }
    }
    return null;
  }

  return path;
}

void main();
