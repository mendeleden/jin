import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { DESKTOP_IPC_CHANNELS, createDesktopBridge } from "../desktop/bridge";
import { createDesktopDaemonClient } from "../desktop/daemon-client";
import {
  DESKTOP_DEV_SERVER_URL_ENV,
  normalizeDesktopDevServerUrl,
  resolveDesktopEntry,
} from "../desktop/entry";
import { installDesktopBridge } from "../desktop/preload";
import {
  DESKTOP_CONTENT_SECURITY_POLICY,
  DESKTOP_PRELOAD_FILE,
  DESKTOP_WEB_PREFERENCES,
} from "../desktop/security";
import { DESKTOP_AUTH_HEADER } from "../src/api/auth";
import {
  createDesktopShellService,
  registerDesktopIpcHandlers,
} from "../desktop/shell-service";
import type {
  Conversation,
  Message,
  ToolCall,
} from "../src/contracts/conversations";
import type {
  DesktopCompatibilityInfo,
  DesktopConversationDetailView,
  DesktopConversationListView,
  DesktopHomeData,
  DesktopLogsView,
  DesktopRoutingView,
  DesktopTraceView,
  DesktopTreeView,
} from "../src/contracts/desktop";
import {
  CLI_UPDATE_COMMAND,
  DESKTOP_API_VERSION,
  DESKTOP_MINIMUM_API_VERSION,
  DESKTOP_UPDATE_COMMAND,
} from "../src/contracts/desktop";
import { VERSION } from "../src/updater";

