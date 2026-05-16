import { useEffect, useRef, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  FileText,
  Home,
  Info,
  type LucideIcon,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  RotateCw,
  Route,
  Settings,
  Square,
} from "lucide-react";
import type { Conversation } from "../../src/contracts/conversations";
import type {
  DesktopControlAction,
  DesktopControlStatus,
  DesktopHomeData,
  DesktopRoutingView,
} from "../../src/contracts/desktop";
import { HomeMissionControlGraph, RoutingFlowGraph } from "../graph-components";
import {
  ESTIMATED_COST_HELP,
  bindDesktopRendererEvents,
  capitalize,
  formatCost,
  formatDate,
  formatDuration,
  formatMetricNumber,
  formatNumber,
  formatRouteMatch,
  getIncompatibleCompatibility,
  isTransitionalRuntimeState,
  renderDesktopViewSubtitle,
  renderDesktopViewTitle,
  renderLegacyWorkspace,
  renderRuntimeHeading,
  type DesktopHomePanel,
  type DesktopNavigationView,
  type DesktopRendererController,
  type FormattedMetric,
  type LegacyDesktopNavigationView,
  type RendererState,
} from "../renderer";

type MaybePromise = void | Promise<void>;

export interface DesktopShellActions {
  openConversation(conversationId: string): MaybePromise;
  refreshShell(): MaybePromise;
  runControlAction(action: DesktopControlAction): MaybePromise;
  switchView(view: DesktopNavigationView): MaybePromise;
  toggleHomePanel(panel: DesktopHomePanel): void;
  toggleSidebar(): void;
}

const noopActions: DesktopShellActions = {
  openConversation() {},
  refreshShell() {},
  runControlAction() {},
  switchView() {},
  toggleHomePanel() {},
  toggleSidebar() {},
};

const NAV_ITEMS: Array<{
  view: DesktopNavigationView;
  label: string;
  Icon: LucideIcon;
}> = [
  { view: "home", label: "Home", Icon: Home },
  { view: "conversations", label: "Conversations", Icon: MessageSquare },
  { view: "routing", label: "Routing", Icon: Route },
  { view: "logs", label: "Logs", Icon: FileText },
  { view: "settings", label: "Settings", Icon: Settings },
];

const USAGE_COLOR_COUNT = 6;
const USAGE_CHART_WIDTH = 960;
const USAGE_CHART_HEIGHT = 360;
const USAGE_CHART_PLOT = {
  x: 64,
  y: 26,
  width: 780,
  height: 230,
} as const;

type UsageDayBucket = {
  day: string;
  totalTokens: number;
  totalCost: number;
  entries: Array<{ adapterId: string; tokens: number; cost: number }>;
};

export function renderDesktopReactShellToStaticMarkup(
  state: RendererState,
): string {
  return renderToStaticMarkup(<AppShell actions={noopActions} state={state} />);
}

export function AppShell({
  actions,
  legacyController = null,
  state,
}: {
  actions: DesktopShellActions;
  legacyController?: DesktopRendererController | null;
  state: RendererState;
}) {
  if (state.loading && !state.snapshot) {
    return (
      <Tooltip.Provider delayDuration={120}>
        <ShellFrame
          actions={actions}
          state={state}
          subtitle="Restoring the typed daemon-backed shell"
          title="Booting Desktop"
        >
          <section className="state-panel">
            <span className="eyebrow">Transport</span>
            <h2>Loading the desktop workbench.</h2>
            <p>
              The renderer is reconnecting through the preload bridge before
              loading the conversation library.
            </p>
          </section>
        </ShellFrame>
      </Tooltip.Provider>
    );
  }

  if (!state.snapshot) {
    return (
      <Tooltip.Provider delayDuration={120}>
        <ShellFrame
          actions={actions}
          state={state}
          subtitle="Renderer bridge did not return a snapshot"
          title="Desktop unavailable"
        >
          <NoticeStack state={state} />
          <section className="state-panel">
            <span className="eyebrow">Bridge</span>
            <h2>Desktop could not reach its typed preload bridge.</h2>
            <p>
              {state.message ??
                "Refresh after the Electron main process is available."}
            </p>
            <div className="action-row">
              <button
                className="toolbar-button primary"
                onClick={() => void actions.refreshShell()}
                type="button"
              >
                <RefreshCw aria-hidden="true" />
                Retry
              </button>
            </div>
          </section>
        </ShellFrame>
      </Tooltip.Provider>
    );
  }

  const compatibility = getIncompatibleCompatibility(state);
  return (
    <Tooltip.Provider delayDuration={120}>
      <ShellFrame
        actions={actions}
        state={state}
        subtitle={renderDesktopViewSubtitle(state)}
        title={renderDesktopViewTitle(state.activeView)}
      >
        <NoticeStack state={state} />
        {compatibility ? (
          <CompatibilityView state={state} />
        ) : (
          <ActiveWorkspace
            actions={actions}
            legacyController={legacyController}
            state={state}
          />
        )}
      </ShellFrame>
    </Tooltip.Provider>
  );
}

