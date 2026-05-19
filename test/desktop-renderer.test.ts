import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DesktopRendererController,
  ESTIMATED_COST_HELP,
  type RendererState,
} from "../desktop/renderer";
import { renderDesktopReactShellToStaticMarkup } from "../desktop/components/app-shell";
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

describe("desktop renderer", () => {
  test("controller refreshes through injected preload bridge state", async () => {
    const snapshots: RendererState[] = [];
    const library = makeConversationListView();
    library.conversations = [
      makeChildConversation(),
      makeForkConversation(),
      makeRootConversation(),
    ];
    const controller = new DesktopRendererController({
      bridge: {
        async getHomeSnapshot() {
          return makeSnapshot("running");
        },
        async listConversations() {
          return library;
        },
        async getConversationDetail() {
          return makeConversationDetailView();
        },
        async getLogs() {
          return makeLogsView();
        },
        async getRouting() {
          return makeRoutingView();
        },
        async getTraceView() {
          return makeTraceView();
        },
        async getTreeView() {
          return makeTreeView();
        },
        async runControlAction() {
          return {
            action: "restart",
            ok: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            status: makeStatus("running"),
          };
        },
      },
      initialState: {
        activeView: "conversations",
      },
      onChange(state) {
        snapshots.push(state);
      },
    });

    await controller.refreshShell({ preserveSelection: true });

    const finalSnapshot = snapshots.at(-1);
    expect(finalSnapshot?.snapshot?.status.runtime.state).toBe("running");
    expect(finalSnapshot?.library?.conversations[0]?.id).toBe("desktop-child");
    expect(finalSnapshot?.detail?.conversation.id).toBe("desktop-child");
  });

  test("stopping runtime in conversations view renders a paused workbench state", () => {
    const html = renderDesktopReactShellToStaticMarkup(
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
    const html = renderDesktopReactShellToStaticMarkup(
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
    expect(html).toContain("conversation-workspace-toolbar");
    expect(html.indexOf("conversation-workspace-toolbar")).toBeLessThan(
      html.indexOf("library-panel"),
    );
    expect(html).toContain("conversation-filter-row");
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

    const html = renderDesktopReactShellToStaticMarkup(
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
    expect(html).not.toContain("Usage by harness");
    expect(html).not.toContain("Usage by model");
    expect(html).not.toContain("Token Usage");
    expect(html).toContain("Daily tokens by adapter");
    expect(html).toContain('data-usage-period="daily"');
    expect(html).toContain("Usage chart controls");
    expect(html).toContain("Breakdown metric");
    expect(html).toContain("Tokens");
    expect(html).toContain("Convs");
    expect(html).toContain("Cost");
    expect(html).toContain("Daily");
    expect(html).toContain("Monthly");
    expect(html).toContain("Previous usage window");
    expect(html).toContain("Next usage window");
    expect(html).toContain("usage-area-chart");
    expect(html).not.toContain("usage-area-static-chart");
    expect(html).not.toContain("usage-area-static-fill");
    expect(html).toContain("Daily token usage by adapter");
    expect(html).not.toContain("Conversation Days");
    expect(html).not.toContain("conversation-volume-bars");
    expect(html).not.toContain("Estimated Cost");
    expect(html).not.toContain("cost-bars");
    expect(html).not.toContain("Recent Activity");
    expect(html).not.toContain("home-signal-row");
    expect(html).not.toContain("Latest conversations");
    expect(html).not.toContain("Open library");
    expect(html).not.toContain("Current total");
    expect(html).toContain("usage-chart");
    expect(html).toContain("Project Stacks");
    expect(html).toContain("Harness Timeline");
    expect(html).not.toContain('data-home-flow-graph="mission-control"');
    expect(html).toContain("Settings");
    expect(html).not.toContain("sidebar-runtime-details");
    expect(html).not.toContain("conversations across");
    expect(html).not.toContain("Daemon status and boundary paths");
  });

  test("home token observatory renders a snapshot-derived chart from aggregate data", () => {
    const snapshot = makeSnapshot("running");
    if (!snapshot.data) {
      throw new Error("expected running snapshot data");
    }
    snapshot.data.tokenUsageByDay = [];

    const html = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "home",
        snapshot,
      }),
    );

    expect(html).toContain('data-usage-chart-source="snapshot"');
    expect(html).toContain("Current activity snapshot");
    expect(html).toContain("Current snapshot");
    expect(html).toContain("claude-code");
    expect(html).toContain("244");
    expect(html).toContain("Snapshot-derived token usage by adapter");
    expect(html).toContain("recharts-wrapper usage-area-chart");
    expect(html).toContain('title="Snapshot: 3 conversations"');
    expect(html).toContain('title="Current: 3 conversations"');
    expect(html).not.toContain("usage-area-static-layer");
    const kpis = extractUsageChartKpis(html);
    expect(countText(kpis, "<strong>244</strong>")).toBe(1);
    expect(kpis).toContain("<strong>244</strong>");
    expect(kpis).toContain("tokens");
    expect(kpis).toContain("<strong>3</strong>");
    expect(kpis).toContain("conversations");
    expect(kpis).toContain("<strong>$1.32</strong>");
    expect(kpis).toContain("est. cost");
    expect(kpis).not.toContain("<strong>488</strong>");
    expect(kpis).not.toContain("$2.64");
    expect(html).not.toContain("No token usage timeline is available yet.");
    expect(html).not.toContain("No token usage has been recorded yet.");
  });

  test("home token observatory falls back to overview totals when adapter rows are absent", () => {
    const snapshot = makeSnapshot("running");
    if (!snapshot.data) {
      throw new Error("expected running snapshot data");
    }
    snapshot.data.tokenUsageByDay = [];
    snapshot.data.topAdapters = [];

    const html = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "home",
        snapshot,
      }),
    );

    expect(html).toContain('data-usage-chart-source="snapshot"');
    expect(html).toContain("all adapters");
    expect(html).toContain("Monthly rollup requires weekly usage buckets");
    expect(html).not.toContain("No token usage has been recorded yet.");
  });

  test("home token usage aggregates duplicate adapter rows before display", () => {
    const snapshot = makeSnapshot("running");
    if (!snapshot.data) {
      throw new Error("expected running snapshot data");
    }
    snapshot.data.tokenUsageByDay = [
      {
        day: "2026-04-29",
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
      {
        day: "2026-04-29",
        adapterId: "codex",
        sessions: 1,
        tokens: 25,
        cost: 0.2,
      },
    ];

    const html = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "home",
        snapshot,
      }),
    );

    const callout = extractUsageCallout(html);
    expect(extractUsageChartKpis(html)).toContain("<strong>269</strong>");
    expect(callout).toContain("244");
    expect(callout).toContain("25");
    expect(countText(callout, "claude-code")).toBe(1);
  });

  test("desktop home CSS reserves visible pulse panel height", () => {
    const css = readFileSync(
      new URL("../desktop/styles.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain(".home-pulse-panel");
    expect(css).toContain(".workspace-home > .compact-panel.home-pulse-panel");
    expect(css).toContain("grid-column: 1 / -1;");
    expect(css).toContain("min-height: 448px;");
    expect(css).toContain(".home-project-panel");
    expect(css).toContain(".home-adapter-panel");
    expect(css).toContain(".usage-chart-controls");
    expect(css).toContain(".usage-period-toggle");
    expect(css).toContain(".usage-window-controls");
    expect(css).toContain(".usage-area-chart-shell");
    expect(css).toContain(".usage-area-chart");
    expect(css).not.toContain(".usage-area-static-chart");
    expect(css).not.toContain(".usage-area-static-fill");
    expect(css).toContain(".usage-session-rail");
    expect(css).toContain("height: 252px;");
  });

  test("sidebar runtime card omits traces and keeps cost as the final metric", () => {
    const runningHtml = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "home",
        snapshot: makeSnapshot("running"),
      }),
    );
    const runningMetrics = extractSidebarRuntimeMetrics(runningHtml);

    expect(extractMetricLabels(runningMetrics)).toEqual([
      "Conversations",
      "Messages",
      "Tool calls",
      "Tokens",
      "Cost (estimated)",
    ]);
    expect(runningMetrics).not.toContain("<span>Traces</span>");
    expect(runningMetrics).toContain("$1.32");
    expect(runningMetrics.indexOf("Cost (estimated)")).toBeGreaterThan(
      runningMetrics.indexOf("Tokens"),
    );
    expect(runningHtml).not.toContain("<span>Traces</span>");
    expect(runningHtml).not.toContain("Next surfaces");
    expect(runningHtml).not.toContain("<span>Search</span>");
    expect(runningMetrics).not.toContain("<span>Projects</span>");
    expect(runningHtml).not.toContain("<span>Health</span>");

    const placeholderHtml = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "home",
        snapshot: makeSnapshot("stopped"),
      }),
    );
    const placeholderMetrics = extractSidebarRuntimeMetrics(placeholderHtml);

    expect(extractMetricLabels(placeholderMetrics)).toEqual([
      "Conversations",
      "Messages",
      "Tool calls",
      "Tokens",
      "Cost (estimated)",
    ]);
    expect(placeholderMetrics).not.toContain("<span>Traces</span>");
  });

  test("react shell renders Home and Routing through componentized surfaces", () => {
    const homeHtml = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "home",
        snapshot: makeSnapshot("running"),
      }),
    );

    expect(homeHtml).toContain("Daily tokens by adapter");
    expect(homeHtml).toContain("Project Stacks");
    expect(homeHtml).toContain("Harness Timeline");
    expect(homeHtml).not.toContain('data-home-flow-graph="mission-control"');
    expect(homeHtml).not.toContain("data-legacy-html-view");

    const routingHtml = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "routing",
        snapshot: makeSnapshot("running"),
        routing: makeRoutingView(),
      }),
    );

    expect(routingHtml).toContain('data-routing-graph="project-to-sink"');
    expect(routingHtml).toContain("Project to sink routing flow graph");
    expect(routingHtml).toContain("Local-only conversations stay in project cards");
    expect(routingHtml).not.toContain("data-legacy-html-view");
  });

  test("react shell renders Conversations, Logs, and Settings without a legacy adapter", () => {
    const conversationsHtml = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "conversations",
        snapshot: makeSnapshot("running"),
        library: makeConversationListView(),
        selectedConversationId: "desktop-child",
        detail: makeConversationDetailView(),
        trace: makeTraceView(),
        tree: makeTreeView(),
      }),
    );
    const logsHtml = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "logs",
        snapshot: makeSnapshot("running"),
        logs: makeLogsView(),
      }),
    );
    const settingsHtml = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "settings",
        snapshot: makeSnapshot("running"),
      }),
    );

    for (const html of [conversationsHtml, logsHtml, settingsHtml]) {
      expect(html).not.toContain("data-legacy-html-view");
    }
    expect(conversationsHtml).toContain("Conversation index");
    expect(conversationsHtml).toContain("Metadata");
    expect(logsHtml).toContain("Daemon log tail");
    expect(settingsHtml).toContain("Daemon status");
  });

  test("react sidebar cost uses a focusable popover affordance with the full estimated amount", () => {
    const snapshot = makeSnapshot("running");
    if (!snapshot.data) {
      throw new Error("expected running snapshot data");
    }
    snapshot.data.overview = {
      ...snapshot.data.overview,
      cost: 1234567.89,
    };

    const html = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "home",
        snapshot,
      }),
    );
    const costMetric = extractReactCostMetric(html);

    expect(costMetric).toContain("Cost (estimated)");
    expect(costMetric).toContain("$1,234,567.89");
    expect(costMetric).toContain('data-cost-popover-trigger="estimated-cost"');
    expect(costMetric).toContain(ESTIMATED_COST_HELP);
    expect(html).not.toContain("sidebar-cost-tooltip-content");
    const css = readFileSync(
      new URL("../desktop/styles.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(".sidebar-cost-tooltip-content");
    expect(css).toContain(".sidebar-cost-tooltip-arrow");
    const source = readFileSync(
      new URL("../desktop/components/app-shell.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("@radix-ui/react-tooltip");
    expect(source).toContain("RadixTooltip.Content");
    expect(costMetric.indexOf("Cost (estimated)")).toBeLessThan(
      costMetric.indexOf("$1,234,567.89"),
    );
    const sidebar = extractReactSidebar(html);
    expect(sidebar).not.toContain("Next surfaces");
    expect(sidebar).not.toContain(">Search<");
    expect(sidebar).not.toContain(">Projects<");
    expect(sidebar).not.toContain(">Health<");
  });

  test("logs workspace renders the daemon log tail through desktop state", () => {
    const html = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "logs",
        snapshot: makeSnapshot("running"),
        logs: makeLogsView(),
      }),
    );

    expect(html).toContain("Daemon log tail");
    expect(html).toContain("Runtime log");
    expect(html).toContain("/tmp/jin/jin.log");
    expect(html).toContain("Local daemon query socket ready.");
    expect(html).toContain("WARN watcher restart delayed.");
    expect(html).toContain("log-line warning");
  });

  test("routing workspace renders project-to-sink graph state", () => {
    const html = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "routing",
        snapshot: makeSnapshot("running"),
        routing: makeRoutingView(),
      }),
    );

    expect(html).toContain("Projects -&gt; Sinks");
    expect(html).toContain("Project to sink routing flow graph");
    expect(html).toContain(">acme/jin.git</div>");
    expect(html).toContain(">mendeleden/jin.git</div>");
    expect(html).not.toContain(">https://github.com/acme/jin.git</div>");
    expect(html.match(/data-project-label-width="326"/g)).toHaveLength(2);
    expect(html).toContain(">2 routed, 1 local only</div>");
    expect(html).not.toContain("2 / 3 routed - 244 tokens");
    expect(html).toContain("Remote: https://github.com/acme/jin.git");
    expect(html).toContain("Conversations: 2 routed / 3 total");
    expect(html).toContain("Tokens: 244");
    expect(html).toContain("Adapters: claude-code, codex");
    expect(html).toContain(
      "Sink targets: team-postgres (postgres): 2 routed, active; local only: 1",
    );
    expect(html).toContain("team-postgres");
    expect(html).toContain('data-routing-graph="project-to-sink"');
    expect(html).toContain('data-sink-node-id="team-postgres"');
    expect(html).toContain('data-sink-node-id="archive-s3"');
    expect(html.match(/data-sink-node-id=/g)).toHaveLength(2);
    expect(html).not.toContain("Thickness = routed conversations");
    expect(html).toContain("Solid blue = routed sink path");
    expect(html).toContain("Local-only conversations stay in project cards");
    expect(html).not.toContain("Dashed amber = unrouted conversations");
    expect(html).not.toContain("routing-flow-path muted");
    expect(countText(html, "Refresh")).toBe(1);
    expect(extractTopbar(html)).toContain("Refresh");
    expect(extractRoutingWorkspace(html)).not.toContain("Refresh");
    const routingFlowStrokeWidths = Array.from(
      html.matchAll(
        /<path class="routing-flow-path(?: muted)?"[^>]*stroke-width="([^"]+)"/g,
      ),
      (match) => match[1],
    );
    expect(routingFlowStrokeWidths).toHaveLength(2);
    expect([...new Set(routingFlowStrokeWidths)]).toEqual(["4"]);
    expect(html).toContain("Route rules");
    expect(html).toContain("remote=github.com/acme/*");
    expect(html).toContain("enabled");
  });

  test("routing graph bounds long project and sink labels with detail affordances", () => {
    const routing = makeRoutingView();
    const longRemote =
      "https://github.com/acme/extremely-long-routing-graph-overflow-regression-repository.git";
    const longSinkId =
      "earlywarning-postgres-production-primary-logical-replica-destination";

    routing.sinks[0] = {
      ...routing.sinks[0]!,
      id: longSinkId,
      name: longSinkId,
    };
    routing.routes[0] = {
      ...routing.routes[0]!,
      sinkIds: [longSinkId],
    };
    routing.projects[0] = {
      ...routing.projects[0]!,
      id:
        "github.com%2Facme%2F" +
        "extremely-long-routing-graph-overflow-regression-repository.git",
      name: longRemote,
      gitRemote: longRemote,
      sinks: [
        {
          sinkId: longSinkId,
          routedConversations: 2,
          active: true,
        },
      ],
    };

    const html = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "routing",
        snapshot: makeSnapshot("running"),
        routing,
      }),
    );

    expect(html).toContain('viewBox="0 0 1280 ');
    expect(html).toContain('data-project-label-width="326"');
    expect(html).toContain('data-sink-label-width="254"');
    expect(html.match(/data-label-truncated="true"/g)).toHaveLength(2);
    expect(html).toContain(">acme/extremely-long-rou...repository.git</div>");
    expect(html).toContain(">earlywarning-pos...stination</div>");
    expect(html).not.toContain(
      `class="routing-node-label-title">${longRemote}</div>`,
    );
    expect(html).not.toContain(
      `class="routing-node-label-title">${longSinkId}</div>`,
    );
    expect(html).toContain(`Remote: ${longRemote}`);
    expect(html).toContain(`ID: ${longSinkId}`);
    expect(html).toContain(`data-sink-node-id="${longSinkId}"`);
  });

  test("routing graph keeps local-only projects in cards without placeholder legs", () => {
    const routing = makeRoutingView();
    routing.projects.push({
      id: "github.com%2Facme%2Flocal-only",
      name: "https://github.com/acme/local-only.git",
      gitRemote: "https://github.com/acme/local-only.git",
      conversationCount: 5,
      routedConversations: 0,
      unroutedConversations: 5,
      totalTokens: 900,
      totalCost: 0.88,
      lastSeen: "2026-04-29T08:57:00.000Z",
      adapters: ["codex"],
      sinks: [],
    });

    const html = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "routing",
        snapshot: makeSnapshot("running"),
        routing,
      }),
    );

    expect(html).toContain(">0 routed, 5 local only</div>");
    expect(html).toContain("Sink targets: none; local only: 5");
    expect(html).not.toContain("unrouted");
    expect(html).not.toContain("routing-flow-path muted");
    expect(html).not.toContain("stroke-dasharray");
    expect(
      Array.from(html.matchAll(/<path class="routing-flow-path"/g)),
    ).toHaveLength(2);
  });

  test("logs refresh reports stale preload bridges with an actionable error", async () => {
    const snapshots: RendererState[] = [];
    const controller = new DesktopRendererController({
      bridge: {
        async getHomeSnapshot() {
          return makeSnapshot("running");
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
        async runControlAction() {
          return {
            action: "restart",
            ok: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            status: makeStatus("running"),
          };
        },
      } as any,
      initialState: {
        activeView: "logs",
        snapshot: makeSnapshot("running"),
      },
      onChange(state) {
        snapshots.push(state);
      },
    });

    await controller.refreshLogs();

    expect(snapshots.at(-1)?.logsError).toContain("preload bridge is stale");
    expect(renderDesktopReactShellToStaticMarkup(snapshots.at(-1)!)).toContain("Restart Jin Desktop");
  });

  test("conversation inspector can render as a collapsed side rail", () => {
    const html = renderDesktopReactShellToStaticMarkup(
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
    expect(html).toContain("Metadata");
  });

  test("home omits legacy collapsible stats bars from the primary dashboard", () => {
    const html = renderDesktopReactShellToStaticMarkup(
      makeState({
        activeView: "home",
        collapsedHomePanels: {
          harness: true,
          models: false,
          usage: false,
        },
      }),
    );

    expect(html).not.toContain("Usage by harness");
    expect(html).not.toContain("Usage by model");
    expect(html).not.toContain("Billed");
    expect(html).not.toContain("Latest conversations");
    expect(html).not.toContain("Open library");
    expect(html).not.toContain("Recent Activity");
    expect(html).toContain("Projects");
  });

  test("trace subview keeps trace relationships visible as a first-class surface", () => {
    const html = renderDesktopReactShellToStaticMarkup(
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
    const html = renderDesktopReactShellToStaticMarkup(
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

function extractSidebarRuntimeMetrics(html: string): string {
  const start = html.indexOf('<div class="sidebar-metrics">');
  if (start < 0) {
    throw new Error("expected sidebar runtime metrics");
  }
  const end = html.indexOf("</section>", start);
  if (end < 0) {
    throw new Error("expected sidebar runtime section end");
  }
  return html.slice(start, end);
}

function extractMetricLabels(html: string): string[] {
  return Array.from(
    html.matchAll(/<span class="sidebar-metric-label">([^<]+)(?:<|<\/span>)/g),
    (match) => (match[1] ?? "").trim(),
  );
}

function extractTopbar(html: string): string {
  const match = html.match(/<header class="topbar">[\s\S]*?<\/header>/);
  if (!match) {
    throw new Error("expected topbar");
  }
  return match[0];
}

function extractReactCostMetric(html: string): string {
  const index = html.indexOf("sidebar-metric sidebar-metric-cost");
  if (index < 0) {
    throw new Error("expected react sidebar cost metric");
  }
  return html.slice(index, index + 4000);
}

function extractReactSidebar(html: string): string {
  const match = html.match(/<aside class="sidebar [\s\S]*?<\/aside>/);
  if (!match) {
    throw new Error("expected react sidebar");
  }
  return match[0];
}

function extractRoutingWorkspace(html: string): string {
  const match = html.match(/<section class="workspace-routing">[\s\S]*?<\/main>/);
  if (!match) {
    throw new Error("expected routing workspace");
  }
  return match[0];
}

function extractUsageChartKpis(html: string): string {
  const match = html.match(/<div class="usage-chart-kpis">([\s\S]*?)<\/div>/);
  if (!match) {
    throw new Error("expected usage chart KPIs");
  }
  return match[1] ?? "";
}

function extractUsageCallout(html: string): string {
  const match = html.match(
    /<div class="[^"]*\busage-callout\b[^"]*">([\s\S]*?)<\/div>/,
  );
  if (!match) {
    throw new Error("expected usage callout");
  }
  return match[1] ?? "";
}

function countText(html: string, text: string): number {
  return html.split(text).length - 1;
}

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
    logsRequest: {
      limit: 240,
    },
    logs: null,
    logsLoading: false,
    logsError: null,
    routing: null,
    routingLoading: false,
    routingError: null,
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

function makeLogsView(): DesktopLogsView {
  return {
    generatedAt: "2026-04-29T08:55:00.000Z",
    path: "/tmp/jin/jin.log",
    limit: 240,
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
      {
        id: "archive-s3",
        type: "s3",
        enabled: false,
        name: "archive-s3",
        teamId: "jin-team",
        userId: "",
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
        name: "https://github.com/acme/jin.git",
        gitRemote: "https://github.com/acme/jin.git",
        conversationCount: 3,
        routedConversations: 2,
        unroutedConversations: 1,
        totalTokens: 244,
        totalCost: 1.32,
        lastSeen: "2026-04-29T08:55:00.000Z",
        adapters: ["claude-code", "codex"],
        sinks: [
          {
            sinkId: "team-postgres",
            routedConversations: 2,
            active: true,
          },
        ],
      },
      {
        id: "github.com%2Fmendeleden%2Fjin.git",
        name: "https://github.com/mendeleden/jin.git",
        gitRemote: "https://github.com/mendeleden/jin.git",
        conversationCount: 4,
        routedConversations: 4,
        unroutedConversations: 0,
        totalTokens: 1200,
        totalCost: 2.4,
        lastSeen: "2026-04-29T08:56:00.000Z",
        adapters: ["codex"],
        sinks: [
          {
            sinkId: "archive-s3",
            routedConversations: 4,
            active: false,
          },
        ],
      },
    ],
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
