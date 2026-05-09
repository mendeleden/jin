import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createApiFetchHandler,
  startLocalApiServer,
} from "../src/api/server";
import { DESKTOP_AUTH_HEADER } from "../src/api/auth";
import { getStore, type SqliteConversationStore } from "../src/db";
import type {
  ConversationBundle,
  ParsedConversation,
  ParsedMessage,
} from "../src/contracts/conversations";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("daemon query boundary", () => {
  test("api fetch handler serves overview, detail, trace, tree, and search from the provided store", async () => {
    const { store } = createQueryEnv();
    seedDaemonQueryStore(store);

    const handler = createApiFetchHandler({ queryStore: store });

    const overviewPayload = await readJson(
      await handler(new Request("http://localhost/api/overview")),
    );
    expect(overviewPayload.conversations).toBe(2);
    expect(overviewPayload.messages).toBe(4);

    const detailPayload = await readJson(
      await handler(new Request("http://localhost/api/conversations/trace-child")),
    );
    expect(detailPayload.conversation.id).toBe("trace-child");
    expect(detailPayload.parent.id).toBe("trace-root");
    expect(detailPayload.messages).toHaveLength(2);

    const tracePayload = await readJson(
      await handler(
        new Request("http://localhost/api/conversations/trace-root?view=trace"),
      ),
    );
    expect(tracePayload.view).toBe("trace");
    expect(tracePayload.conversations).toHaveLength(2);

    const treePayload = await readJson(
      await handler(
        new Request("http://localhost/api/conversations/trace-root?view=tree"),
      ),
    );
    expect(treePayload.view).toBe("tree");
    expect(treePayload.tree.conversation.id).toBe("trace-root");
    expect(treePayload.tree.children).toHaveLength(1);
    expect(treePayload.tree.children[0].conversation.id).toBe("trace-child");

    const searchPayload = await readJson(
      await handler(
        new Request("http://localhost/api/search?q=daemonqueryneedle"),
      ),
    );
    expect(searchPayload).toHaveLength(1);
    expect(searchPayload[0].conversationId).toBe("trace-child");
  });

  test("local api server uses the deterministic socket path and removes stale socket files on stop", async () => {
    const { dir, store } = createQueryEnv();
    seedDaemonQueryStore(store);

    const socketPath = join(dir, "jin.sock");
    writeFileSync(socketPath, "stale");

    const serveCalls: Array<{
      unix: string;
      fetch: (request: Request) => Promise<Response>;
      error: (error: unknown) => Response;
    }> = [];
    const stopCalls: boolean[] = [];

    const server = startLocalApiServer({
      authToken: "socket-test-token",
      platform: "darwin",
      queryStore: store,
      socketPath,
      serve: (options) => {
        expect(existsSync(socketPath)).toBe(false);
        serveCalls.push(options);
        writeFileSync(socketPath, "active");
        return {
          stop(closeActiveConnections?: boolean) {
            stopCalls.push(closeActiveConnections ?? false);
          },
        };
      },
    });

    expect(server).not.toBeNull();
    expect(server!.socketPath).toBe(socketPath);
    expect(server!.localEndpoint).toBe(socketPath);
    expect(serveCalls).toHaveLength(1);
    expect(serveCalls[0].unix).toBe(socketPath);

    const unauthorizedResponse = await serveCalls[0].fetch(
      new Request("http://localhost/api/search?q=daemonqueryneedle"),
    );
    expect(unauthorizedResponse.status).toBe(401);

    const searchResponse = await serveCalls[0].fetch(
      new Request("http://localhost/api/search?q=daemonqueryneedle", {
        headers: { [DESKTOP_AUTH_HEADER]: "socket-test-token" },
      }),
    );
    const searchPayload = await readJson(searchResponse);
    expect(searchPayload).toHaveLength(1);
    expect(searchPayload[0].conversationId).toBe("trace-child");
    expect(existsSync(socketPath)).toBe(true);

    server!.stop();

    expect(stopCalls).toEqual([true]);
    expect(existsSync(socketPath)).toBe(false);
  });

  test("local api server uses the deterministic loopback endpoint on Windows", async () => {
    const { store } = createQueryEnv();
    const socketPath = "http://127.0.0.1:45678";
    const serveCalls: Array<{
      unix: string;
      fetch: (request: Request) => Promise<Response>;
      error: (error: unknown) => Response;
    }> = [];
    const stopCalls: boolean[] = [];

    const server = startLocalApiServer({
      authToken: "windows-test-token",
      platform: "win32",
      queryStore: store,
      socketPath,
      serve: (options) => {
        serveCalls.push(options);
        return {
          stop(closeActiveConnections?: boolean) {
            stopCalls.push(closeActiveConnections ?? false);
          },
        };
      },
    });

    expect(server).not.toBeNull();
    expect(server!.socketPath).toBe(socketPath);
    expect(server!.localEndpoint).toBe(socketPath);
    expect(serveCalls).toHaveLength(1);
    expect(serveCalls[0].unix).toBe(socketPath);

    const unauthorizedResponse = await serveCalls[0].fetch(
      new Request("http://localhost/api/overview"),
    );
    expect(unauthorizedResponse.status).toBe(401);

    const overviewResponse = await serveCalls[0].fetch(
      new Request("http://localhost/api/overview", {
        headers: { [DESKTOP_AUTH_HEADER]: "windows-test-token" },
      }),
    );
    expect(overviewResponse.status).toBe(200);

    server!.stop();
    expect(stopCalls).toEqual([true]);
  });

  test("local api server rejects non-loopback Windows endpoints", () => {
    const { store } = createQueryEnv();

    expect(() =>
      startLocalApiServer({
        authToken: "windows-test-token",
        platform: "win32",
        queryStore: store,
        socketPath: "http://localhost:45678",
        serve: () => ({ stop() {} }),
      }),
    ).toThrow("127.0.0.1");
  });

  test("local api server reports an actionable Windows endpoint collision", () => {
    const { store } = createQueryEnv();

    expect(() =>
      startLocalApiServer({
        authToken: "windows-test-token",
        platform: "win32",
        queryStore: store,
        socketPath: "http://127.0.0.1:45678",
        serve: () => {
          throw new Error("EADDRINUSE");
        },
      }),
    ).toThrow("Another process may already be listening");
  });

  test("local api server rejects path-bearing Windows endpoints", () => {
    const { store } = createQueryEnv();

    expect(() =>
      startLocalApiServer({
        authToken: "windows-test-token",
        platform: "win32",
        queryStore: store,
        socketPath: "http://127.0.0.1:45678/api",
        serve: () => ({ stop() {} }),
      }),
    ).toThrow("must not include a path");
  });
});

function createQueryEnv(): { dir: string; store: SqliteConversationStore } {
  const dir = mkdtempSync(join(tmpdir(), "jin-daemon-query-"));
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

function seedDaemonQueryStore(store: SqliteConversationStore): void {
  store.writeBundle(
    makeBundle("trace-root", {
      conversation: {
        traceId: "trace-root",
        relationship: "root",
        name: "Root daemon query conversation",
      },
      messages: [
        makeMessage("trace-root-m1", {
          role: "user",
          content: "Summarize the daemon query boundary.",
        }),
        makeMessage("trace-root-m2", {
          role: "assistant",
          content: "The daemon should serve local overview and trace queries.",
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
        name: "Spawned daemon boundary search",
      },
      messages: [
        makeMessage("trace-child-m1", {
          role: "user",
          content: "Search the daemon boundary for detail views.",
        }),
        makeMessage("trace-child-m2", {
          role: "assistant",
          content:
            "The daemon boundary returns detail views without direct SQLite access and carries daemonqueryneedle evidence.",
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
    branch: overrides.conversation?.branch ?? "feature/daemon-query",
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

async function readJson(response: Response): Promise<any> {
  expect(response.status).toBe(200);
  return response.json();
}