function ShellFrame({
  actions,
  children,
  state,
  subtitle,
  title,
}: {
  actions: DesktopShellActions;
  children: ReactNode;
  state: RendererState;
  subtitle: string;
  title: string;
}) {
  return (
    <div className={`shell ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar actions={actions} state={state} />
      <main className="main-shell">
        <Topbar actions={actions} state={state} subtitle={subtitle} title={title} />
        {children}
      </main>
    </div>
  );
}

function Sidebar({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const runtimeState = state.snapshot?.status.runtime.state ?? "offline";
  const overview = state.snapshot?.data?.overview;
  const collapsed = state.sidebarCollapsed;
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-top">
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`sidebar-toggle ${collapsed ? "collapsed" : ""}`}
          onClick={() => actions.toggleSidebar()}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          <ToggleIcon aria-hidden="true" />
          <span className="sidebar-toggle-copy">
            {collapsed ? "Expand" : "Collapse"}
          </span>
        </button>
      </div>

      <nav aria-label="Primary" className="nav-list">
        {NAV_ITEMS.map(({ Icon, label, view }) => (
          <button
            className={`nav-item ${state.activeView === view ? "active" : ""}`}
            key={view}
            onClick={() => void actions.switchView(view)}
            title={label}
            type="button"
          >
            <span aria-hidden="true" className="nav-icon">
              <Icon />
            </span>
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <section className="sidebar-panel sidebar-runtime">
        <div className="sidebar-panel-title">Runtime</div>
        <div className="sidebar-status">
          <span className={`status-badge ${runtimeState}`}>{runtimeState}</span>
          <span className="sidebar-status-copy">
            {state.snapshot
              ? renderRuntimeHeading(state.snapshot.status)
              : "Waiting for preload bridge"}
          </span>
        </div>
        <div className="sidebar-metrics">
          {overview ? (
            <>
              <SidebarMetric label="Conversations" value={overview.conversations} />
              <SidebarMetric label="Messages" value={overview.messages} />
              <SidebarMetric label="Tool calls" value={overview.toolCalls} />
              <SidebarMetric label="Tokens" value={overview.tokens} />
              <SidebarMetric
                estimatedCost
                label="Cost"
                preferCompact={false}
                value={formatCost(overview.cost)}
              />
            </>
          ) : (
            <>
              <SidebarMetric label="Conversations" value="-" />
              <SidebarMetric label="Messages" value="-" />
              <SidebarMetric label="Tool calls" value="-" />
              <SidebarMetric label="Tokens" value="-" />
              <SidebarMetric
                estimatedCost
                label="Cost"
                preferCompact={false}
                value="-"
              />
            </>
          )}
        </div>
      </section>
    </aside>
  );
}

function SidebarMetric({
  estimatedCost = false,
  label,
  preferCompact = true,
  value,
}: {
  estimatedCost?: boolean;
  label: string;
  preferCompact?: boolean;
  value: number | string;
}) {
  const formatted =
    typeof value === "number"
      ? preferCompact
        ? formatMetricNumber(value)
        : { display: formatNumber(value) }
      : { display: value };
  const labelCopy = estimatedCost ? `${label} (estimated)` : label;
  const exact =
    formatted.exact && formatted.exact !== formatted.display
      ? formatted.exact
      : "";

  const metric = (
    <div
      className={`sidebar-metric ${estimatedCost ? "sidebar-metric-cost" : ""}`}
      title={exact ? `${label}: ${exact}` : labelCopy}
    >
      <span className="sidebar-metric-label">
        {labelCopy}
        {estimatedCost ? (
          <Tooltip.Trigger asChild>
            <button
              aria-label={ESTIMATED_COST_HELP}
              className="sidebar-cost-info"
              data-cost-tooltip-trigger="estimated-cost"
              type="button"
            >
              <Info aria-hidden="true" />
            </button>
          </Tooltip.Trigger>
        ) : null}
      </span>
      <strong>{formatted.display}</strong>
      {estimatedCost ? (
        <Tooltip.Content
          className="sidebar-cost-tooltip-content"
          forceMount
          side="right"
          sideOffset={8}
        >
          {ESTIMATED_COST_HELP}
          <Tooltip.Arrow className="sidebar-cost-tooltip-arrow" />
        </Tooltip.Content>
      ) : null}
    </div>
  );

  return estimatedCost ? <Tooltip.Root>{metric}</Tooltip.Root> : metric;
}

function Topbar({
  actions,
  state,
  subtitle,
  title,
}: {
  actions: DesktopShellActions;
  state: RendererState;
  subtitle: string;
  title: string;
}) {
  const status = state.snapshot?.status ?? null;
  const runtimeState = status?.runtime.state ?? "offline";

  return (
    <header className="topbar">
      <div className="topbar-copy">
        {state.activeView === "home" ? null : (
          <div className="eyebrow">Native shell</div>
        )}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="topbar-actions">
        <span className={`status-badge ${runtimeState}`}>{runtimeState}</span>
        {status ? (
          <RuntimeActions
            actions={actions}
            runtimeState={status.runtime.state}
            state={state}
          />
        ) : null}
        <button
          className="toolbar-button"
          onClick={() => void actions.refreshShell()}
          type="button"
        >
          <RefreshCw aria-hidden="true" />
          {state.refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </header>
  );
}

function RuntimeActions({
  actions,
  runtimeState,
  state,
}: {
  actions: DesktopShellActions;
  runtimeState: DesktopControlStatus["runtime"]["state"];
  state: RendererState;
}) {
  if (runtimeState === "stopped") {
    return (
      <button
        className="toolbar-button primary"
        disabled={state.busyAction === "start"}
        onClick={() => void actions.runControlAction("start")}
        type="button"
      >
        <Play aria-hidden="true" />
        {state.busyAction === "start" ? "Starting..." : "Start Jin"}
      </button>
    );
  }

  if (runtimeState === "starting" || runtimeState === "stopping") {
    return null;
  }

  return (
    <>
      <button
        className="toolbar-button"
        disabled={state.busyAction === "restart"}
        onClick={() => void actions.runControlAction("restart")}
        type="button"
      >
        <RotateCw aria-hidden="true" />
        {state.busyAction === "restart" ? "Restarting..." : "Restart"}
      </button>
      <button
        className="toolbar-button"
        disabled={state.busyAction === "stop"}
        onClick={() => void actions.runControlAction("stop")}
        type="button"
      >
        <Square aria-hidden="true" />
        {state.busyAction === "stop" ? "Stopping..." : "Stop"}
      </button>
    </>
  );
}

function NoticeStack({ state }: { state: RendererState }) {
  const notices: Array<{ tone?: "warning"; value: string }> = [];
  const incompatible = Boolean(getIncompatibleCompatibility(state));

  if (state.message) {
    notices.push({ value: state.message });
  }

  if (state.snapshot?.transportError && !incompatible) {
    notices.push({ tone: "warning", value: state.snapshot.transportError });
  }

  if (state.activeView === "conversations" && state.libraryError) {
    notices.push({ tone: "warning", value: state.libraryError });
  }

  if (state.activeView === "logs" && state.logsError) {
    notices.push({ tone: "warning", value: state.logsError });
  }

  if (state.activeView === "routing" && state.routingError) {
    notices.push({ tone: "warning", value: state.routingError });
  }

  if (state.activeView === "conversations" && state.selectedConversationError) {
    notices.push({ tone: "warning", value: state.selectedConversationError });
  }

  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="notice-stack">
      {notices.map((notice, index) => (
        <div
          className={`notice ${notice.tone === "warning" ? "warning" : ""}`}
          key={`${notice.value}-${index}`}
        >
          {notice.value}
        </div>
      ))}
    </div>
  );
}

function ActiveWorkspace({
  actions,
  legacyController,
  state,
}: {
  actions: DesktopShellActions;
  legacyController: DesktopRendererController | null;
  state: RendererState;
}) {
  if (state.activeView === "home") {
    return <HomeWorkspace actions={actions} state={state} />;
  }

  if (state.activeView === "routing") {
    return <RoutingWorkspace actions={actions} state={state} />;
  }

  return (
    <LegacyHtmlView
      controller={legacyController}
      state={state}
      view={state.activeView as LegacyDesktopNavigationView}
    />
  );
}

function LegacyHtmlView({
  controller,
  state,
  view,
}: {
  controller: DesktopRendererController | null;
  state: RendererState;
  view: LegacyDesktopNavigationView;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!rootRef.current || !controller) {
      return undefined;
    }

    return bindDesktopRendererEvents(rootRef.current, controller);
  }, [controller, view]);

  return (
    <div
      ref={rootRef}
      className="legacy-html-view"
      data-legacy-html-view={view}
      dangerouslySetInnerHTML={{ __html: renderLegacyWorkspace(state, view) }}
    />
  );
}

function HomeWorkspace({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return null;
  }

  if (snapshot.status.runtime.state === "stopped") {
    return (
      <LifecycleState
        actions={actions}
        description="Desktop remains a client of the daemon boundary and waits for the single runtime owner to come online."
        label="Stopped"
        state={state}
        title="Jin is ready, but the daemon is not running."
      />
    );
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return (
      <LifecycleState
        actions={actions}
        description={
          snapshot.status.runtime.state === "starting"
            ? "Overview data will render once the daemon reaches a steady runtime state."
            : "Desktop is holding the shell while shutdown completes."
        }
        label={capitalize(snapshot.status.runtime.state)}
        state={state}
        title={
          snapshot.status.runtime.state === "starting"
            ? "Jin is starting up."
            : "Jin is shutting down."
        }
      />
    );
  }

  if (!snapshot.data) {
    return (
      <LifecycleState
        actions={actions}
        description={
          snapshot.transportError ??
          "Desktop could not load the current overview from the daemon."
        }
        label="Transport"
        state={state}
        title="Home data is temporarily unavailable."
      />
    );
  }

  const { data } = snapshot;

  return (
    <section className="workspace-home">
      <section className="summary-strip">
        <SummaryMetric
          label="Conversations"
          value={formatMetricNumber(data.overview.conversations)}
        />
        <SummaryMetric
          label="Messages"
          value={formatMetricNumber(data.overview.messages)}
        />
        <SummaryMetric
          label="Tool calls"
          value={formatMetricNumber(data.overview.toolCalls)}
        />
        <SummaryMetric
          label="Tokens"
          value={formatMetricNumber(data.overview.tokens)}
        />
        <SummaryMetric label="Cost" value={{ display: formatCost(data.overview.cost) }} />
        <SummaryMetric label="Traces" value={formatMetricNumber(data.overview.traces)} />
      </section>

      <HomeMissionControlGraph data={data} />
      <TokenUsageObservatory data={data} />

      <HomeStatsPanel
        collapsed={state.collapsedHomePanels.harness}
        eyebrow="Stats"
        id="harness"
        onToggle={actions.toggleHomePanel}
        title="Usage by harness"
      >
        <HarnessStatsRows adapters={data.topAdapters} />
      </HomeStatsPanel>

      <HomeStatsPanel
        collapsed={state.collapsedHomePanels.models}
        eyebrow="Stats"
        id="models"
        onToggle={actions.toggleHomePanel}
        title="Usage by model"
      >
        <ModelStatsRows models={data.topModels ?? []} />
      </HomeStatsPanel>

      <section className="compact-panel compact-panel-span">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Recent</span>
            <h2>Latest conversations</h2>
          </div>
          <button
            className="toolbar-button subtle"
            onClick={() => void actions.switchView("conversations")}
            type="button"
          >
            Open library
          </button>
        </div>
        <div className="mini-list">
          {data.recentConversations.length > 0 ? (
            data.recentConversations.map((conversation) => (
              <RecentConversationRow
                conversation={conversation}
                key={conversation.id}
                onOpen={actions.openConversation}
              />
            ))
          ) : (
            <div className="empty-row">No indexed conversations yet.</div>
          )}
        </div>
      </section>

      <section className="compact-panel">
        <div className="panel-header">
          <h2>Projects</h2>
        </div>
        <div className="mini-list">
          {data.topProjects.length > 0 ? (
            data.topProjects.map((project) => (
              <div className="key-value-row" key={project.id}>
                <span>{project.name}</span>
                <strong>{formatNumber(project.conversationCount)} conv</strong>
              </div>
            ))
          ) : (
            <div className="empty-row">No linked projects yet.</div>
          )}
        </div>
      </section>
    </section>
  );
}

function RoutingWorkspace({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return null;
  }

  if (snapshot.status.runtime.state === "stopped") {
    return (
      <LifecycleState
        actions={actions}
        description="Start the daemon to inspect how indexed git projects map to active sinks."
        label="Routing"
        showRefresh={false}
        state={state}
        title="Project routing is paused while Jin is stopped."
      />
    );
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return (
      <LifecycleState
        actions={actions}
        description={
          snapshot.status.runtime.state === "starting"
            ? "Project-to-sink routing will load once the daemon is queryable."
            : "Routing inspection is paused until shutdown completes."
        }
        label="Routing"
        showRefresh={false}
        state={state}
        title={
          snapshot.status.runtime.state === "starting"
            ? "Jin is starting up."
            : "Jin is shutting down."
        }
      />
    );
  }

  const routing = state.routing;
  if (state.routingLoading && !routing) {
    return (
      <section className="workspace-routing">
        <section className="compact-panel compact-panel-wide routing-flow-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Routing graph</span>
              <h2>Projects -&gt; Sinks</h2>
            </div>
            <span className="panel-meta">Loading...</span>
          </div>
          <div className="list-placeholder">
            <div className="placeholder-line wide" />
            <div className="placeholder-line" />
            <div className="placeholder-line" />
          </div>
        </section>
      </section>
    );
  }

  if (state.routingError && !routing) {
    return (
      <section className="workspace-routing">
        <section className="compact-panel compact-panel-wide">
          <div className="empty-state">
            <h3>Routing graph unavailable</h3>
            <p>{state.routingError}</p>
          </div>
        </section>
      </section>
    );
  }

  if (!routing || routing.projects.length === 0) {
    return (
      <section className="workspace-routing">
        <section className="compact-panel compact-panel-wide">
          <div className="empty-state">
            <h3>No git projects indexed yet.</h3>
            <p>
              Once Jin ingests conversations with git remotes, this view will
              show which sinks each project routes to.
            </p>
          </div>
        </section>
        {routing ? (
          <>
            <RoutingSinksPanel routing={routing} />
            <RoutingRulesPanel routing={routing} />
          </>
        ) : null}
      </section>
    );
  }

  const routedConversations = routing.projects.reduce(
    (total, project) => total + project.routedConversations,
    0,
  );
  const localOnlyConversations = routing.projects.reduce(
    (total, project) => total + project.unroutedConversations,
    0,
  );
  const activeSinkCount = routing.sinks.filter((sink) => sink.enabled).length;
  const routingSummary = `${formatNumber(routing.projects.length)} projects · ${formatNumber(
    routedConversations,
  )} routed · ${formatNumber(localOnlyConversations)} local only · ${formatNumber(
    activeSinkCount,
  )} active sinks`;

  return (
    <section className="workspace-routing">
      <section className="compact-panel compact-panel-wide routing-flow-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Routing graph</span>
            <h2>Projects -&gt; Sinks</h2>
          </div>
          <div className="panel-actions">
            <span className="panel-meta">{routingSummary}</span>
          </div>
        </div>
        <RoutingFlowGraph routing={routing} />
      </section>
      <RoutingSinksPanel routing={routing} />
      <RoutingRulesPanel routing={routing} />
    </section>
  );
}

function CompatibilityView({ state }: { state: RendererState }) {
  const compatibility = getIncompatibleCompatibility(state);
  if (!compatibility) {
    return null;
  }

  const title =
    compatibility.reason === "desktop_too_old"
      ? "Desktop update required."
      : "Jin CLI update required.";
  const command =
    compatibility.reason === "desktop_too_old"
      ? compatibility.updateCommand
      : compatibility.cliUpdateCommand;

  return (
    <section className="state-panel">
      <span className="eyebrow">Compatibility</span>
      <h2>{title}</h2>
      <p>{compatibility.message}</p>
      <div className="runtime-grid">
        <RuntimeField label="Jin version" value={compatibility.jinVersion} />
        <RuntimeField
          label="Desktop API"
          value={String(compatibility.clientDesktopApiVersion)}
        />
        <RuntimeField
          label="Daemon API"
          value={String(compatibility.desktopApiVersion)}
        />
        <RuntimeField
          label="Minimum Desktop API"
          value={String(compatibility.minimumDesktopApiVersion)}
        />
      </div>
      <div className="action-row">
        <code>{command}</code>
      </div>
    </section>
  );
}

function LifecycleState({
  actions,
  description,
  label,
  showRefresh = true,
  state,
  title,
}: {
  actions: DesktopShellActions;
  description: string;
  label: string;
  showRefresh?: boolean;
  state: RendererState;
  title: string;
}) {
  const snapshot = state.snapshot;
  const showStart = snapshot?.status.runtime.state === "stopped";

  return (
    <section className="state-panel">
      <span className="eyebrow">{label}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {snapshot ? (
        <div className="runtime-grid">
          <RuntimeField label="Socket" value={snapshot.status.paths.socket} />
          <RuntimeField label="Store" value={snapshot.status.paths.store} />
          <RuntimeField
            label="Runtime owner"
            value={snapshot.status.runtime.owner?.mode ?? "none"}
          />
        </div>
      ) : null}
      {showStart || showRefresh ? (
        <div className="action-row">
        {showStart ? (
          <button
            className="toolbar-button primary"
            disabled={state.busyAction === "start"}
            onClick={() => void actions.runControlAction("start")}
            type="button"
          >
            <Play aria-hidden="true" />
            {state.busyAction === "start" ? "Starting..." : "Start Jin"}
          </button>
        ) : null}
        {showRefresh ? (
          <button
            className="toolbar-button"
            onClick={() => void actions.refreshShell()}
            type="button"
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </button>
        ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: FormattedMetric;
}) {
  const exact = value.exact && value.exact !== value.display ? value.exact : "";

  return (
    <article
      className="summary-metric"
      title={exact ? `${label}: ${exact}` : undefined}
    >
      <span>{label}</span>
      <strong>{value.display}</strong>
      {exact ? <small>{exact}</small> : null}
    </article>
  );
}

function HomeStatsPanel({
  children,
  collapsed,
  eyebrow,
  id,
  onToggle,
  title,
}: {
  children: ReactNode;
  collapsed: boolean;
  eyebrow: string;
  id: DesktopHomePanel;
  onToggle(panel: DesktopHomePanel): void;
  title: string;
}) {
  return (
    <section className={`compact-panel stats-panel ${collapsed ? "collapsed" : ""}`}>
      <button
        aria-expanded={!collapsed}
        className="stats-panel-summary"
        onClick={() => onToggle(id)}
        type="button"
      >
        <span>
          <span className="eyebrow">{eyebrow}</span>
          <strong>{title}</strong>
        </span>
        <span className="stats-panel-toggle">{collapsed ? "+" : "-"}</span>
      </button>
      {collapsed ? null : <div className="stats-panel-body">{children}</div>}
    </section>
  );
}

function HarnessStatsRows({
  adapters,
}: {
  adapters: DesktopHomeData["topAdapters"];
}) {
  if (adapters.length === 0) {
    return <div className="empty-row">No harness usage recorded yet.</div>;
  }

  return (
    <div className="stats-row-list">
      {adapters.map((adapter) => (
        <article className="stats-row" key={adapter.adapterId}>
          <div className="stats-row-heading">
            <strong>{adapter.adapterId}</strong>
            <span>{formatCost(adapter.cost)}</span>
          </div>
          <div className="stats-row-metrics">
            <StatCell
              label="Sessions"
              value={formatMetricNumber(adapter.conversations)}
            />
            <StatCell label="Messages" value={formatMetricNumber(adapter.messages)} />
            <StatCell label="Billed" value={formatMetricNumber(adapter.tokens)} />
            <StatCell
              label="Display"
              value={formatMetricNumber(adapter.displayTokens)}
            />
            <StatCell
              label="Cache"
              value={formatMetricNumber(adapter.cacheTokens)}
            />
          </div>
        </article>
      ))}
    </div>
  );
}

function ModelStatsRows({
  models,
}: {
  models: DesktopHomeData["topModels"];
}) {
  if (models.length === 0) {
    return <div className="empty-row">No model usage recorded yet.</div>;
  }

  return (
    <div className="stats-row-list">
      {models.map((model) => {
        const totalTokens = model.inputTokens + model.outputTokens;
        return (
          <article className="stats-row" key={model.model}>
            <div className="stats-row-heading">
              <strong title={model.model}>{model.model}</strong>
              <span>{formatMetricNumber(totalTokens).display} total</span>
            </div>
            <div className="stats-row-metrics">
              <StatCell label="Messages" value={formatMetricNumber(model.messages)} />
              <StatCell label="Input" value={formatMetricNumber(model.inputTokens)} />
              <StatCell
                label="Output"
                value={formatMetricNumber(model.outputTokens)}
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: FormattedMetric }) {
  const exact = value.exact && value.exact !== value.display ? value.exact : "";
  return (
    <span className="stats-cell" title={exact ? `${label}: ${exact}` : undefined}>
      <span>{label}</span>
      <strong>{value.display}</strong>
    </span>
  );
}

function RecentConversationRow({
  conversation,
  onOpen,
}: {
  conversation: Conversation;
  onOpen(conversationId: string): MaybePromise;
}) {
  return (
    <button
      className="mini-row"
      onClick={() => void onOpen(conversation.id)}
      type="button"
    >
      <div>
        <div className="mini-row-title">{conversation.name}</div>
        <div className="mini-row-meta">
          <span>{conversation.adapterId}</span>
          <span>{formatDate(conversation.endedAt || conversation.startedAt)}</span>
          <span>{formatDuration(conversation.durationMs)}</span>
        </div>
      </div>
      <span className={`relationship-chip ${conversation.relationship}`}>
        {conversation.relationship}
      </span>
    </button>
  );
}

function TokenUsageObservatory({ data }: { data: DesktopHomeData }) {
  return (
    <section className="compact-panel compact-panel-wide usage-panel usage-observatory-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Tokens</span>
          <h2>Token &amp; Cost Observatory</h2>
        </div>
        <span className="panel-meta">Last 30 days</span>
      </div>
      <TokenUsageChart entries={data.tokenUsageByDay ?? []} />
    </section>
  );
}

function TokenUsageChart({
  entries,
}: {
  entries: DesktopHomeData["tokenUsageByDay"];
}) {
  if (entries.length === 0) {
    return <div className="empty-row">No token usage timeline is available yet.</div>;
  }

  const dayMap = new Map<string, UsageDayBucket>();
  const adapterTotals = new Map<string, number>();

  for (const entry of entries) {
    const adapterId = entry.adapterId || "unknown";
    const day = dayMap.get(entry.day) ?? {
      day: entry.day,
      entries: [],
      totalCost: 0,
      totalTokens: 0,
    };
    day.totalTokens += entry.tokens;
    day.totalCost += entry.cost;
    day.entries.push({ adapterId, cost: entry.cost, tokens: entry.tokens });
    dayMap.set(entry.day, day);
    adapterTotals.set(adapterId, (adapterTotals.get(adapterId) ?? 0) + entry.tokens);
  }

  const adapters = Array.from(adapterTotals.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([adapterId]) => adapterId);
  const adapterIndex = new Map(
    adapters.map((adapterId, index) => [adapterId, index]),
  );
  const days = Array.from(dayMap.values())
    .sort((left, right) => left.day.localeCompare(right.day))
    .slice(-30);
  const maxDailyTokens = Math.max(...days.map((day) => day.totalTokens), 1);
  const areaLayers = buildUsageAreaLayers(days, adapters);
  const yTicks = buildUsageTicks(maxDailyTokens);
  const latestDay = days.at(-1)!;
  const latestEntries = [...latestDay.entries].sort(
    (left, right) =>
      right.tokens - left.tokens || left.adapterId.localeCompare(right.adapterId),
  );
  const latestX = usageX(days.length - 1, days.length);

  return (
    <div className="usage-chart">
      <div className="usage-chart-heading">
        <div>
          <h3>Daily burn chart</h3>
          <p>Stacked token volume by adapter from the local SQLite store.</p>
        </div>
        <div className="usage-chart-total">
          <span>{formatChartDay(latestDay.day)}</span>
          <strong>{formatMetricNumber(latestDay.totalTokens).display} tok</strong>
          <small>{formatCost(latestDay.totalCost)}</small>
        </div>
      </div>
      <div className="usage-chart-frame">
        <svg
          aria-label="Daily token usage by adapter"
          className="usage-area-svg"
          role="img"
          viewBox={`0 0 ${USAGE_CHART_WIDTH} ${USAGE_CHART_HEIGHT}`}
        >
          <defs>
            {adapters.map((adapterId, index) => (
              <linearGradient
                id={`usage-fill-${index}`}
                key={adapterId}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={usageColorHex(index)}
                  stopOpacity="0.78"
                />
                <stop
                  offset="100%"
                  stopColor={usageColorHex(index)}
                  stopOpacity="0.32"
                />
              </linearGradient>
            ))}
          </defs>
          <rect
            className="usage-plot-bg"
            height={USAGE_CHART_PLOT.height}
            width={USAGE_CHART_PLOT.width}
            x={USAGE_CHART_PLOT.x}
            y={USAGE_CHART_PLOT.y}
          />
          {yTicks.map((tick) => {
            const y = usageY(tick, maxDailyTokens);
            return (
              <g key={tick}>
                <line
                  className="usage-grid-line"
                  x1={USAGE_CHART_PLOT.x}
                  x2={USAGE_CHART_PLOT.x + USAGE_CHART_PLOT.width}
                  y1={y}
                  y2={y}
                />
                <text
                  className="usage-axis-label"
                  textAnchor="end"
                  x={USAGE_CHART_PLOT.x - 14}
                  y={y + 4}
                >
                  {formatMetricNumber(tick).display}
                </text>
              </g>
            );
          })}
          {areaLayers.map((layer, index) => (
            <path
              className="usage-area-layer"
              d={layer.path}
              fill={`url(#usage-fill-${index})`}
              key={layer.adapterId}
              stroke={usageColorHex(index)}
            />
          ))}
          {days.map((day, index) => {
            if (!shouldRenderUsageDayLabel(index, days.length)) {
              return null;
            }
            const x = usageX(index, days.length);
            return (
              <g key={day.day}>
                <line
                  className="usage-day-marker"
                  x1={x}
                  x2={x}
                  y1={USAGE_CHART_PLOT.y}
                  y2={USAGE_CHART_PLOT.y + USAGE_CHART_PLOT.height}
                />
                <text
                  className="usage-axis-label"
                  textAnchor="middle"
                  x={x}
                  y={USAGE_CHART_PLOT.y + USAGE_CHART_PLOT.height + 28}
                >
                  {formatChartDay(day.day)}
                </text>
              </g>
            );
          })}
          <line
            className="usage-focus-line"
            x1={latestX}
            x2={latestX}
            y1={USAGE_CHART_PLOT.y}
            y2={USAGE_CHART_PLOT.y + USAGE_CHART_PLOT.height}
          />
          <circle
            className="usage-focus-dot"
            cx={latestX}
            cy={usageY(latestDay.totalTokens, maxDailyTokens)}
            r="5"
          />
        </svg>
        <div className="usage-callout">
          <strong>{formatChartDay(latestDay.day)}</strong>
          {latestEntries.slice(0, 6).map((entry) => {
            const colorIndex = adapterIndex.get(entry.adapterId) ?? 0;
            return (
              <span key={entry.adapterId}>
                <i className={usageColorClass(colorIndex)} />
                {entry.adapterId}
                <b>{formatMetricNumber(entry.tokens).display}</b>
              </span>
            );
          })}
        </div>
      </div>
      <div className="usage-legend">
        {adapters.map((adapterId) => (
          <span key={adapterId}>
            <i className={usageColorClass(adapterIndex.get(adapterId) ?? 0)} />
            {adapterId}
          </span>
        ))}
      </div>
    </div>
  );
}

