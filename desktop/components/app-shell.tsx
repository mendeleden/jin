import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import {
  FileText,
  Home,
  Info,
  type LucideIcon,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  RotateCw,
  Route,
  Settings,
  Square,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Conversation, Message } from "../../src/contracts/conversations";
import type {
  DesktopConversationDetailView,
  DesktopConversationListView,
  DesktopControlStatus,
  DesktopControlAction,
  DesktopHomeData,
  DesktopRoutingView,
  DesktopTreeView,
} from "../../src/contracts/desktop";
import { HomeMissionControlGraph, RoutingFlowGraph } from "../graph-components";
import {
  ESTIMATED_COST_HELP,
  capitalize,
  formatCost,
  formatDate,
  formatDuration,
  formatMetricNumber,
  formatNumber,
  formatRouteMatch,
  getIncompatibleCompatibility,
  isTransitionalRuntimeState,
  renderRuntimeHeading,
  type DesktopHomePanel,
  type DesktopNavigationView,
  type DesktopConversationSubview,
  type FormattedMetric,
  type RendererState,
  shortId,
  renderDesktopViewSubtitle,
  renderDesktopViewTitle,
} from "../renderer";

type MaybePromise = void | Promise<void>;

export interface DesktopShellActions {
  openConversation(conversationId: string): MaybePromise;
  refreshShell(): MaybePromise;
  runControlAction(action: DesktopControlAction): MaybePromise;
  selectSubview(subview: DesktopConversationSubview): void;
  setAdapterFilter(value: string): MaybePromise;
  setSinceFilter(value: string): MaybePromise;
  switchView(view: DesktopNavigationView): MaybePromise;
  toggleHomePanel(panel: DesktopHomePanel): void;
  toggleInspector(): void;
  toggleSidebar(): void;
}

const noopActions: DesktopShellActions = {
  openConversation() {},
  refreshShell() {},
  runControlAction() {},
  selectSubview() {},
  setAdapterFilter() {},
  setSinceFilter() {},
  switchView() {},
  toggleHomePanel() {},
  toggleInspector() {},
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

const TIME_FILTERS: Array<{ label: string; value: string }> = [
  { label: "All time", value: "" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
];
const USAGE_COLOR_COUNT = 6;
const USAGE_CHART_WIDTH = 960;
const USAGE_CHART_HEIGHT = 270;
const USAGE_STATIC_CHART_PLOT = {
  x: 64,
  y: 24,
  width: 780,
  height: 178,
} as const;
const TREE_DEPTH_CLASS_MAX = 12;

type UsageDayBucket = {
  day: string;
  totalTokens: number;
  totalCost: number;
  entries: Array<{ adapterId: string; tokens: number; cost: number }>;
};

type UsageDisplayBucket = UsageDayBucket & {
  label?: string;
};

type UsageChartModel = {
  days: UsageDayBucket[];
  adapters: string[];
  source: "timeline" | "snapshot" | "empty";
};

type UsageChartDatum = {
  day: string;
  label: string;
  totalCost: number;
  totalTokens: number;
  [adapterKey: string]: string | number;
};

type UsageChartSeries = {
  adapterId: string;
  color: string;
  key: string;
};

export function renderDesktopReactShellToStaticMarkup(
  state: RendererState,
): string {
  return renderToStaticMarkup(<AppShell actions={noopActions} state={state} />);
}

export function AppShell({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.loading && !state.snapshot) {
    return (
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
    );
  }

  if (!state.snapshot) {
    return (
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
    );
  }

  const compatibility = getIncompatibleCompatibility(state);
  return (
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
        <ActiveWorkspace actions={actions} state={state} />
      )}
    </ShellFrame>
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

  return (
    <div
      className={`sidebar-metric ${estimatedCost ? "sidebar-metric-cost" : ""}`}
      title={exact ? `${label}: ${exact}` : labelCopy}
    >
      <span className="sidebar-metric-label">
        {labelCopy}
        {estimatedCost ? (
          <RadixTooltip.Provider delayDuration={80} skipDelayDuration={0}>
            <RadixTooltip.Root>
              <RadixTooltip.Trigger asChild>
                <button
                  aria-label={ESTIMATED_COST_HELP}
                  className="sidebar-cost-info"
                  data-cost-popover-trigger="estimated-cost"
                  type="button"
                >
                  <Info aria-hidden="true" />
                </button>
              </RadixTooltip.Trigger>
              <RadixTooltip.Portal>
                <RadixTooltip.Content
                  className="sidebar-cost-tooltip-content"
                  data-cost-popover="estimated-cost"
                  side="right"
                  sideOffset={8}
                >
                  {ESTIMATED_COST_HELP}
                  <RadixTooltip.Arrow className="sidebar-cost-tooltip-arrow" />
                </RadixTooltip.Content>
              </RadixTooltip.Portal>
            </RadixTooltip.Root>
          </RadixTooltip.Provider>
        ) : null}
      </span>
      <strong>{formatted.display}</strong>
    </div>
  );
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
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.activeView === "home") {
    return <HomeWorkspace actions={actions} state={state} />;
  }

  if (state.activeView === "conversations") {
    return <ConversationsWorkspace actions={actions} state={state} />;
  }

  if (state.activeView === "routing") {
    return <RoutingWorkspace actions={actions} state={state} />;
  }

  if (state.activeView === "logs") {
    return <LogsWorkspace actions={actions} state={state} />;
  }

  return <SettingsWorkspace state={state} />;
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

function ConversationsWorkspace({
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
        description="Start the daemon to load the library, selected conversation timeline, trace, and tree views."
        label="Conversations"
        state={state}
        title="Conversation browsing is paused while Jin is stopped."
      />
    );
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return (
      <LifecycleState
        actions={actions}
        description={
          snapshot.status.runtime.state === "starting"
            ? "The library will populate once the daemon is queryable."
            : "The library is paused until shutdown completes."
        }
        label="Conversations"
        state={state}
        title={
          snapshot.status.runtime.state === "starting"
            ? "Jin is starting up."
            : "Jin is shutting down."
        }
      />
    );
  }

  return (
    <section
      className={`workspace-conversations ${
        state.inspectorCollapsed ? "inspector-collapsed" : ""
      }`}
    >
      <aside className="library-panel">
        <div className="panel-header panel-header-tight">
          <div>
            <span className="eyebrow">Library</span>
            <h2>Conversation index</h2>
          </div>
          <span className="panel-meta">
            {state.library
              ? `${formatNumber(state.library.conversations.length)} shown`
              : state.libraryLoading
                ? "Loading..."
                : "Waiting"}
          </span>
        </div>
        <ConversationFilters actions={actions} state={state} />
        <RelationshipMix library={state.library} />
        <ConversationLibrary actions={actions} state={state} />
      </aside>

      <section className="detail-panel">
        <ConversationDetailSurface actions={actions} state={state} />
      </section>

      {state.inspectorCollapsed ? (
        <InspectorRail actions={actions} />
      ) : (
        <aside className="inspector-panel">
          <ConversationInspector actions={actions} state={state} />
        </aside>
      )}
    </section>
  );
}

