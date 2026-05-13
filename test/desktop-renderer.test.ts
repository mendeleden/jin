import { describe, expect, test } from "bun:test";
import { renderApp, type RendererState } from "../desktop/renderer";
import type {
  Conversation,
  Message,
  ToolCall,
} from "../src/contracts/conversations";
import type {
  DesktopCompatibilityStatus,
  DesktopConversationDetailView,
  DesktopConversationListView,
  DesktopControlStatus,
  DesktopHomeSnapshot,
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

describe("desktop renderer", () => {
  test("stopping runtime in conversations view renders a paused workbench state", () => {
    const html = renderApp(
      makeState({
        activeView: "conversations",
        snapshot: {
          status: makeStatus("stopping"),
          compatibility: null,
          data: null,
          transportError: null,
        },
      }),
    );

    expect(html).toContain("Jin is shutting down.");
    expect(html).toContain("The library is paused until shutdown completes.");
    expect(html).not.toContain("Conversation library unavailable");
  });

  test("conversation workbench renders library, tabs, and metadata inspector", () => {
    const html = renderApp(
      makeState({
        activeView: "conversations",
        selectedSubview: "timeline",
        snapshot: makeSnapshot("running"),
        library: makeConversationListView(),
        selectedConversationId: "desktop-child",
        detail: makeConversationDetailView(),
        trace: makeTraceView(),
        tree: makeTreeView(),
      }),
    );

    expect(html).toContain("Conversation index");
    expect(html).toContain("Timeline");
    expect(html).toContain("Trace");
    expect(html).toContain("Tree");
    expect(html).toContain("Metadata");
    expect(html).toContain("Conversation ID");
    expect(html).toContain("Trace ID");
    expect(html).toContain("Spawned project summary");
    expect(html).toContain("Conversation index");
  });

  test("home overview uses compact large numbers and keeps runtime paths in the sidebar", () => {
    const snapshot = makeSnapshot("running");
    if (!snapshot.data) {
      throw new Error("expected running snapshot data");
    }
    snapshot.data.overview = {
      ...snapshot.data.overview,
      conversations: 1713,
      messages: 131009,
      toolCalls: 52689,
      tokens: 6296053708,
      cost: 10019.88,
      traces: 441,
    };

    const html = renderApp(
      makeState({
        activeView: "home",
        snapshot,
      }),
    );

    expect(html).toContain("1,713");
    expect(html).toContain("131K");
    expect(html).toContain("52.7K");
    expect(html).toContain("6.3B");
    expect(html).toContain("6,296,053,708");
    expect(html).toContain("$10,019.88");
    expect(html).toContain("Usage by harness");
    expect(html).toContain("Usage by model");
    expect(html).toContain("claude-opus");
    expect(html).toContain("Daily usage by harness");
    expect(html).toContain("usage-chart");
    expect(html).toContain("Settings");
    expect(html).not.toContain("sidebar-runtime-details");
    expect(html).not.toContain("conversations across");
    expect(html).not.toContain("Daemon status and boundary paths");
  });

  test("conversation inspector can render as a collapsed side rail", () => {
    const html = renderApp(
      makeState({
        activeView: "conversations",
        inspectorCollapsed: true,
        snapshot: makeSnapshot("running"),
        library: makeConversationListView(),
        selectedConversationId: "desktop-child",
        detail: makeConversationDetailView(),
        trace: makeTraceView(),
        tree: makeTreeView(),
      }),
    );

    expect(html).toContain("inspector-collapsed");
    expect(html).toContain("inspector-rail");
    expect(html).toContain("Expand metadata inspector");
  });

  test("home stats panels render explicit collapsed state", () => {
    const html = renderApp(
      makeState({
        activeView: "home",
        collapsedHomePanels: {
          harness: true,
          models: false,
          usage: false,
        },
      }),
    );

    expect(html).toContain('data-home-panel="harness"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Billed");
    expect(html).toContain("Usage by model");
  });

  test("trace subview keeps trace relationships visible as a first-class surface", () => {
    const html = renderApp(
      makeState({
        activeView: "conversations",
        selectedSubview: "trace",
        snapshot: makeSnapshot("running"),
        library: makeConversationListView(),
        selectedConversationId: "desktop-child",
        detail: makeConversationDetailView(),
        trace: makeTraceView(),
        tree: makeTreeView(),
      }),
    );

    expect(html).toContain("Desktop root conversation");
    expect(html).toContain("Spawned project summary");
    expect(html).toContain("forked");
    expect(html).toContain("trace-row");
  });

  test("incompatible desktop protocol renders an update-first state", () => {
    const html = renderApp(
      makeState({
        activeView: "conversations",
        snapshot: {
          ...makeSnapshot("running"),
          compatibility: makeCompatibility({
            compatible: false,
            reason: "desktop_too_old",
            desktopApiVersion: 2,
            minimumDesktopApiVersion: 2,
            message:
              "This Jin Desktop build is no longer compatible. Update Desktop with `jin desktop --update`.",
          }),
          data: null,
          transportError:
            "This Jin Desktop build is no longer compatible. Update Desktop with `jin desktop --update`.",
        },
      }),
    );

    expect(html).toContain("Desktop update required.");
    expect(html).toContain("jin desktop --update");
    expect(html).toContain("Minimum Desktop API");
    expect(html).not.toContain("Conversation index");
  });
});

function makeState(overrides: Partial<RendererState> = {}): RendererState {
  return {
    activeView: "home",
    selectedSubview: "timeline",
    sidebarCollapsed: false,
    inspectorCollapsed: false,
    collapsedHomePanels: {
      harness: false,
      models: false,
      usage: false,
    },
    loading: false,
    refreshing: false,
    busyAction: null,
    message: null,
    snapshot: makeSnapshot("running"),
    libraryRequest: {
      limit: 48,
    },
    library: null,
    libraryLoading: false,
    libraryError: null,
    selectedConversationId: null,
    selectedConversationLoading: false,
    selectedConversationError: null,
    detail: null,
    trace: null,
    tree: null,
    ...overrides,
  };
}

function makeSnapshot(
  state: DesktopControlStatus["runtime"]["state"],
): DesktopHomeSnapshot {
  return {
    status: makeStatus(state),
    compatibility:
      state === "running" || state === "degraded" ? makeCompatibility() : null,
    data:
      state === "running" || state === "degraded"
        ? {
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
          }
        : null,
    transportError: null,
  };
}

function makeCompatibility(
  overrides: Partial<DesktopCompatibilityStatus> = {},
): DesktopCompatibilityStatus {
  return {
    jinVersion: VERSION,
    desktopApiVersion: DESKTOP_API_VERSION,
    minimumDesktopApiVersion: DESKTOP_MINIMUM_API_VERSION,
    updateCommand: DESKTOP_UPDATE_COMMAND,
    cliUpdateCommand: CLI_UPDATE_COMMAND,
    clientDesktopApiVersion: DESKTOP_API_VERSION,
    compatible: true,
    reason: "compatible",
    message: "Jin Desktop and the local daemon are compatible.",
    ...overrides,
  };
}

function makeConversationListView(): DesktopConversationListView {
  return {
    generatedAt: "2026-04-29T08:55:00.000Z",
    filters: {
      adapterId: null,
      since: null,
      limit: 48,
    },
    availableAdapters: ["claude-code", "codex"],
    relationshipMix: [
      { relationship: "root", conversations: 1 },
      { relationship: "spawned", conversations: 1 },
      { relationship: "forked", conversations: 1 },
    ],
    conversations: [
      makeForkConversation(),
      makeChildConversation(),
      makeRootConversation(),
    ],
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
        thinkingContent: "Compare root and child branches before summarizing.",
        thinkingTokens: 12,
        toolUses: [
          {
            id: "tool-read",
            name: "Read",
            input: "desktop input",
            output: "desktop output",
            isError: false,
            durationMs: 4,
            timestamp: "2026-04-29T08:24:00.000Z",
          },
        ],
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
      conversationCount: 3,
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
        messages: [makeMessage("desktop-root-m1", { conversationId: "desktop-root" })],
        toolCalls: [makeToolCall("tool-grep")],
      },
      {
        conversation: makeChildConversation(),
        messages: [makeMessage("desktop-child-m1")],
        toolCalls: [makeToolCall("tool-read", { conversationId: "desktop-child" })],
      },
      {
        conversation: makeForkConversation(),
        messages: [makeMessage("desktop-fork-m1", { conversationId: "desktop-fork" })],
        toolCalls: [],
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
          children: [
            {
              conversation: makeForkConversation(),
              children: [],
            },
          ],
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
    startedAt: "2026-04-29T08:20:00.000Z",
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
    adapterId: "codex",
    name: "Forked trace review",
    startedAt: "2026-04-29T08:31:00.000Z",
    endedAt: "2026-04-29T08:36:00.000Z",
    messageCount: 1,
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

function makeStatus(
  state: DesktopControlStatus["runtime"]["state"],
): DesktopControlStatus {
  return {
    runtime: {
      state,
      owner:
        state === "stopped"
          ? null
          : {
              pid: 515,
              mode: "daemon",
              startedAt: "2026-04-29T08:00:00.000Z",
              configDir: "/tmp/jin",
              storePath: "/tmp/jin/store.db",
              logPath: "/tmp/jin/jin.log",
              localEndpoint: "/tmp/jin/jin.sock",
            },
      issues: [],
    },
    health: {
      status:
        state === "stopped"
          ? "stopped"
          : state === "starting"
            ? "starting"
            : state === "stopping"
              ? "stopping"
              : state === "degraded"
                ? "degraded"
                : "healthy",
      issueCount: 0,
      issueSubsystems: [],
      paused: false,
      ingest: state === "stopped" ? "inactive" : "healthy",
      push: state === "stopped" ? "inactive" : "healthy",
      components: {
        running: state === "stopped" ? 0 : 1,
        stopped: state === "stopped" ? 1 : 0,
      },
    },
    components: [
      {
        name: "watcher",
        status: state === "stopped" ? "stopped" : "running",
        pid: state === "stopped" ? undefined : 515,
        mode: state === "stopped" ? undefined : "daemon",
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