function RoutingSinksPanel({ routing }: { routing: DesktopRoutingView }) {
  return (
    <section className="compact-panel routing-side-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Destinations</span>
          <h2>Configured sinks</h2>
        </div>
        <span className="panel-meta">{formatNumber(routing.sinks.length)} total</span>
      </div>
      <div className="routing-card-list">
        {routing.sinks.length > 0 ? (
          routing.sinks.map((sink) => (
            <article className="routing-sink-card" key={sink.id}>
              <div className="routing-sink-card-head">
                <strong>{sink.name || sink.id}</strong>
                <span className={`status-badge ${sink.enabled ? "healthy" : "stopped"}`}>
                  {sink.enabled ? "enabled" : "disabled"}
                </span>
              </div>
              <div className="routing-sink-card-meta">
                <span>{sink.type}</span>
                {sink.teamId ? <span>team {sink.teamId}</span> : null}
                {sink.userId ? <span>user {sink.userId}</span> : null}
              </div>
            </article>
          ))
        ) : (
          <div className="empty-row">No sinks configured.</div>
        )}
      </div>
    </section>
  );
}

function RoutingRulesPanel({ routing }: { routing: DesktopRoutingView }) {
  return (
    <section className="compact-panel routing-side-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Rules</span>
          <h2>Route rules</h2>
        </div>
        <span className="panel-meta">{formatNumber(routing.routes.length)} total</span>
      </div>
      <div className="routing-rule-list">
        {routing.routes.length > 0 ? (
          routing.routes.map((route) => (
            <article className="routing-rule-card" key={route.index}>
              <div className="routing-rule-match">
                <span>#{formatNumber(route.index + 1)}</span>
                <strong>{formatRouteMatch(route.match)}</strong>
              </div>
              <div className="routing-rule-sinks">
                {route.sinkIds.length > 0 ? (
                  route.sinkIds.map((sinkId) => <span key={sinkId}>{sinkId}</span>)
                ) : (
                  <span>no sinks</span>
                )}
              </div>
            </article>
          ))
        ) : (
          <div className="empty-row">No route rules configured.</div>
        )}
      </div>
    </section>
  );
}

