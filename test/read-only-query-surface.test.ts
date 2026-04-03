import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { exportCommand } from "../src/commands/export";
import { listCommand } from "../src/commands/list";
import { searchCommand } from "../src/commands/search";
import { showCommand } from "../src/commands/show";
import { createRoutes, matchRoute } from "../src/api/routes";
import { getStore, type SqliteConversationStore } from "../src/db";
import type {
  ConversationBundle,
  ParsedConversation,
  ParsedMessage,
  ParsedToolCall,
} from "../src/contracts/conversations";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("read-only query surface", () => {
  test("list/search/show work while stopped and do not create runtime state", async () => {
    const { dir, store } = createQueryEnv();
    seedQuerySurface(store);

    const runtimeStatePath = join(dir, "jin.runtime.json");
    const pidPath = join(dir, "jin.pid");
    const rootRevisionBefore = store.getRevision("trace-root");

    const listConsole = captureConsole();
    await listCommand({ json: true });
    listConsole.restore();
    const listed = JSON.parse(listConsole.logs.join("\n"));
    expect(Array.isArray(listed)).toBe(true);
    expect(listed.some((conversation: any) => conversation.id === "trace-root")).toBe(true);

    const searchConsole = captureConsole();
    await searchCommand("stopped runtime", { json: true, limit: 10 });
    searchConsole.restore();
    const searched = JSON.parse(searchConsole.logs.join("\n"));
    expect(searched).toHaveLength(1);
    expect(searched[0].conversationId).toBe("trace-child");

    const showConsole = captureConsole();
    await showCommand("trace-ch", { json: true });
    showConsole.restore();
    const shown = JSON.parse(showConsole.logs.join("\n"));
    expect(shown.view).toBe("conversation");
    expect(shown.conversation.id).toBe("trace-child");

    expect(store.getRevision("trace-root")).toBe(rootRevisionBefore);
    expect(existsSync(runtimeStatePath)).toBe(false);
    expect(existsSync(pidPath)).toBe(false);
  });

  test("show exposes single conversation, full trace, and tree semantics", async () => {
    const { store } = createQueryEnv();
    seedQuerySurface(store);

    const traceConsole = captureConsole();
    await showCommand("trace-root", { json: true, trace: true });
    traceConsole.restore();
    const traceView = JSON.parse(traceConsole.logs.join("\n"));

    expect(traceView.view).toBe("trace");
    expect(traceView.traceId).toBe("trace-root");
    expect(traceView.conversations).toHaveLength(3);
    expect(
      traceView.conversations.some(
        (entry: any) => entry.conversation.relationship === "spawned",
      ),
    ).toBe(true);
    expect(
      traceView.conversations.some(
        (entry: any) => entry.conversation.relationship === "compacted",
      ),
    ).toBe(true);

    const treeConsole = captureConsole();
    await showCommand("trace-root-c1", { json: true, tree: true });
    treeConsole.restore();
    const treeView = JSON.parse(treeConsole.logs.join("\n"));

    expect(treeView.view).toBe("tree");
    expect(treeView.tree.conversation.id).toBe("trace-root");
    expect(
      treeView.tree.children.map((child: any) => child.conversation.id).sort(),
    ).toEqual(["trace-child", "trace-root-c1"]);
  });

  test("export writes requested files without mutating the local store", async () => {
    const { dir, store } = createQueryEnv();
    seedQuerySurface(store);

    const exportDir = join(dir, "exports");
    const rootRevisionBefore = store.getRevision("trace-root");
    const exportConsole = captureConsole();
    await exportCommand({ format: "json", output: exportDir, limit: 2 });
    exportConsole.restore();

    const files = readdirSync(exportDir).sort();
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.endsWith(".json"))).toBe(true);

    const exported = JSON.parse(await Bun.file(join(exportDir, files[0])).text());
    expect(exported.conversation).toBeDefined();
    expect(Array.isArray(exported.messages)).toBe(true);
    expect(store.getRevision("trace-root")).toBe(rootRevisionBefore);
  });

  test("api routes read the v2 conversation surface", async () => {
    const { store } = createQueryEnv();
    seedQuerySurface(store);

    const routes = createRoutes(null);

    const traceRoute = matchRoute(routes, "GET", "/api/sessions/trace-root");
    expect(traceRoute).not.toBeNull();
    const traceResponse = await traceRoute!.handler(
      new Request("http://localhost/api/sessions/trace-root?view=trace"),
      traceRoute!.params,
    );
    const tracePayload = await traceResponse.json();
    expect(tracePayload.view).toBe("trace");
    expect(tracePayload.conversations).toHaveLength(3);

    const overviewRoute = matchRoute(routes, "GET", "/api/overview");
    expect(overviewRoute).not.toBeNull();
    const overviewResponse = await overviewRoute!.handler(
      new Request("http://localhost/api/overview"),
      overviewRoute!.params,
    );
    const overviewPayload = await overviewResponse.json();
    expect(overviewPayload.conversations).toBe(3);
    expect(overviewPayload.messages).toBeGreaterThan(0);
  });
});

function createQueryEnv(): { dir: string; store: SqliteConversationStore } {
  const dir = mkdtempSync(join(tmpdir(), "jin-read-query-"));
  process.env.JIN_CONFIG_DIR = dir;
  const store = getStore(dir);

  cleanups.push(() => {
    store.close();
    delete process.env.JIN_CONFIG_DIR;

    const delays = [50, 100, 200, 400, 800];
    for (let i = 0; i < delays.length; i += 1) {
      try {
        rmSync(dir, { recursive: true, force: true });
        return;
      } catch {
        if (i < delays.length - 1) {
          Bun.sleepSync(delays[i]);
        }
      }
    }
  });

  return { dir, store };
}