describe("desktop shell service", () => {
  test("desktop shell keeps hardened renderer defaults", () => {
    expect(DESKTOP_PRELOAD_FILE).toBe("preload.cjs");
    expect(DESKTOP_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });

    const html = readFileSync(
      new URL("../desktop/index.html", import.meta.url),
      "utf8",
    );
    expect(html).toContain(`content="${DESKTOP_CONTENT_SECURITY_POLICY}"`);
    expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(DESKTOP_CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });

  test("desktop dev entry is explicit localhost-only React/Vite wiring", () => {
    const currentDir = "/tmp/jin-desktop-dist";

    expect(resolveDesktopEntry(currentDir, {})).toEqual({
      kind: "file",
      filePath: join(currentDir, "index.html"),
    });
    expect(
      resolveDesktopEntry(currentDir, {
        [DESKTOP_DEV_SERVER_URL_ENV]:
          "http://127.0.0.1:5174/desktop/index.dev.html",
      }),
    ).toEqual({
      kind: "dev-server",
      url: "http://127.0.0.1:5174/desktop/index.dev.html",
    });
    expect(() =>
      normalizeDesktopDevServerUrl("https://127.0.0.1:5174"),
    ).toThrow("must use http");
    expect(() =>
      normalizeDesktopDevServerUrl("http://192.168.1.20:5174"),
    ).toThrow("must point at localhost");

    const devHtml = readFileSync(
      new URL("../desktop/index.dev.html", import.meta.url),
      "utf8",
    );
    expect(devHtml).toContain("/desktop/react-entry.tsx");
    expect(devHtml).toContain("ws://127.0.0.1:*");
    expect(devHtml).toContain("http://localhost:*");
  });

  test("daemon client reads the typed desktop viewer route paths", async () => {
    const requests: Array<{
      method: string;
      path: string;
      headers?: Record<string, string>;
    }> = [];
    const client = createDesktopDaemonClient({
      authToken: "desktop-test-token",
      socketPath: "/tmp/jin.sock",
      request: async (request) => {
        requests.push(request);
        return {
          statusCode: 200,
          body: JSON.stringify(resolveRoutePayload(request.path)),
          headers: {},
        };
      },
    });

    const compatibility = await client.getCompatibility();
    const home = await client.getHomeData();
    const list = await client.listConversations({
      adapterId: "claude-code",
      since: "7d",
      limit: 12,
    });
    const logs = await client.getLogs({ limit: 25 });
    const routing = await client.getRouting();
    const detail = await client.getConversationDetail("desktop-child");
    const trace = await client.getTraceView("desktop-child");
    const tree = await client.getTreeView("desktop-child");

    expect(compatibility.desktopApiVersion).toBe(DESKTOP_API_VERSION);
    expect(home.overview.conversations).toBe(3);
    expect(list.conversations[0]?.id).toBe("desktop-child");
    expect(logs.lines.at(-1)).toBe("Pushed 2 conversations to sink team-postgres.");
    expect(routing.projects[0]?.sinks[0]?.sinkId).toBe("team-postgres");
    expect(detail.conversation.id).toBe("desktop-child");
    expect(trace.selectedConversationId).toBe("desktop-child");
    expect(tree.selectedConversationId).toBe("desktop-child");
    expect(
      requests.map((request) => ({
        method: request.method,
        path: request.path,
      })),
    ).toEqual([
      { method: "GET", path: "/api/desktop/compatibility" },
      { method: "GET", path: "/api/desktop/home?tokenUsageDays=365" },
      {
        method: "GET",
        path: "/api/desktop/conversations?adapter=claude-code&since=7d&limit=12",
      },
      { method: "GET", path: "/api/desktop/logs?limit=25" },
      { method: "GET", path: "/api/desktop/routing" },
      { method: "GET", path: "/api/desktop/conversations/desktop-child" },
      { method: "GET", path: "/api/desktop/conversations/desktop-child/trace" },
      { method: "GET", path: "/api/desktop/conversations/desktop-child/tree" },
    ]);
    expect(
      requests.every(
        (request) =>
          request.headers?.[DESKTOP_AUTH_HEADER] === "desktop-test-token",
      ),
    ).toBe(true);
  });

  test("stopped runtime returns a stopped snapshot without querying the daemon socket", async () => {
    const service = createDesktopShellService({
      controlBoundary: {
        getStatus: () => makeStatus("stopped"),
        runAction: async () => makeActionResult("start"),
      },
      daemonClient: makeDaemonClient({
        getHomeData() {
          throw new Error("daemon client should not run for a stopped runtime");
        },
      }),
    });

    const snapshot = await service.getHomeSnapshot();

    expect(snapshot.status.runtime.state).toBe("stopped");
    expect(snapshot.compatibility).toBeNull();
    expect(snapshot.data).toBeNull();
    expect(snapshot.transportError).toBeNull();
  });

  test("running runtime returns an update message when desktop protocol is too old", async () => {
    const service = createDesktopShellService({
      controlBoundary: {
        getStatus: () => makeStatus("running"),
        runAction: async () => makeActionResult("restart"),
      },
      daemonClient: makeDaemonClient({
        async getCompatibility() {
          return makeCompatibilityInfo({
            desktopApiVersion: 2,
            minimumDesktopApiVersion: 2,
          });
        },
        async getHomeData() {
          throw new Error("home data should not load when desktop is incompatible");
        },
      }),
    });

    const snapshot = await service.getHomeSnapshot();

    expect(snapshot.data).toBeNull();
    expect(snapshot.compatibility?.compatible).toBe(false);
    expect(snapshot.compatibility?.reason).toBe("desktop_too_old");
    expect(snapshot.transportError).toContain("jin desktop --update");
  });

  test("ipc handlers and preload bridge stay on typed channels", async () => {
    const service = createDesktopShellService({
      controlBoundary: {
        getStatus: () => makeStatus("running"),
        runAction: async (action) => makeActionResult(action),
      },
      daemonClient: makeDaemonClient(),
    });

    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerDesktopIpcHandlers(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        removeHandler(channel) {
          handlers.delete(channel);
        },
      },
      service,
    );

    const exposed: Array<{ key: string; api: ReturnType<typeof createDesktopBridge> }> = [];
    const bridge = installDesktopBridge(
      {
        exposeInMainWorld(key, api) {
          exposed.push({ key, api: api as ReturnType<typeof createDesktopBridge> });
        },
      },
      {
        async invoke(channel, ...args) {
          const handler = handlers.get(channel);
          if (!handler) {
            throw new Error(`Missing IPC handler for ${channel}`);
          }

          return handler({}, ...args);
        },
      },
    );

    expect(exposed).toHaveLength(1);
    expect(exposed[0].key).toBe("jinDesktop");

    const snapshot = await bridge.getHomeSnapshot();
    const list = await bridge.listConversations({ limit: 4 });
    const logs = await bridge.getLogs({ limit: 12 });
    const routing = await bridge.getRouting();
    const detail = await bridge.getConversationDetail("desktop-child");
    const trace = await bridge.getTraceView("desktop-child");
    const tree = await bridge.getTreeView("desktop-child");
    const actionResult = await bridge.runControlAction("restart");

    expect(snapshot.data?.overview.conversations).toBe(3);
    expect(list.conversations[0]?.id).toBe("desktop-child");
    expect(logs.returnedLines).toBe(3);
    expect(routing.projects[0]?.gitRemote).toBe("github.com/acme/jin");
    expect(detail.parent?.id).toBe("desktop-root");
    expect(trace.conversations).toHaveLength(2);
    expect(tree.tree?.conversation.id).toBe("desktop-root");
    expect(actionResult.action).toBe("restart");
    expect(Array.from(handlers.keys())).toEqual([
      DESKTOP_IPC_CHANNELS.homeSnapshot,
      DESKTOP_IPC_CHANNELS.controlAction,
      DESKTOP_IPC_CHANNELS.logs,
      DESKTOP_IPC_CHANNELS.routing,
      DESKTOP_IPC_CHANNELS.conversationList,
      DESKTOP_IPC_CHANNELS.conversationDetail,
      DESKTOP_IPC_CHANNELS.traceView,
      DESKTOP_IPC_CHANNELS.treeView,
    ]);

    await expect(
      invokeRegisteredHandler(
        handlers,
        DESKTOP_IPC_CHANNELS.controlAction,
        "delete",
      ),
    ).rejects.toThrow("Invalid Desktop control action");
    await expect(
      invokeRegisteredHandler(
        handlers,
        DESKTOP_IPC_CHANNELS.logs,
        { limit: 0 },
      ),
    ).rejects.toThrow("Invalid Desktop logs limit");
    await expect(
      invokeRegisteredHandler(
        handlers,
        DESKTOP_IPC_CHANNELS.conversationList,
        { limit: 0 },
      ),
    ).rejects.toThrow("Invalid Desktop conversation list limit");
    await expect(
      invokeRegisteredHandler(
        handlers,
        DESKTOP_IPC_CHANNELS.conversationDetail,
        "",
      ),
    ).rejects.toThrow("Invalid Desktop conversation id");
  });
});

