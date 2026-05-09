import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createApiFetchHandler } from "../src/api/server";
import { getStore, type SqliteConversationStore } from "../src/db";
import type {
  ConversationBundle,
  ParsedConversation,
  ParsedMessage,
} from "../src/contracts/conversations";
import {
  CLI_UPDATE_COMMAND,
  DESKTOP_API_VERSION,
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
    expect(payload.topTools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "Grep",
      "Read",
    ]);
    expect(payload.topProjects[0].gitRemote).toBe("github.com/acme/jin");
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

async function readJson(response: Response): Promise<any> {
  expect(response.status).toBe(200);
  return response.json();
}