function seedQuerySurface(store: SqliteConversationStore): void {
  store.writeBundle(
    makeBundle("trace-root", {
      conversation: {
        traceId: "trace-root",
        parentId: "",
        relationship: "root",
        startedAt: "2026-04-01T10:00:00.000Z",
        endedAt: "2026-04-01T10:10:00.000Z",
        name: "Root conversation",
        branch: "main",
      },
      messages: [
        makeMessage("trace-root-m1", {
          sequence: 1,
          turn: 1,
          role: "user",
          content: "Investigate the runtime query surface.",
        }),
        makeMessage("trace-root-m2", {
          sequence: 2,
          turn: 1,
          role: "assistant",
          model: "claude-opus",
          content: "I will investigate and spawn diagnostics.",
          toolUses: [makeToolCall("trace-root-tool")],
        }),
      ],
    }),
  );

  store.writeBundle(
    makeBundle("trace-child", {
      conversation: {
        traceId: "trace-root",
        parentId: "trace-root",
        relationship: "spawned",
        forkPoint: 1,
        startedAt: "2026-04-01T10:02:00.000Z",
        endedAt: "2026-04-01T10:05:00.000Z",
        name: "Spawned diagnostics",
      },
      messages: [
        makeMessage("trace-child-m1", {
          sequence: 1,
          turn: 1,
          role: "user",
          content: "Run spawn diagnostics against the stopped runtime.",
        }),
        makeMessage("trace-child-m2", {
          sequence: 2,
          turn: 1,
          role: "assistant",
          model: "claude-opus",
          content: "Spawn diagnostics completed successfully.",
        }),
      ],
    }),
  );

  store.writeBundle(
    makeBundle("trace-root-c1", {
      conversation: {
        traceId: "trace-root",
        parentId: "trace-root",
        relationship: "compacted",
        startedAt: "2026-04-01T10:11:00.000Z",
        endedAt: "2026-04-01T10:18:00.000Z",
        name: "Compacted continuation",
      },
      messages: [
        makeMessage("trace-root-c1-m1", {
          sequence: 1,
          turn: 2,
          role: "system",
          content: "Summary of prior context.",
          recordType: "summary",
        }),
        makeMessage("trace-root-c1-m2", {
          sequence: 2,
          turn: 2,
          role: "assistant",
          model: "claude-opus",
          content: "Continuing after compaction with the same trace.",
          thinkingContent: "Carry forward the trace context.",
          thinkingTokens: 42,
        }),
      ],
    }),
  );
}

function makeBundle(
  id: string,
  overrides: {
    conversation?: Partial<ParsedConversation>;
    messages?: ParsedMessage[];
  } = {},
): ConversationBundle {
  const conversation: ParsedConversation = {
    id,
    traceId: overrides.conversation?.traceId ?? id,
    parentId: overrides.conversation?.parentId ?? "",
    relationship: overrides.conversation?.relationship ?? "root",
    forkPoint: overrides.conversation?.forkPoint ?? -1,
    adapterId: overrides.conversation?.adapterId ?? "claude-code",
    name: overrides.conversation?.name ?? `${id} conversation`,
    cwd: overrides.conversation?.cwd ?? "/Users/test/project",
    gitRemote: overrides.conversation?.gitRemote ?? "github.com/acme/jin",
    branch: overrides.conversation?.branch ?? "feature/read-only-query",
    model: overrides.conversation?.model ?? "claude-opus",
    startedAt: overrides.conversation?.startedAt ?? "2026-04-01T10:00:00.000Z",
    endedAt: overrides.conversation?.endedAt ?? "2026-04-01T10:05:00.000Z",
    sourcePath: overrides.conversation?.sourcePath ?? `/tmp/${id}.jsonl`,
    sourceFormat: overrides.conversation?.sourceFormat ?? "jsonl",
  };

  return {
    conversation,
    messages: overrides.messages ?? [makeMessage(`${id}-m1`)],
  };
}

function makeMessage(
  id: string,
  overrides: Partial<ParsedMessage> = {},
): ParsedMessage {
  return {
    id,
    role: overrides.role ?? "assistant",
    content: overrides.content ?? `${id} content`,
    recordType: overrides.recordType ?? "message",
    model: overrides.model ?? "claude-opus",
    sequence: overrides.sequence ?? 1,
    turn: overrides.turn ?? 1,
    isSidechain: overrides.isSidechain ?? false,
    parentMessageId: overrides.parentMessageId ?? "",
    inputTokens: overrides.inputTokens ?? 10,
    outputTokens: overrides.outputTokens ?? 15,
    cacheRead: overrides.cacheRead ?? 0,
    cacheWrite: overrides.cacheWrite ?? 0,
    thinkingContent: overrides.thinkingContent ?? "",
    thinkingTokens: overrides.thinkingTokens ?? 0,
    timestamp: overrides.timestamp ?? "2026-04-01T10:00:00.000Z",
    toolUses: overrides.toolUses ?? [],
  };
}

function makeToolCall(
  id: string,
  overrides: Partial<ParsedToolCall> = {},
): ParsedToolCall {
  return {
    id,
    name: overrides.name ?? "spawn_worker",
    input: overrides.input ?? '{"task":"diagnostics"}',
    output: overrides.output ?? '{"ok":true}',
    isError: overrides.isError ?? false,
    durationMs: overrides.durationMs ?? 120,
    timestamp: overrides.timestamp ?? "2026-04-01T10:01:00.000Z",
  };
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };

  return {
    logs,
    errors,
    restore() {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}