function invokeRegisteredHandler(
  handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>,
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  return Promise.resolve().then(() => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`Missing IPC handler for ${channel}`);
    }

    return handler({}, ...args);
  });
}

function resolveRoutePayload(path: string): unknown {
  if (path === "/api/desktop/compatibility") {
    return makeCompatibilityInfo();
  }

  if (path === "/api/desktop/home?tokenUsageDays=365") {
    return makeHomeData();
  }

  if (
    path ===
    "/api/desktop/conversations?adapter=claude-code&since=7d&limit=12"
  ) {
    return makeConversationListView();
  }

  if (path === "/api/desktop/logs?limit=25") {
    return makeLogsView();
  }

  if (path === "/api/desktop/routing") {
    return makeRoutingView();
  }

  if (path === "/api/desktop/conversations/desktop-child") {
    return makeConversationDetailView();
  }

  if (path === "/api/desktop/conversations/desktop-child/trace") {
    return makeTraceView();
  }

  if (path === "/api/desktop/conversations/desktop-child/tree") {
    return makeTreeView();
  }

  throw new Error(`Unexpected path ${path}`);
}

function makeHomeData(): DesktopHomeData {
  return {
    generatedAt: "2026-04-29T08:55:00.000Z",
    overview: {
      conversations: 3,
      messages: 8,
      toolCalls: 5,
      traces: 2,
      tokens: 244,
      displayTokens: 212,
      cacheTokens: 32,
      cost: 1.32,
      projects: 1,
    },
    recentConversations: [makeChildConversation(), makeRootConversation()],
    topAdapters: [
      {
        adapterId: "claude-code",
        conversations: 3,
        messages: 8,
        tokens: 244,
        displayTokens: 212,
        cacheTokens: 32,
        cost: 1.32,
      },
    ],
    topModels: [
      {
        model: "claude-opus",
        messages: 8,
        inputTokens: 110,
        outputTokens: 102,
      },
    ],
    topTools: [{ name: "Read", calls: 5, conversationCount: 3 }],
    topProjects: [
      {
        id: "github.com%2Facme%2Fjin",
        name: "github.com/acme/jin",
        gitRemote: "github.com/acme/jin",
        conversationCount: 3,
        totalTokens: 244,
        totalCost: 1.32,
        lastSeen: "2026-04-29T08:55:00.000Z",
        adapters: ["claude-code"],
      },
    ],
    projectUsageByHarness: [
      {
        id: "github.com%2Facme%2Fjin",
        name: "github.com/acme/jin",
        gitRemote: "github.com/acme/jin",
        conversationCount: 3,
        totalTokens: 244,
        totalCost: 1.32,
        lastSeen: "2026-04-29T08:55:00.000Z",
        adapters: [
          {
            adapterId: "claude-code",
            conversations: 3,
            tokens: 244,
            cost: 1.32,
          },
        ],
      },
    ],
    relationshipMix: [
      { relationship: "root", conversations: 1 },
      { relationship: "spawned", conversations: 1 },
      { relationship: "forked", conversations: 1 },
    ],
    tokenUsageByDay: [
      {
        day: "2026-04-28",
        adapterId: "claude-code",
        sessions: 1,
        tokens: 100,
        cost: 0.52,
      },
      {
        day: "2026-04-29",
        adapterId: "claude-code",
        sessions: 2,
        tokens: 144,
        cost: 0.8,
      },
    ],
    tokenUsageByWeek: [
      {
        weekStart: "2026-04-27",
        weekEnd: "2026-05-03",
        adapterId: "claude-code",
        sessions: 3,
        tokens: 244,
        cost: 1.32,
      },
    ],
  };
}