function ConversationFilters({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const adapterOptions = state.library?.availableAdapters ?? [];
  const adapterValue = state.libraryRequest.adapterId ?? "";
  const sinceValue = state.libraryRequest.since ?? "";

  return (
    <div className="filter-bar">
      <label className="filter-field">
        <span>Adapter</span>
        <select
          className="select-field"
          onChange={(event) => void actions.setAdapterFilter(event.currentTarget.value)}
          value={adapterValue}
        >
          <option value="">All adapters</option>
          {adapterOptions.map((adapter) => (
            <option key={adapter} value={adapter}>
              {adapter}
            </option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        <span>Range</span>
        <select
          className="select-field"
          onChange={(event) => void actions.setSinceFilter(event.currentTarget.value)}
          value={sinceValue}
        >
          {TIME_FILTERS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function RelationshipMix({
  library,
}: {
  library: DesktopConversationListView | null;
}) {
  const relationships = library?.relationshipMix ?? [];
  if (relationships.length === 0) {
    return null;
  }

  return (
    <div className="relationship-strip">
      {relationships.map((entry) => (
        <span className="relationship-pill" key={entry.relationship}>
          <span>{entry.relationship}</span>
          <strong>{formatNumber(entry.conversations)}</strong>
        </span>
      ))}
    </div>
  );
}

function ConversationLibrary({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.libraryLoading && !state.library) {
    return <ListPlaceholder />;
  }

  if (state.libraryError && !state.library) {
    return (
      <div className="empty-state">
        <h3>Conversation library unavailable</h3>
        <p>{state.libraryError}</p>
        <button
          className="toolbar-button"
          onClick={() => void actions.refreshShell()}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  const conversations = state.library?.conversations ?? [];
  if (conversations.length === 0) {
    return (
      <div className="empty-state">
        <h3>No conversations match the current filters.</h3>
        <p>
          Desktop is connected, but the library is empty for this adapter/range
          combination.
        </p>
      </div>
    );
  }

  return (
    <div className="conversation-list">
      {conversations.map((conversation) => (
        <ConversationRow
          conversation={conversation}
          key={conversation.id}
          onOpen={actions.openConversation}
          selected={conversation.id === state.selectedConversationId}
        />
      ))}
    </div>
  );
}

function ConversationRow({
  conversation,
  onOpen,
  selected,
}: {
  conversation: Conversation;
  onOpen(conversationId: string): MaybePromise;
  selected: boolean;
}) {
  return (
    <button
      className={`conversation-row ${selected ? "selected" : ""}`}
      onClick={() => void onOpen(conversation.id)}
      type="button"
    >
      <div className="conversation-row-top">
        <div className="conversation-row-title">{conversation.name}</div>
        <span className={`relationship-chip ${conversation.relationship}`}>
          {conversation.relationship}
        </span>
      </div>
      <div className="conversation-row-meta">
        <span>{conversation.adapterId}</span>
        <span>{conversation.model || "unknown model"}</span>
        <span>{formatDate(conversation.endedAt || conversation.startedAt)}</span>
      </div>
      <div className="conversation-row-meta">
        <span>{formatNumber(conversation.messageCount)} msg</span>
        <span>{formatNumber(conversation.toolCount)} tools</span>
        <span>{formatMetricNumber(totalTokens(conversation)).display} tok</span>
      </div>
      <div className="conversation-row-foot">
        <span className="mono">{shortId(conversation.id)}</span>
        <span className="truncate">
          {conversation.gitRemote || conversation.cwd || "local / unlinked"}
        </span>
      </div>
    </button>
  );
}

function ConversationDetailSurface({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.selectedConversationLoading && !state.detail) {
    return (
      <div className="detail-empty detail-loading">
        <h3>Loading selected conversation</h3>
        <p>
          Fetching detail, trace, and tree views through the typed daemon
          boundary.
        </p>
      </div>
    );
  }

  if (state.selectedConversationError && !state.detail) {
    return (
      <div className="detail-empty">
        <h3>Conversation detail unavailable</h3>
        <p>{state.selectedConversationError}</p>
      </div>
    );
  }

  if (!state.detail) {
    return (
      <div className="detail-empty">
        <h3>Select a conversation</h3>
        <p>
          The detail pane will show timeline, trace, and tree views for the
          selected conversation.
        </p>
      </div>
    );
  }

  const conversation = state.detail.conversation;

  return (
    <div className="detail-surface">
      <div className="detail-header">
        <div>
          <div className="detail-kicker">
            <span className={`relationship-chip ${conversation.relationship}`}>
              {conversation.relationship}
            </span>
            <span className="mono">{shortId(conversation.id)}</span>
          </div>
          <h2>{conversation.name}</h2>
          <p>{renderConversationHeaderSummary(state.detail)}</p>
        </div>
        <div
          aria-label="Conversation views"
          className="subview-tabs"
          role="tablist"
        >
          <SubviewTab
            actions={actions}
            label="Timeline"
            selectedSubview={state.selectedSubview}
            value="timeline"
          />
          <SubviewTab
            actions={actions}
            label="Trace"
            selectedSubview={state.selectedSubview}
            value="trace"
          />
          <SubviewTab
            actions={actions}
            label="Tree"
            selectedSubview={state.selectedSubview}
            value="tree"
          />
        </div>
      </div>

      <div className="detail-summary">
        <span className="metric-chip">
          {formatNumber(conversation.messageCount)} messages
        </span>
        <span className="metric-chip">
          {formatNumber(conversation.toolCount)} tools
        </span>
        <span
          className="metric-chip"
          title={`${formatNumber(totalTokens(conversation))} tokens`}
        >
          {formatMetricNumber(totalTokens(conversation)).display} tokens
        </span>
        <span className="metric-chip">{formatCost(conversation.estCost)}</span>
        <span className="metric-chip">
          Trace {shortId(state.detail.trace.traceId)}
        </span>
      </div>

      {state.selectedConversationLoading ? (
        <div className="detail-refreshing">Refreshing selected conversation...</div>
      ) : null}

      <div className="detail-body">
        <SelectedSubview actions={actions} state={state} />
      </div>
    </div>
  );
}

function SubviewTab({
  actions,
  label,
  selectedSubview,
  value,
}: {
  actions: DesktopShellActions;
  label: string;
  selectedSubview: DesktopConversationSubview;
  value: DesktopConversationSubview;
}) {
  const selected = selectedSubview === value;
  return (
    <button
      aria-selected={selected}
      className={`subview-tab ${selected ? "active" : ""}`}
      onClick={() => actions.selectSubview(value)}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function SelectedSubview({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  if (state.selectedSubview === "trace") {
    return <TraceSubview actions={actions} state={state} />;
  }

  if (state.selectedSubview === "tree") {
    return <TreeSubview actions={actions} state={state} />;
  }

  return <TimelineSubview detail={state.detail!} />;
}

function TimelineSubview({
  detail,
}: {
  detail: DesktopConversationDetailView;
}) {
  if (detail.messages.length === 0) {
    return (
      <div className="detail-empty">
        <h3>No messages recorded</h3>
        <p>
          This conversation exists in the trace graph but currently has no
          stored message timeline.
        </p>
      </div>
    );
  }

  return (
    <div className="timeline-list">
      {detail.messages.map((message) => (
        <MessageCard key={message.id} message={message} />
      ))}
    </div>
  );
}

function MessageCard({ message }: { message: Message }) {
  return (
    <article className="message-card">
      <div className="message-header">
        <div className={`message-role ${message.role}`}>{message.role}</div>
        <div className="message-meta">
          <span>Turn {message.turn}</span>
          <span>{formatDate(message.timestamp)}</span>
          <span>{message.model || "unknown model"}</span>
        </div>
      </div>
      <div className="message-content">
        <PreformattedText value={message.content} />
      </div>
      {message.thinkingContent ? <ThinkingBlock message={message} /> : null}
      {message.toolUses.length > 0 ? (
        <div className="tool-stack">
          {message.toolUses.map((tool) => (
            <ToolCallBlock
              input={tool.input}
              isError={tool.isError}
              key={tool.id}
              name={tool.name}
              output={tool.output}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ThinkingBlock({ message }: { message: Message }) {
  return (
    <details className="trace-detail-block">
      <summary>
        Thinking {message.thinkingTokens > 0 ? `(${formatNumber(message.thinkingTokens)} tok)` : ""}
      </summary>
      <div className="detail-block-body">
        <PreformattedText value={message.thinkingContent} />
      </div>
    </details>
  );
}

function ToolCallBlock({
  input,
  isError,
  name,
  output,
}: {
  input: string;
  isError: boolean;
  name: string;
  output: string;
}) {
  return (
    <details className={`trace-detail-block ${isError ? "error" : ""}`}>
      <summary>
        {name}
        {isError ? " - error" : ""}
      </summary>
      {input ? (
        <>
          <div className="detail-block-label">Input</div>
          <div className="detail-block-body">
            <PreformattedText value={input} />
          </div>
        </>
      ) : null}
      {output ? (
        <>
          <div className="detail-block-label">Output</div>
          <div className="detail-block-body">
            <PreformattedText value={output} />
          </div>
        </>
      ) : null}
    </details>
  );
}

function TraceSubview({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const trace = state.trace;
  if (!trace || trace.conversations.length === 0) {
    return (
      <div className="detail-empty">
        <h3>No trace graph available</h3>
        <p>
          The selected conversation has no related trace conversations to
          display.
        </p>
      </div>
    );
  }

  return (
    <div className="trace-list">
      {trace.conversations.map((entry) => {
        const conversation = entry.conversation;
        const selected = conversation.id === state.selectedConversationId;
        return (
          <button
            className={`trace-row ${selected ? "selected" : ""}`}
            key={conversation.id}
            onClick={() => void actions.openConversation(conversation.id)}
            type="button"
          >
            <div className="trace-row-top">
              <div className="trace-row-title">{conversation.name}</div>
              <span className={`relationship-chip ${conversation.relationship}`}>
                {conversation.relationship}
              </span>
            </div>
            <div className="trace-row-meta">
              <span>{conversation.adapterId}</span>
              <span>{formatNumber(conversation.messageCount)} msg</span>
              <span>{formatNumber(conversation.toolCount)} tools</span>
              <span>{formatDate(conversation.startedAt)}</span>
            </div>
            <div className="trace-row-foot">
              <span className="mono">{shortId(conversation.id)}</span>
              <span>{conversation.model || "unknown model"}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TreeSubview({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const tree = state.tree?.tree ?? null;
  if (!tree) {
    return (
      <div className="detail-empty">
        <h3>No tree view available</h3>
        <p>
          The selected conversation trace does not currently resolve to a rooted
          tree.
        </p>
      </div>
    );
  }

  return (
    <div className="tree-view">
      <TreeNode
        onOpen={actions.openConversation}
        node={tree}
        selectedConversationId={state.selectedConversationId}
      />
    </div>
  );
}

function TreeNode({
  depth = 0,
  node,
  onOpen,
  selectedConversationId,
}: {
  depth?: number;
  node: NonNullable<DesktopTreeView["tree"]>;
  onOpen(conversationId: string): MaybePromise;
  selectedConversationId: string | null;
}) {
  const selected = node.conversation.id === selectedConversationId;

  return (
    <div className="tree-node-wrap">
      <button
        className={`tree-node tree-depth-${treeDepthClass(depth)} ${
          selected ? "selected" : ""
        }`}
        onClick={() => void onOpen(node.conversation.id)}
        type="button"
      >
        <div className="tree-node-main">
          <span className="tree-node-title">{node.conversation.name}</span>
          <span className={`relationship-chip ${node.conversation.relationship}`}>
            {node.conversation.relationship}
          </span>
        </div>
        <div className="tree-node-meta">
          <span>{node.conversation.adapterId}</span>
          <span>{formatNumber(node.conversation.messageCount)} msg</span>
          <span>{formatDate(node.conversation.startedAt)}</span>
        </div>
      </button>
      {node.children.length > 0 ? (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              depth={depth + 1}
              key={child.conversation.id}
              onOpen={onOpen}
              node={child}
              selectedConversationId={selectedConversationId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ConversationInspector({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const detail = state.detail;
  if (!detail) {
    return (
      <div className="detail-empty inspector-empty">
        <button
          aria-label="Collapse metadata inspector"
          className="inspector-toggle"
          onClick={() => actions.toggleInspector()}
          title="Collapse metadata inspector"
          type="button"
        >
          <PanelRightClose aria-hidden="true" />
        </button>
        <h3>Metadata inspector</h3>
        <p>
          Select a conversation to inspect identity, trace linkage, tokens,
          cost, and project metadata.
        </p>
      </div>
    );
  }

  const { conversation } = detail;

  return (
    <div className="inspector-surface">
      <div className="panel-header panel-header-tight">
        <div>
          <span className="eyebrow">Inspector</span>
          <h2>Metadata</h2>
        </div>
        <div className="panel-actions">
          <span className="panel-meta">{conversation.adapterId}</span>
          <button
            aria-label="Collapse metadata inspector"
            className="inspector-toggle"
            onClick={() => actions.toggleInspector()}
            title="Collapse metadata inspector"
            type="button"
          >
            <PanelRightClose aria-hidden="true" />
          </button>
        </div>
      </div>

      <InspectorSection title="Identity">
        <InspectorRow label="Conversation ID" mono value={shortId(conversation.id)} />
        <InspectorRow label="Trace ID" mono value={shortId(detail.trace.traceId)} />
        <InspectorRow label="Root ID" mono value={shortId(detail.trace.rootId)} />
        <InspectorRow label="Relationship" value={conversation.relationship} />
      </InspectorSection>

      <InspectorSection title="Runtime">
        <InspectorRow label="Model" value={conversation.model || "unknown"} />
        <InspectorRow label="Started" value={formatDate(conversation.startedAt)} />
        <InspectorRow
          label="Ended"
          value={formatDate(conversation.endedAt || conversation.startedAt)}
        />
        <InspectorRow
          label="Duration"
          value={formatDuration(conversation.durationMs)}
        />
      </InspectorSection>

      <InspectorSection title="Usage">
        <InspectorRow
          label="Messages"
          value={formatNumber(conversation.messageCount)}
        />
        <InspectorRow
          label="Tool calls"
          value={formatNumber(conversation.toolCount)}
        />
        <InspectorRow
          label="Display tokens"
          value={formatMetricNumber(conversation.inputTokens + conversation.outputTokens).display}
        />
        <InspectorRow
          label="Cache tokens"
          value={formatMetricNumber(conversation.cacheRead + conversation.cacheWrite).display}
        />
        <InspectorRow
          label="Estimated cost"
          value={formatCost(conversation.estCost)}
        />
      </InspectorSection>

      <InspectorSection title="Lineage">
        <InspectorRow
          label="Parent"
          value={detail.parent ? detail.parent.name : "None"}
        />
        <InspectorRow
          label="Children"
          value={
            detail.children.length === 0
              ? "None"
              : detail.children.map((child) => child.name).join(", ")
          }
        />
        <InspectorRow
          label="Trace size"
          value={`${formatNumber(detail.trace.conversationCount)} conversations`}
        />
      </InspectorSection>

      <InspectorSection title="Project">
        <InspectorRow
          label="Remote"
          value={conversation.gitRemote || "local / unlinked"}
        />
        <InspectorRow label="Branch" value={conversation.branch || "unknown"} />
        <InspectorRow
          label="Path"
          value={conversation.cwd || conversation.sourcePath}
        />
        <InspectorRow label="Source format" value={conversation.sourceFormat} />
      </InspectorSection>
    </div>
  );
}

function InspectorRail({ actions }: { actions: DesktopShellActions }) {
  return (
    <aside className="inspector-rail">
      <button
        aria-label="Expand metadata inspector"
        className="inspector-rail-button"
        onClick={() => actions.toggleInspector()}
        title="Expand metadata inspector"
        type="button"
      >
        <PanelRightOpen aria-hidden="true" />
      </button>
    </aside>
  );
}

function InspectorSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      <div className="inspector-grid">{children}</div>
    </section>
  );
}

function InspectorRow({
  label,
  mono = false,
  value,
}: {
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="inspector-row">
      <span>{label}</span>
      <strong className={mono ? "mono" : ""}>{value}</strong>
    </div>
  );
}

function LogsWorkspace({
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
        description="Start the daemon to stream the current runtime log tail through the Desktop API."
        label="Logs"
        state={state}
        title="Daemon logs are paused while Jin is stopped."
      />
    );
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return (
      <LifecycleState
        actions={actions}
        description={
          snapshot.status.runtime.state === "starting"
            ? "The log tail will load once the daemon is queryable."
            : "The log tail is paused until shutdown completes."
        }
        label="Logs"
        state={state}
        title={
          snapshot.status.runtime.state === "starting"
            ? "Jin is starting up."
            : "Jin is shutting down."
        }
      />
    );
  }

  const logs = state.logs;
  const logPath = logs?.path ?? snapshot.status.paths.log;

  return (
    <section className="workspace-logs">
      <section className="compact-panel compact-panel-wide logs-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Runtime log</span>
            <h2>Daemon log tail</h2>
          </div>
          <button
            className="toolbar-button subtle"
            onClick={() => void actions.refreshShell()}
            type="button"
          >
            {state.logsLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="runtime-grid runtime-grid-paths logs-meta-grid">
          <RuntimeField label="Path" value={logPath} />
          <RuntimeField
            label="Lines"
            value={
              logs
                ? `${formatNumber(logs.returnedLines)} shown / ${formatNumber(
                    logs.totalLines,
                  )} total`
                : `Waiting for ${formatNumber(state.logsRequest.limit ?? 240)} lines`
            }
          />
        </div>
        <LogsBody actions={actions} state={state} />
      </section>
    </section>
  );
}

function LogsBody({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const logs = state.logs;

  if (state.logsLoading && !logs) {
    return <ListPlaceholder className="logs-placeholder" />;
  }

  if (state.logsError && !logs) {
    return (
      <div className="empty-state logs-empty">
        <h3>Daemon logs unavailable</h3>
        <p>{state.logsError}</p>
        <button
          className="toolbar-button"
          onClick={() => void actions.refreshShell()}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!logs || logs.lines.length === 0) {
    return (
      <div className="empty-state logs-empty">
        <h3>No log lines available.</h3>
        <p>
          The daemon log file exists, but the current tail did not return any
          lines.
        </p>
      </div>
    );
  }

  return (
    <div aria-label="Daemon log tail" className="log-viewer" role="log">
      {logs.truncated ? (
        <div className="log-truncation">
          Showing the latest {formatNumber(logs.returnedLines)} lines.
        </div>
      ) : null}
      {logs.lines.map((line, index) => (
        <LogLine index={index} key={`${line}-${index}`} line={line} />
      ))}
    </div>
  );
}

function LogLine({ index, line }: { index: number; line: string }) {
  const severityClass = /\b(error|failed|failure|exception)\b/i.test(line)
    ? "error"
    : /\b(warn|warning|degraded)\b/i.test(line)
      ? "warning"
      : "";

  return (
    <pre className={`log-line ${severityClass}`}>
      <span className="log-line-number">{formatNumber(index + 1)}</span>
      <span className="log-line-copy">{line.length > 0 ? line : " "}</span>
    </pre>
  );
}

function SettingsWorkspace({ state }: { state: RendererState }) {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return null;
  }

  const { status } = snapshot;

  return (
    <section className="workspace-settings">
      <section className="compact-panel compact-panel-span">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Runtime</span>
            <h2>Daemon status</h2>
          </div>
          <span className={`status-badge ${status.runtime.state}`}>
            {status.runtime.state}
          </span>
        </div>
        <div className="runtime-grid">
          <RuntimeField
            label="Runtime owner"
            value={status.runtime.owner?.mode ?? "none"}
          />
          <RuntimeField label="Health" value={status.health.status} />
          <RuntimeField label="Ingest" value={status.health.ingest} />
          <RuntimeField label="Push" value={status.health.push} />
        </div>
      </section>

      <section className="compact-panel compact-panel-span">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Paths</span>
            <h2>Local files</h2>
          </div>
        </div>
        <div className="runtime-grid runtime-grid-paths">
          <RuntimeField label="Config" value={status.paths.config} />
          <RuntimeField label="Store" value={status.paths.store} />
          <RuntimeField label="Socket" value={status.paths.socket} />
          <RuntimeField label="Log" value={status.paths.log} />
        </div>
      </section>
    </section>
  );
}

function ListPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div className={`list-placeholder ${className}`.trim()}>
      <div className="placeholder-line wide" />
      <div className="placeholder-line" />
      <div className="placeholder-line" />
      <div className="placeholder-line short" />
    </div>
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
  const chart = buildUsageChartModel(data);
  const panelMeta =
    chart.source === "snapshot" ? "Snapshot-derived" : "Last 30 days";

  return (
    <section className="compact-panel compact-panel-wide usage-panel usage-observatory-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Tokens</span>
          <h2>Token &amp; Cost Observatory</h2>
        </div>
        <span className="panel-meta">{panelMeta}</span>
      </div>
      <TokenUsageChart chart={chart} data={data} />
    </section>
  );
}

function TokenUsageChart({
  chart,
  data,
}: {
  chart: UsageChartModel;
  data: DesktopHomeData;
}) {
  if (chart.source === "empty" || chart.days.length === 0) {
    return <div className="empty-row">No token usage has been recorded yet.</div>;
  }

  const { adapters, days } = chart;
  const displayDays = buildUsageDisplayBuckets(chart);
  const { chartData, series } = buildUsageRechartsData(displayDays, adapters);
  const latestDay = days.at(-1)!;
  const latestEntries = [...latestDay.entries].sort(
    (left, right) =>
      right.tokens - left.tokens || left.adapterId.localeCompare(right.adapterId),
  );
  const totalTokens = days.reduce((sum, day) => sum + day.totalTokens, 0);
  const totalCost = days.reduce((sum, day) => sum + day.totalCost, 0);
  const currentTokens = data.overview.tokens || totalTokens;
  const currentCost = data.overview.cost || totalCost;
  const title =
    chart.source === "snapshot"
      ? "Snapshot-derived burn chart"
      : "Daily burn chart";
  const description =
    chart.source === "snapshot"
      ? "Timeline rows are empty, so this chart is derived from current aggregate adapter totals."
      : "Stacked token volume by adapter from the local SQLite store.";
  const ariaLabel =
    chart.source === "snapshot"
      ? "Snapshot-derived token usage by adapter"
      : "Daily token usage by adapter";

  return (
    <div className="usage-chart" data-usage-chart-source={chart.source}>
      <div className="usage-chart-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="usage-chart-total">
          <span>Current total</span>
          <strong>{formatMetricNumber(currentTokens).display} tok</strong>
          <small>{formatCost(currentCost)}</small>
        </div>
      </div>
      <div className="usage-chart-kpis">
        <span>
          <strong>{formatMetricNumber(totalTokens).display}</strong>
          {chart.source === "snapshot" ? " snapshot tokens" : " chart tokens"}
        </span>
        <span>
          <strong>{formatCost(totalCost)}</strong>
          {chart.source === "snapshot" ? " snapshot cost" : " chart cost"}
        </span>
        <span>
          <strong>{formatNumber(adapters.length)}</strong>
          adapters
        </span>
      </div>
      <div className="usage-chart-frame">
        <div
          aria-label={ariaLabel}
          className="usage-area-chart-shell"
          role="img"
        >
          <StaticUsageAreaChart adapters={adapters} days={displayDays} />
          <AreaChart
            accessibilityLayer
            className="usage-area-chart"
            data={chartData}
            height={USAGE_CHART_HEIGHT}
            margin={{ bottom: 24, left: 2, right: 24, top: 18 }}
            width={USAGE_CHART_WIDTH}
          >
            <defs>
              {series.map((adapter) => (
                <linearGradient
                  id={`usage-fill-${adapter.key}`}
                  key={adapter.key}
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={adapter.color}
                    stopOpacity="0.78"
                  />
                  <stop
                    offset="100%"
                    stopColor={adapter.color}
                    stopOpacity="0.32"
                  />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid
              horizontal
              stroke="rgba(210, 224, 255, 0.11)"
              strokeDasharray="4 7"
              vertical={false}
            />
            <XAxis
              axisLine={false}
              dataKey="label"
              interval={displayDays.length <= 8 ? 0 : "preserveStartEnd"}
              tick={{ fill: "var(--text-dim)", fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: "var(--text-dim)", fontSize: 12 }}
              tickFormatter={(value) => formatMetricNumber(Number(value)).display}
              tickLine={false}
              width={56}
            />
            <RechartsTooltip
              content={<UsageChartTooltip />}
              cursor={{ stroke: "rgba(246, 248, 253, 0.5)", strokeDasharray: "6 6" }}
              wrapperStyle={{ outline: "none" }}
            />
            {series.map((adapter) => (
              <Area
                dataKey={adapter.key}
                dot={false}
                fill={`url(#usage-fill-${adapter.key})`}
                isAnimationActive={false}
                key={adapter.key}
                name={adapter.adapterId}
                stackId="tokens"
                stroke={adapter.color}
                strokeWidth={1.6}
                type="monotone"
              />
            ))}
          </AreaChart>
        </div>
        <div className="usage-callout">
          <strong>
            {chart.source === "snapshot"
              ? "Current snapshot"
              : formatChartDay(latestDay.day)}
          </strong>
          {latestEntries.slice(0, 6).map((entry) => {
            const colorIndex = Math.max(0, adapters.indexOf(entry.adapterId));
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
        {series.map((adapter, index) => (
          <span key={adapter.key}>
            <i className={usageColorClass(index)} />
            {adapter.adapterId}
          </span>
        ))}
      </div>
    </div>
  );
}

function UsageChartTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Array<{
    color?: string;
    name?: string;
    payload?: UsageChartDatum;
    value?: number | string;
  }>;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const rows = payload
    .filter((entry) => Number(entry.value) > 0)
    .sort((left, right) => Number(right.value) - Number(left.value));

  return (
    <div className="usage-callout usage-callout-tooltip">
      <strong>{label}</strong>
      {rows.slice(0, 6).map((entry) => (
        <span key={entry.name}>
          <i style={{ background: entry.color ?? "#89d4a1" }} />
          {entry.name}
          <b>{formatMetricNumber(Number(entry.value)).display}</b>
        </span>
      ))}
    </div>
  );
}

function StaticUsageAreaChart({
  adapters,
  days,
}: {
  adapters: string[];
  days: UsageDisplayBucket[];
}) {
  if (days.length === 0 || adapters.length === 0) {
    return null;
  }

  const layers = buildStaticUsageAreaLayers(days, adapters);

  return (
    <svg
      aria-hidden="true"
      className="usage-area-static-chart"
      data-usage-static-chart="true"
      viewBox={`0 0 ${USAGE_CHART_WIDTH} ${USAGE_CHART_HEIGHT}`}
    >
      <rect
        className="usage-static-plot-bg"
        height={USAGE_STATIC_CHART_PLOT.height}
        width={USAGE_STATIC_CHART_PLOT.width}
        x={USAGE_STATIC_CHART_PLOT.x}
        y={USAGE_STATIC_CHART_PLOT.y}
      />
      {layers.map((layer, index) => (
        <path
          className="usage-area-static-fill usage-area-static-layer"
          d={layer.path}
          data-adapter-id={layer.adapterId}
          fill={usageColorHex(index)}
          key={layer.adapterId}
        />
      ))}
      {days.map((day, index) => {
        if (!shouldRenderUsageDayLabel(index, days.length)) {
          return null;
        }
        const x = usageStaticX(index, days.length);
        return (
          <text
            className="usage-area-static-label"
            key={`${day.day}-${index}`}
            textAnchor="middle"
            x={x}
            y={USAGE_STATIC_CHART_PLOT.y + USAGE_STATIC_CHART_PLOT.height + 32}
          >
            {formatUsageDisplayDay(day)}
          </text>
        );
      })}
    </svg>
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

function PreformattedText({ value }: { value: string }) {
  return <pre>{value.length > 0 ? value : " "}</pre>;
}

function renderConversationHeaderSummary(
  detail: DesktopConversationDetailView,
): string {
  const parentSummary = detail.parent
    ? `Parent ${shortId(detail.parent.id)}`
    : "Root conversation";
  const childSummary =
    detail.children.length > 0
      ? `${formatNumber(detail.children.length)} child conversation${
          detail.children.length === 1 ? "" : "s"
        }`
      : "No child conversations";

  return `${parentSummary} - ${childSummary} - ${formatNumber(
    detail.trace.conversationCount,
  )} conversations in trace`;
}

function totalTokens(conversation: Conversation): number {
  return (
    conversation.inputTokens +
    conversation.outputTokens +
    conversation.cacheRead +
    conversation.cacheWrite
  );
}

function treeDepthClass(depth: number): number {
  if (!Number.isFinite(depth) || depth <= 0) {
    return 0;
  }

  return Math.min(TREE_DEPTH_CLASS_MAX, Math.floor(depth));
}

function buildUsageChartModel(data: DesktopHomeData): UsageChartModel {
  const timelineEntries = (data.tokenUsageByDay ?? []).filter(
    (entry) => entry.tokens > 0 || entry.cost > 0,
  );

  if (timelineEntries.length > 0) {
    return buildUsageChartModelFromEntries(timelineEntries, "timeline");
  }

  const snapshotDay = normalizeUsageSnapshotDay(data.generatedAt);
  const adapterEntries = data.topAdapters
    .filter((adapter) => adapter.tokens > 0 || adapter.cost > 0)
    .map((adapter) => ({
      adapterId: adapter.adapterId || "unknown",
      cost: adapter.cost,
      day: snapshotDay,
      sessions: adapter.conversations,
      tokens: adapter.tokens,
    }));

  if (adapterEntries.length > 0) {
    return buildUsageChartModelFromEntries(adapterEntries, "snapshot");
  }

  if (data.overview.tokens > 0 || data.overview.cost > 0) {
    return buildUsageChartModelFromEntries(
      [
        {
          adapterId: "all adapters",
          cost: data.overview.cost,
          day: snapshotDay,
          sessions: data.overview.conversations,
          tokens: data.overview.tokens,
        },
      ],
      "snapshot",
    );
  }

  return {
    adapters: [],
    days: [],
    source: "empty",
  };
}

function buildUsageChartModelFromEntries(
  entries: Array<{
    adapterId: string;
    cost: number;
    day: string;
    sessions: number;
    tokens: number;
  }>,
  source: UsageChartModel["source"],
): UsageChartModel {
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
  const days = Array.from(dayMap.values())
    .sort((left, right) => left.day.localeCompare(right.day))
    .slice(-30);

  return {
    adapters,
    days,
    source,
  };
}

function normalizeUsageSnapshotDay(value: string): string {
  if (!value) {
    return "snapshot";
  }

  const [day] = value.split("T");
  return day && day.length > 0 ? day : value;
}

function buildUsageDisplayBuckets(chart: UsageChartModel): UsageDisplayBucket[] {
  if (chart.source !== "snapshot" || chart.days.length !== 1) {
    return chart.days;
  }

  const snapshotDay = chart.days[0]!;
  return [
    {
      ...snapshotDay,
      day: `${snapshotDay.day}:snapshot`,
      label: "Snapshot",
    },
    {
      ...snapshotDay,
      day: `${snapshotDay.day}:current`,
      label: "Current",
    },
  ];
}

function buildUsageRechartsData(
  days: UsageDisplayBucket[],
  adapters: string[],
): { chartData: UsageChartDatum[]; series: UsageChartSeries[] } {
  const series = adapters.map((adapterId, index) => ({
    adapterId,
    color: usageColorHex(index),
    key: `adapter_${index}`,
  }));

  const chartData = days.map((day) => {
    const datum: UsageChartDatum = {
      day: day.day,
      label: formatUsageDisplayDay(day),
      totalCost: day.totalCost,
      totalTokens: day.totalTokens,
    };

    for (const [index, adapterId] of adapters.entries()) {
      datum[`adapter_${index}`] = day.entries
        .filter((entry) => entry.adapterId === adapterId)
        .reduce((sum, entry) => sum + entry.tokens, 0);
    }

    return datum;
  });

  return { chartData, series };
}

function buildStaticUsageAreaLayers(
  days: UsageDisplayBucket[],
  adapters: string[],
): Array<{ adapterId: string; path: string }> {
  const maxDailyTokens = Math.max(...days.map((day) => day.totalTokens), 1);
  const cumulative = days.map(() => 0);

  return adapters.map((adapterId) => {
    const upperPoints: string[] = [];
    const lowerPoints: string[] = [];

    days.forEach((day, dayIndex) => {
      const x = usageStaticX(dayIndex, days.length);
      const tokens = day.entries
        .filter((entry) => entry.adapterId === adapterId)
        .reduce((sum, entry) => sum + entry.tokens, 0);
      const lower = cumulative[dayIndex] ?? 0;
      const upper = lower + tokens;
      upperPoints.push(
        `${x.toFixed(1)},${usageStaticY(upper, maxDailyTokens).toFixed(1)}`,
      );
      lowerPoints.unshift(
        `${x.toFixed(1)},${usageStaticY(lower, maxDailyTokens).toFixed(1)}`,
      );
      cumulative[dayIndex] = upper;
    });

    return {
      adapterId,
      path: `M ${upperPoints.join(" L ")} L ${lowerPoints.join(" L ")} Z`,
    };
  });
}

function usageStaticX(index: number, count: number): number {
  if (count <= 1) {
    return USAGE_STATIC_CHART_PLOT.x + USAGE_STATIC_CHART_PLOT.width / 2;
  }

  return (
    USAGE_STATIC_CHART_PLOT.x +
    (USAGE_STATIC_CHART_PLOT.width * index) / (count - 1)
  );
}

function usageStaticY(value: number, maxDailyTokens: number): number {
  const clamped = Math.max(0, Math.min(value, maxDailyTokens));
  return (
    USAGE_STATIC_CHART_PLOT.y +
    USAGE_STATIC_CHART_PLOT.height -
    (clamped / Math.max(maxDailyTokens, 1)) * USAGE_STATIC_CHART_PLOT.height
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

function formatUsageDisplayDay(day: UsageDisplayBucket): string {
  return day.label ?? formatChartDay(day.day);
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