function RuntimeField({ label, value }: { label: string; value: string }) {
  return (
    <div className="runtime-field">
      <span>{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}

function buildUsageAreaLayers(
  days: UsageDayBucket[],
  adapters: string[],
): Array<{ adapterId: string; path: string }> {
  const maxDailyTokens = Math.max(...days.map((day) => day.totalTokens), 1);
  const cumulative = days.map(() => 0);

  return adapters.map((adapterId) => {
    const upperPoints: string[] = [];
    const lowerPoints: string[] = [];

    days.forEach((day, dayIndex) => {
      const x = usageX(dayIndex, days.length);
      const tokens = day.entries
        .filter((entry) => entry.adapterId === adapterId)
        .reduce((sum, entry) => sum + entry.tokens, 0);
      const lower = cumulative[dayIndex] ?? 0;
      const upper = lower + tokens;
      upperPoints.push(`${x.toFixed(1)},${usageY(upper, maxDailyTokens).toFixed(1)}`);
      lowerPoints.unshift(
        `${x.toFixed(1)},${usageY(lower, maxDailyTokens).toFixed(1)}`,
      );
      cumulative[dayIndex] = upper;
    });

    return {
      adapterId,
      path: `M ${upperPoints.join(" L ")} L ${lowerPoints.join(" L ")} Z`,
    };
  });
}

function buildUsageTicks(maxDailyTokens: number): number[] {
  const steps = 4;
  return Array.from({ length: steps + 1 }, (_entry, index) => {
    return Math.round((maxDailyTokens / steps) * index);
  });
}

function usageX(index: number, count: number): number {
  if (count <= 1) {
    return USAGE_CHART_PLOT.x + USAGE_CHART_PLOT.width / 2;
  }

  return USAGE_CHART_PLOT.x + (USAGE_CHART_PLOT.width * index) / (count - 1);
}

function usageY(value: number, maxDailyTokens: number): number {
  const clamped = Math.max(0, Math.min(value, maxDailyTokens));
  return (
    USAGE_CHART_PLOT.y +
    USAGE_CHART_PLOT.height -
    (clamped / Math.max(maxDailyTokens, 1)) * USAGE_CHART_PLOT.height
  );
}

function shouldRenderUsageDayLabel(index: number, count: number): boolean {
  if (count <= 8) {
    return true;
  }

  const interval = Math.ceil(count / 6);
  return index === 0 || index === count - 1 || index % interval === 0;
}

function usageColorClass(index: number): string {
  return `usage-color-${index % USAGE_COLOR_COUNT}`;
}

function usageColorHex(index: number): string {
  const colors = ["#89d4a1", "#89b4ff", "#f0c46d", "#ff8f84", "#a8d8ea", "#d6b3ff"];
  return colors[index % colors.length] ?? colors[0];
}

function formatChartDay(value: string): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
}