function makeLogsView(): DesktopLogsView {
  return {
    generatedAt: "2026-04-29T08:55:00.000Z",
    path: "/tmp/jin/jin.log",
    limit: 25,
    totalLines: 3,
    returnedLines: 3,
    truncated: false,
    lines: [
      "Local daemon query socket ready.",
      "WARN watcher restart delayed.",
      "Pushed 2 conversations to sink team-postgres.",
    ],
  };
}

function makeRoutingView(): DesktopRoutingView {
  return {
    generatedAt: "2026-04-29T08:55:00.000Z",
    sinks: [
      {
        id: "team-postgres",
        type: "postgres",
        enabled: true,
        name: "team-postgres",
        teamId: "jin-team",
        userId: "eden-mbp",
      },
    ],
    routes: [
      {
        index: 0,
        match: {
          remote: "github.com/acme/*",
        },
        sinkIds: ["team-postgres"],
      },
    ],
    projects: [
      {
        id: "github.com%2Facme%2Fjin",
        name: "github.com/acme/jin",
        gitRemote: "github.com/acme/jin",
        conversationCount: 3,
        routedConversations: 3,
        unroutedConversations: 0,
        totalTokens: 244,
        totalCost: 1.32,
        lastSeen: "2026-04-29T08:55:00.000Z",
        adapters: ["claude-code"],
        sinks: [
          {
            sinkId: "team-postgres",
            routedConversations: 3,
            active: true,
          },
        ],
      },
    ],
  };
}

function makeConversationListView(): DesktopConversationListView {
  return {
    generatedAt: "2026-04-29T08:55:00.000Z",
    filters: {
      adapterId: "claude-code",
      since: "7d",
      limit: 12,
    },
    availableAdapters: ["claude-code", "codex"],
    relationshipMix: [
      { relationship: "spawned", conversations: 1 },
      { relationship: "root", conversations: 1 },
    ],
    conversations: [makeChildConversation(), makeRootConversation()],
  };
}

