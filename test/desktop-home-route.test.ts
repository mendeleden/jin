import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createApiFetchHandler } from "../src/api/server";
import {
  DESKTOP_CONVERSATION_LIST_DEFAULT_LIMIT,
  DESKTOP_CONVERSATION_LIST_MAX_LIMIT,
  buildDesktopLogsView,
} from "../src/api/routes";
import { getStore, type SqliteConversationStore } from "../src/db";
import type {
  ConversationBundle,
  ParsedConversation,
  ParsedMessage,
} from "../src/contracts/conversations";
import {
  CLI_UPDATE_COMMAND,
  DESKTOP_API_VERSION,
  DESKTOP_HOME_TOKEN_USAGE_DEFAULT_DAYS,
  DESKTOP_HOME_TOKEN_USAGE_MAX_DAYS,
  DESKTOP_MINIMUM_API_VERSION,
  DESKTOP_UPDATE_COMMAND,
} from "../src/contracts/desktop";
import { VERSION } from "../src/updater";
import { removeTestDir } from "./helpers";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("desktop viewer routes", () => {
  test("serves desktop compatibility metadata before data routes", async () => {
    const { store } = createQueryEnv();
    const handler = createApiFetchHandler({ queryStore: store });

    const response = await handler(
      new Request("http://localhost/api/desktop/compatibility"),
    );
    const payload = await readJson(response);

    expect(payload).toEqual({
      jinVersion: VERSION,
      desktopApiVersion: DESKTOP_API_VERSION,
      minimumDesktopApiVersion: DESKTOP_MINIMUM_API_VERSION,
      updateCommand: DESKTOP_UPDATE_COMMAND,
      cliUpdateCommand: CLI_UPDATE_COMMAND,
    });
  });

  test("serves bounded desktop log tails without exposing direct file access to renderer", () => {
    const dir = mkdtempSync(join(tmpdir(), "jin-desktop-logs-"));
    cleanups.push(() => removeTestDir(dir));
    const logPath = join(dir, "jin.log");
    writeFileSync(
      logPath,
      [
        "Local daemon query socket ready.",
        "WARN watcher restart delayed.",
        "Pushed 2 conversations to sink team-postgres.",
      ].join("\n"),
      "utf8",
    );

    const payload = buildDesktopLogsView(logPath, { limit: 2 });

    expect(payload.path).toBe(logPath);
    expect(payload.limit).toBe(2);
    expect(payload.totalLines).toBe(3);
    expect(payload.returnedLines).toBe(2);
    expect(payload.truncated).toBe(true);
    expect(payload.lines).toEqual([
      "WARN watcher restart delayed.",
      "Pushed 2 conversations to sink team-postgres.",
    ]);

    expect(buildDesktopLogsView(join(dir, "missing.log"), { limit: 2 })).toMatchObject({
      totalLines: 0,
      returnedLines: 0,
      lines: [],
    });
  });

  test("serves a typed home payload that reuses canonical conversation entities", async () => {
    const { store } = createQueryEnv();
    seedDesktopStore(store);

    const handler = createApiFetchHandler({ queryStore: store });
    const response = await handler(new Request("http://localhost/api/desktop/home"));
    const payload = await readJson(response);

    expect(payload.overview.conversations).toBe(3);
    expect(payload.overview.toolCalls).toBe(2);
    expect(payload.recentConversations).toHaveLength(3);
    expect(payload.recentConversations[0].traceId).toBeDefined();
    expect(payload.recentConversations[0].relationship).toBeDefined();
    expect("parentSessionId" in payload.recentConversations[0]).toBe(false);
    expect(payload.topAdapters[0].adapterId).toBe("claude-code");
    expect(payload.topModels[0]).toEqual({
      model: "claude-opus",
      messages: 4,
      inputTokens: 40,
      outputTokens: 60,
    });
    expect(payload.tokenUsageByDay).toEqual([
      {
        day: "2026-04-29",
        adapterId: "claude-code",
        sessions: 2,
        tokens: 75,
        cost: payload.tokenUsageByDay[0].cost,
      },
      {
        day: "2026-04-29",
        adapterId: "codex",
        sessions: 1,
        tokens: 25,
        cost: payload.tokenUsageByDay[1].cost,
      },
    ]);
    expect(payload.tokenUsageByWeek).toEqual([
      {
        weekStart: "2026-04-27",
        weekEnd: "2026-05-03",
        adapterId: "claude-code",
        sessions: 2,
        tokens: 75,
        cost: payload.tokenUsageByWeek[0].cost,
      },
      {
        weekStart: "2026-04-27",
        weekEnd: "2026-05-03",
        adapterId: "codex",
        sessions: 1,
        tokens: 25,
        cost: payload.tokenUsageByWeek[1].cost,
      },
    ]);
    expect(payload.topTools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "Grep",
      "Read",
    ]);
    expect(payload.topProjects[0].gitRemote).toBe("github.com/acme/jin");
    expect(payload.projectUsageByHarness[0]).toMatchObject({
      gitRemote: "github.com/acme/jin",
      conversationCount: 3,
      adapters: [
        {
          adapterId: "claude-code",
          conversations: 2,
          tokens: 75,
        },
        {
          adapterId: "codex",
          conversations: 1,
          tokens: 25,
        },
      ],
    });
    expect(
      payload.relationshipMix.toSorted(
        (left: { relationship: string }, right: { relationship: string }) =>
          left.relationship.localeCompare(right.relationship),
      ),
    ).toEqual([
      { relationship: "forked", conversations: 1 },
      { relationship: "root", conversations: 1 },
      { relationship: "spawned", conversations: 1 },
    ]);
  });

  test("serves enough token history for monthly home rollups", async () => {
    const { store } = createQueryEnv();
    const historyAgeDays = 120;
    const historyAt = isoDaysAgo(historyAgeDays);
    const historyDay = historyAt.slice(0, 10);

    store.writeBundle(
      makeBundle("desktop-history-window", {
        conversation: {
          startedAt: historyAt,
          endedAt: historyAt,
        },
      }),
    );

    const handler = createApiFetchHandler({ queryStore: store });
    const response = await handler(
      new Request("http://localhost/api/desktop/home?tokenUsageDays=365"),
    );
    const payload = await readJson(response);

    expect(historyAgeDays).toBeGreaterThan(30);
    expect(
      payload.tokenUsageByDay.some(
        (entry: { day: string }) => entry.day === historyDay,
      ),
    ).toBe(true);
  });

  test("bounds desktop home token history from request parameters", async () => {
    const { store } = createQueryEnv();
    const recentAt = isoDaysAgo(5);
    const olderAt = isoDaysAgo(45);

    store.writeBundle(
      makeBundle("desktop-history-recent", {
        conversation: {
          startedAt: recentAt,
          endedAt: recentAt,
        },
      }),
    );
    store.writeBundle(
      makeBundle("desktop-history-older", {
        conversation: {
          startedAt: olderAt,
          endedAt: olderAt,
        },
      }),
    );

    const handler = createApiFetchHandler({ queryStore: store });
    const response = await handler(
      new Request("http://localhost/api/desktop/home?tokenUsageDays=30"),
    );
    const payload = await readJson(response);
    const days = payload.tokenUsageByDay.map((entry: { day: string }) => entry.day);

    expect(days).toContain(recentAt.slice(0, 10));
    expect(days).not.toContain(olderAt.slice(0, 10));

    const malformedResponse = await handler(
      new Request("http://localhost/api/desktop/home?tokenUsageDays=not-a-number"),
    );
    const malformedPayload = await readJson(malformedResponse);
    expect(
      malformedPayload.tokenUsageByDay.some(
        (entry: { day: string }) => entry.day === olderAt.slice(0, 10),
      ),
    ).toBe(true);

    const oversizedResponse = await handler(
      new Request(
        `http://localhost/api/desktop/home?tokenUsageDays=${
          DESKTOP_HOME_TOKEN_USAGE_MAX_DAYS + 1
        }`,
      ),
    );
    const oversizedPayload = await readJson(oversizedResponse);
    expect(oversizedPayload.tokenUsageByDay.length).toBeGreaterThan(0);
    expect(DESKTOP_HOME_TOKEN_USAGE_DEFAULT_DAYS).toBe(365);
  });

  test("serves conversation list/detail/trace/tree routes without v1 aliases", async () => {
    const { store } = createQueryEnv();
    seedDesktopStore(store);

    const handler = createApiFetchHandler({ queryStore: store });

    const listResponse = await handler(
      new Request(
        "http://localhost/api/desktop/conversations?adapter=claude-code&limit=12",
      ),
    );
    const listPayload = await readJson(listResponse);

    expect(listPayload.filters).toEqual({
      adapterId: "claude-code",
      since: null,
      limit: 12,
    });
    expect(listPayload.availableAdapters).toEqual(["claude-code", "codex"]);
    expect(listPayload.conversations).toHaveLength(2);
    expect(listPayload.conversations[0].id).toBe("desktop-child");
    expect("parentSessionId" in listPayload.conversations[0]).toBe(false);

    const limitedListResponse = await handler(
      new Request(
        "http://localhost/api/desktop/conversations?adapter=claude-code&limit=1",
      ),
    );
    const limitedListPayload = await readJson(limitedListResponse);

    expect(limitedListPayload.conversations).toHaveLength(1);
    expect(
      limitedListPayload.relationshipMix.toSorted(
        (left: { relationship: string }, right: { relationship: string }) =>
          left.relationship.localeCompare(right.relationship),
      ),
    ).toEqual([
      { relationship: "root", conversations: 1 },
      { relationship: "spawned", conversations: 1 },
    ]);

    const detailResponse = await handler(
      new Request("http://localhost/api/desktop/conversations/desktop-child"),
    );
    const detailPayload = await readJson(detailResponse);

    expect(detailPayload.conversation.id).toBe("desktop-child");
    expect("parentSessionId" in detailPayload.conversation).toBe(false);
    expect(detailPayload.parent.id).toBe("desktop-root");
    expect(detailPayload.children.map((child: { id: string }) => child.id)).toEqual([
      "desktop-fork",
    ]);
    expect(detailPayload.trace).toEqual({
      traceId: "desktop-root",
      rootId: "desktop-root",
      conversationCount: 3,
    });

    const traceResponse = await handler(
      new Request("http://localhost/api/desktop/conversations/desktop-child/trace"),
    );
    const tracePayload = await readJson(traceResponse);

    expect(tracePayload.selectedConversationId).toBe("desktop-child");
    expect(tracePayload.rootId).toBe("desktop-root");
    expect(tracePayload.conversations).toHaveLength(3);
    expect("session" in tracePayload.conversations[0]).toBe(false);
    expect(tracePayload.tree.conversation.id).toBe("desktop-root");

    const treeResponse = await handler(
      new Request("http://localhost/api/desktop/conversations/desktop-child/tree"),
    );
    const treePayload = await readJson(treeResponse);

    expect(treePayload.traceId).toBe("desktop-root");
    expect(treePayload.selectedConversationId).toBe("desktop-child");
    expect(treePayload.tree.conversation.id).toBe("desktop-root");
    expect(treePayload.tree.children[0].conversation.id).toBe("desktop-child");
  });

  test("clamps malformed desktop conversation list limits before querying", async () => {
    const { store } = createQueryEnv();
    seedManyDesktopConversations(store, DESKTOP_CONVERSATION_LIST_DEFAULT_LIMIT + 12);

    const handler = createApiFetchHandler({ queryStore: store });

    for (const limit of ["abc", "0", "-5", "12.5"]) {
      const response = await handler(
        new Request(`http://localhost/api/desktop/conversations?limit=${limit}`),
      );
      const payload = await readJson(response);

      expect(payload.filters.limit).toBe(DESKTOP_CONVERSATION_LIST_DEFAULT_LIMIT);
      expect(payload.conversations).toHaveLength(
        DESKTOP_CONVERSATION_LIST_DEFAULT_LIMIT,
      );
    }

    const cappedResponse = await handler(
      new Request("http://localhost/api/desktop/conversations?limit=999999"),
    );
    const cappedPayload = await readJson(cappedResponse);

    expect(cappedPayload.filters.limit).toBe(DESKTOP_CONVERSATION_LIST_MAX_LIMIT);
    expect(cappedPayload.conversations).toHaveLength(
      DESKTOP_CONVERSATION_LIST_DEFAULT_LIMIT + 12,
    );
  });
});