function makeConversationDetailView(): DesktopConversationDetailView {
  return {
    conversation: makeChildConversation(),
    messages: [
      makeMessage("desktop-child-m1", {
        role: "user",
        content: "Summarize the spawned project state.",
      }),
      makeMessage("desktop-child-m2", {
        role: "assistant",
        content: "The spawned branch stays attached to the root trace.",
      }),
    ],
    toolCalls: [
      makeToolCall("tool-read", {
        conversationId: "desktop-child",
        messageId: "desktop-child-m2",
      }),
    ],
    parent: makeRootConversation(),
    children: [makeForkConversation()],
    trace: {
      traceId: "desktop-root",
      rootId: "desktop-root",
      conversationCount: 2,
    },
  };
}

function makeTraceView(): DesktopTraceView {
  return {
    traceId: "desktop-root",
    rootId: "desktop-root",
    selectedConversationId: "desktop-child",
    conversations: [
      {
        conversation: makeRootConversation(),
        messages: [makeMessage("desktop-root-m1")],
        toolCalls: [makeToolCall("tool-grep")],
      },
      {
        conversation: makeChildConversation(),
        messages: [makeMessage("desktop-child-m1")],
        toolCalls: [makeToolCall("tool-read", { conversationId: "desktop-child" })],
      },
    ],
    tree: makeTreeView().tree,
  };
}

function makeTreeView(): DesktopTreeView {
  return {
    traceId: "desktop-root",
    selectedConversationId: "desktop-child",
    tree: {
      conversation: makeRootConversation(),
      children: [
        {
          conversation: makeChildConversation(),
          children: [],
        },
      ],
    },
  };
}

function makeRootConversation(): Conversation {
  return makeConversation("desktop-root", {
    traceId: "desktop-root",
    relationship: "root",
    name: "Desktop root conversation",
    messageCount: 3,
    toolCount: 2,
  });
}

function makeChildConversation(): Conversation {
  return makeConversation("desktop-child", {
    traceId: "desktop-root",
    parentId: "desktop-root",
    relationship: "spawned",
    name: "Spawned project summary",
    startedAt: "2026-04-29T08:21:00.000Z",
    endedAt: "2026-04-29T08:30:00.000Z",
    messageCount: 2,
    toolCount: 1,
  });
}

function makeForkConversation(): Conversation {
  return makeConversation("desktop-fork", {
    traceId: "desktop-root",
    parentId: "desktop-child",
    relationship: "forked",
    name: "Forked trace review",
    startedAt: "2026-04-29T08:31:00.000Z",
    endedAt: "2026-04-29T08:36:00.000Z",
    messageCount: 2,
    toolCount: 0,
  });
}

function makeConversation(
  id: string,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    traceId: overrides.traceId ?? id,
    parentId: overrides.parentId ?? "",
    relationship: overrides.relationship ?? "root",
    forkPoint: overrides.forkPoint ?? -1,
    adapterId: overrides.adapterId ?? "claude-code",
    name: overrides.name ?? `${id} conversation`,
    cwd: overrides.cwd ?? "/Users/test/project",
    gitRemote: overrides.gitRemote ?? "github.com/acme/jin",
    branch: overrides.branch ?? "feature/desktop",
    model: overrides.model ?? "claude-opus",
    startedAt: overrides.startedAt ?? "2026-04-29T08:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-04-29T08:10:00.000Z",
    sourcePath: overrides.sourcePath ?? `/tmp/${id}.jsonl`,
    sourceFormat: overrides.sourceFormat ?? "jsonl",
    durationMs: overrides.durationMs ?? 600_000,
    messageCount: overrides.messageCount ?? 3,
    toolCount: overrides.toolCount ?? 1,
    turnCount: overrides.turnCount ?? 2,
    inputTokens: overrides.inputTokens ?? 44,
    outputTokens: overrides.outputTokens ?? 66,
    cacheRead: overrides.cacheRead ?? 10,
    cacheWrite: overrides.cacheWrite ?? 6,
    estCost: overrides.estCost ?? 0.44,
  };
}