function createQueryEnv(): { dir: string; store: SqliteConversationStore } {
  const dir = mkdtempSync(join(tmpdir(), "jin-desktop-home-"));
  process.env.JIN_CONFIG_DIR = dir;
  const store = getStore(dir);

  cleanups.push(() => {
    store.close();
    delete process.env.JIN_CONFIG_DIR;
    removeTestDir(dir);
  });

  return { dir, store };
}

function seedDesktopStore(store: SqliteConversationStore): void {
  store.writeBundle(
    makeBundle("desktop-root", {
      conversation: {
        traceId: "desktop-root",
        relationship: "root",
        name: "Desktop healthy home",
        startedAt: "2026-04-29T08:00:00.000Z",
        endedAt: "2026-04-29T08:12:00.000Z",
      },
      messages: [
        makeMessage("desktop-root-m1", {
          role: "user",
          content: "Summarize the Desktop shell.",
          toolUses: [
            makeToolCall("tool-read", {
              name: "Read",
            }),
          ],
        }),
        makeMessage("desktop-root-m2", {
          role: "assistant",
          content: "The daemon owns the canonical store and serves the home route.",
        }),
      ],
    }),
  );

  store.writeBundle(
    makeBundle("desktop-child", {
      conversation: {
        traceId: "desktop-root",
        parentId: "desktop-root",
        relationship: "spawned",
        name: "Spawned project summary",
        startedAt: "2026-04-29T08:20:00.000Z",
        endedAt: "2026-04-29T08:30:00.000Z",
      },
      messages: [
        makeMessage("desktop-child-m1", {
          role: "assistant",
          content: "Project and tool summaries should stay daemon-backed.",
          toolUses: [
            makeToolCall("tool-grep", {
              name: "Grep",
            }),
          ],
        }),
      ],
    }),
  );

  store.writeBundle(
    makeBundle("desktop-fork", {
      conversation: {
        traceId: "desktop-root",
        parentId: "desktop-child",
        relationship: "forked",
        adapterId: "codex",
        name: "Forked trace review",
        startedAt: "2026-04-29T08:31:00.000Z",
        endedAt: "2026-04-29T08:36:00.000Z",
      },
      messages: [
        makeMessage("desktop-fork-m1", {
          role: "assistant",
          content: "Forked child traces stay visible in tree view.",
        }),
      ],
    }),
  );
}

function seedManyDesktopConversations(
  store: SqliteConversationStore,
  count: number,
): void {
  for (let index = 0; index < count; index += 1) {
    const minute = String(index % 60).padStart(2, "0");
    store.writeBundle(
      makeBundle(`desktop-limit-${index}`, {
        conversation: {
          name: `Desktop limit fixture ${index}`,
          startedAt: `2026-04-30T10:${minute}:00.000Z`,
          endedAt: `2026-04-30T10:${minute}:30.000Z`,
        },
      }),
    );
  }
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
    branch: overrides.conversation?.branch ?? "feature/desktop-shell",
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
  overrides: Partial<ParsedMessage["toolUses"][number]> = {},
): ParsedMessage["toolUses"][number] {
  return {
    id,
    name: overrides.name ?? "Read",
    input: overrides.input ?? "",
    output: overrides.output ?? "",
    isError: overrides.isError ?? false,
    durationMs: overrides.durationMs ?? 1,
    timestamp: overrides.timestamp ?? "2026-04-01T10:00:00.000Z",
  };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function readJson(response: Response): Promise<any> {
  expect(response.status).toBe(200);
  return response.json();
}