function makeMessage(
  id: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    conversationId: overrides.conversationId ?? "desktop-child",
    role: overrides.role ?? "assistant",
    content: overrides.content ?? `${id} content`,
    recordType: overrides.recordType ?? "message",
    model: overrides.model ?? "claude-opus",
    sequence: overrides.sequence ?? 1,
    turn: overrides.turn ?? 1,
    isSidechain: overrides.isSidechain ?? false,
    parentMessageId: overrides.parentMessageId ?? "",
    inputTokens: overrides.inputTokens ?? 12,
    outputTokens: overrides.outputTokens ?? 18,
    cacheRead: overrides.cacheRead ?? 0,
    cacheWrite: overrides.cacheWrite ?? 0,
    thinkingContent: overrides.thinkingContent ?? "",
    thinkingTokens: overrides.thinkingTokens ?? 0,
    timestamp: overrides.timestamp ?? "2026-04-29T08:22:00.000Z",
    toolUses: overrides.toolUses ?? [],
  };
}

function makeToolCall(
  id: string,
  overrides: Partial<ToolCall> = {},
): ToolCall {
  return {
    id,
    conversationId: overrides.conversationId ?? "desktop-root",
    messageId: overrides.messageId ?? "desktop-root-m1",
    name: overrides.name ?? "Read",
    input: overrides.input ?? "desktop input",
    output: overrides.output ?? "desktop output",
    isError: overrides.isError ?? false,
    durationMs: overrides.durationMs ?? 10,
    timestamp: overrides.timestamp ?? "2026-04-29T08:22:00.000Z",
  };
}

function makeDaemonClient(
  overrides: Partial<ReturnType<typeof buildDaemonClient>> = {},
) {
  return {
    ...buildDaemonClient(),
    ...overrides,
  };
}

function buildDaemonClient() {
  return {
    async getCompatibility() {
      return makeCompatibilityInfo();
    },
    async getHomeData() {
      return makeHomeData();
    },
    async getLogs() {
      return makeLogsView();
    },
    async getRouting() {
      return makeRoutingView();
    },
    async listConversations() {
      return makeConversationListView();
    },
    async getConversationDetail() {
      return makeConversationDetailView();
    },
    async getTraceView() {
      return makeTraceView();
    },
    async getTreeView() {
      return makeTreeView();
    },
  };
}

function makeCompatibilityInfo(
  overrides: Partial<DesktopCompatibilityInfo> = {},
): DesktopCompatibilityInfo {
  return {
    jinVersion: VERSION,
    desktopApiVersion: DESKTOP_API_VERSION,
    minimumDesktopApiVersion: DESKTOP_MINIMUM_API_VERSION,
    updateCommand: DESKTOP_UPDATE_COMMAND,
    cliUpdateCommand: CLI_UPDATE_COMMAND,
    ...overrides,
  };
}

function makeStatus(state: "stopped" | "running") {
  return {
    runtime: {
      state,
      owner:
        state === "running"
          ? {
              pid: 515,
              mode: "daemon" as const,
              startedAt: "2026-04-29T08:00:00.000Z",
              configDir: "/tmp/jin",
              storePath: "/tmp/jin/store.db",
              logPath: "/tmp/jin/jin.log",
              localEndpoint: "/tmp/jin/jin.sock",
            }
          : null,
      issues: [],
    },
    health: {
      status: state === "running" ? "healthy" : "stopped",
      issueCount: 0,
      issueSubsystems: [],
      paused: false,
      ingest: state === "running" ? "healthy" : "inactive",
      push: state === "running" ? "healthy" : "inactive",
      components: {
        running: state === "running" ? 1 : 0,
        stopped: state === "running" ? 0 : 1,
      },
    },
    components: [
      {
        name: "watcher" as const,
        status: state === "running" ? "running" : "stopped",
        pid: state === "running" ? 515 : undefined,
        mode: state === "running" ? ("daemon" as const) : undefined,
        lifecycleState: state,
      },
    ],
    paths: {
      configDir: "/tmp/jin",
      config: "/tmp/jin/config.json",
      store: "/tmp/jin/store.db",
      log: "/tmp/jin/jin.log",
      localEndpoint: "/tmp/jin/jin.sock",
      socket: "/tmp/jin/jin.sock",
    },
  };
}

function makeActionResult(action: "start" | "stop" | "restart") {
  return {
    action,
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    status: makeStatus(action === "stop" ? "stopped" : "running"),
  };
}
