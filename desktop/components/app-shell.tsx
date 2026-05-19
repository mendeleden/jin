import { type ReactNode, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import {
  FileText,
  Home,
  Info,
  ChevronLeft,
  ChevronRight,
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
  Bar,
  CartesianGrid,
  ComposedChart,
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
import { RoutingFlowGraph } from "../graph-components";
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
const USAGE_CHART_WIDTH = 1280;
const USAGE_CHART_HEIGHT = 252;
const USAGE_DAILY_WINDOW_SIZE = 14;
const USAGE_MONTHLY_WINDOW_SIZE = 4;
const USAGE_MAX_HISTORY_DAYS = 366;
const TREE_DEPTH_CLASS_MAX = 12;

type UsageChartPeriod = "daily" | "monthly";
type HomeBreakdownMetric = "tokens" | "conversations" | "cost";

type UsageDayBucket = {
  day: string;
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  entries: Array<{
    adapterId: string;
    cost: number;
    sessions: number;
    tokens: number;
  }>;
};

type UsageDisplayBucket = UsageDayBucket & {
  label?: string;
  rangeEnd?: string;
};

type UsageChartModel = {
  days: UsageDayBucket[];
  adapters: string[];
  source: "timeline" | "snapshot" | "empty";
  weeklyDays?: UsageDisplayBucket[];
};

type UsageWindowedChartModel = Omit<UsageChartModel, "days"> & {
  canGoNext: boolean;
  canGoPrevious: boolean;
  days: UsageDisplayBucket[];
  period: UsageChartPeriod;
  rangeLabel: string;
  windowLabel: string;
};

type UsageChartDatum = {
  day: string;
  label: string;
  totalCost: number;
  totalSessions: number;
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
      <HomePulsePanel data={data} />
      <HomeProjectActivityPanel data={data} />
      <HomeAdapterMixPanel data={data} />
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
      <ConversationWorkspaceToolbar actions={actions} state={state} />
      <aside className="library-panel">
        <div className="panel-header panel-header-tight">
          <div>
            <span className="eyebrow">Library</span>
            <h2>Index</h2>
          </div>
          <span className="panel-meta">
            {state.library
              ? `${formatNumber(state.library.conversations.length)} shown`
              : state.libraryLoading
                ? "Loading..."
                : "Waiting"}
          </span>
        </div>
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

function ConversationWorkspaceToolbar({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  const shown = state.library?.conversations.length ?? 0;
  const totalLabel = state.library
    ? `${formatNumber(shown)} shown`
    : state.libraryLoading
      ? "Loading..."
      : "Waiting";

  return (
    <div className="conversation-workspace-toolbar">
      <div className="conversation-toolbar-summary">
        <span className="eyebrow">Workspace</span>
        <strong>Conversation index</strong>
        <span>{totalLabel}</span>
      </div>
      <ConversationFilters actions={actions} state={state} />
      <RelationshipMix library={state.library} />
    </div>
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
    <div className="filter-bar conversation-filter-row">
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
        <div className="conversation-row-title" title={conversation.name}>
          {formatConversationTitle(conversation.name)}
        </div>
        <span className={`relationship-chip ${conversation.relationship}`}>
          {conversation.relationship}
        </span>
      </div>
      <div className="conversation-row-meta">
        <span>{conversation.adapterId}</span>
        <span>{formatDate(conversation.endedAt || conversation.startedAt)}</span>
        <span>{formatNumber(conversation.messageCount)} msg</span>
        <span>{formatMetricNumber(totalTokens(conversation)).display} tok</span>
      </div>
      <div className="conversation-row-foot">
        <span className="mono">{shortId(conversation.id)}</span>
        <span className="truncate">
          {formatProjectReference(conversation.gitRemote || conversation.cwd)}
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
          <h2 title={conversation.name}>{formatConversationTitle(conversation.name)}</h2>
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
  const metadata = messageMetadata(message);

  return (
    <article className="message-card">
      <div className="message-header">
        <div className={`message-role ${message.role}`}>{message.role}</div>
        {metadata.length > 0 ? (
          <div className="message-meta">
            {metadata.map((entry) => (
              <span key={entry}>{entry}</span>
            ))}
          </div>
        ) : null}
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
              <div className="trace-row-title" title={conversation.name}>
                {formatConversationTitle(conversation.name)}
              </div>
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
          <span className="tree-node-title" title={node.conversation.name}>
            {formatConversationTitle(node.conversation.name)}
          </span>
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
        <span>Metadata</span>
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

function HomePulsePanel({ data }: { data: DesktopHomeData }) {
  const chart = buildUsageChartModel(data);
  const monthlyAvailable =
    chart.source === "timeline" && (chart.weeklyDays?.length ?? 0) > 0;
  const [period, setPeriod] = useState<UsageChartPeriod>("daily");
  const [windowOffset, setWindowOffset] = useState(0);
  const effectivePeriod =
    period === "monthly" && !monthlyAvailable ? "daily" : period;
  const windowedChart = buildWindowedUsageChart(
    chart,
    effectivePeriod,
    windowOffset,
  );

  return (
    <section className="compact-panel home-pulse-panel usage-panel">
      <TokenUsageChart
        chart={windowedChart}
        monthlyAvailable={monthlyAvailable}
        onNextWindow={() => setWindowOffset((current) => Math.max(0, current - 1))}
        onPeriodChange={(nextPeriod) => {
          setPeriod(nextPeriod);
          setWindowOffset(0);
        }}
        onPreviousWindow={() => setWindowOffset((current) => current + 1)}
      />
    </section>
  );
}

function HomeProjectActivityPanel({ data }: { data: DesktopHomeData }) {
  const [metric, setMetric] = useState<HomeBreakdownMetric>("tokens");
  const projects =
    data.projectUsageByHarness && data.projectUsageByHarness.length > 0
      ? data.projectUsageByHarness
      : data.topProjects.map((project) => ({
          ...project,
          adapters: project.adapters.map((adapterId) => ({
            adapterId,
            conversations: project.conversationCount,
            cost: project.totalCost,
            tokens: project.totalTokens,
          })),
        }));
  const maxValue = Math.max(
    ...projects.map((project) => projectMetricValue(project, metric)),
    1,
  );

  return (
    <section className="compact-panel home-project-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Projects</span>
          <h2>Project Stacks</h2>
        </div>
        <HomeMetricToggle metric={metric} onChange={setMetric} />
      </div>
      <div className="home-project-list home-stacked-project-list">
        {projects.length > 0 ? (
          projects.slice(0, 7).map((project) => {
            const total = projectMetricValue(project, metric);
            return (
            <article className="home-project-row home-stacked-project-row" key={project.id}>
              <div className="home-project-row-head">
                <strong title={project.name}>{formatProjectReference(project.name)}</strong>
                <span>{formatHomeMetricValue(total, metric)}</span>
              </div>
              <div
                className="home-project-stack"
                title={`${formatProjectReference(project.name)}: ${formatHomeMetricValue(
                  total,
                  metric,
                )}`}
              >
                <div
                  className="home-project-stack-scale"
                  style={{
                    width: `${Math.max(7, (total / maxValue) * 100).toFixed(1)}%`,
                  }}
                >
                  {project.adapters.map((adapter, index) => {
                    const value = adapterMetricValue(adapter, metric);
                    if (value <= 0 || total <= 0) {
                      return null;
                    }
                    return (
                      <span
                        className={usageColorClass(index)}
                        key={adapter.adapterId}
                        style={{
                          width: `${Math.max(3, (value / total) * 100).toFixed(1)}%`,
                        }}
                        title={`${adapter.adapterId}: ${formatHomeMetricValue(
                          value,
                          metric,
                        )}`}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="home-project-row-meta">
                <span>Last seen {formatDate(project.lastSeen)}</span>
                <span>
                  {project.adapters.map((adapter) => adapter.adapterId).join(", ") ||
                    "unknown adapter"}
                </span>
              </div>
            </article>
          );
          })
        ) : (
          <div className="empty-row">No linked projects yet.</div>
        )}
      </div>
    </section>
  );
}

function HomeAdapterMixPanel({ data }: { data: DesktopHomeData }) {
  const [metric, setMetric] = useState<Extract<HomeBreakdownMetric, "tokens" | "conversations">>("tokens");
  const chart = buildUsageChartModel(data);
  const windowedChart = buildWindowedUsageChart(chart, "daily", 0);
  const adapters = windowedChart.adapters.slice(0, 6);
  const days = windowedChart.days;
  const totals = adapters.map((adapterId) => ({
    adapterId,
    value: days.reduce(
      (sum, day) =>
        sum +
        day.entries
          .filter((entry) => entry.adapterId === adapterId)
          .reduce(
            (entrySum, entry) =>
              entrySum +
              (metric === "tokens" ? entry.tokens : entry.sessions),
            0,
          ),
      0,
    ),
  }));
  const maxValue = Math.max(...totals.map((entry) => entry.value), 1);

  return (
    <section className="compact-panel home-adapter-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Harnesses</span>
          <h2>Harness Timeline</h2>
        </div>
        <HomeMetricToggle
          metric={metric}
          onChange={(nextMetric) => {
            if (nextMetric !== "cost") {
              setMetric(nextMetric);
            }
          }}
          values={["tokens", "conversations"]}
        />
      </div>
      <div className="home-adapter-list home-harness-timeline-list">
        {adapters.length > 0 ? (
          adapters.map((adapterId, index) => {
            const total = totals.find((entry) => entry.adapterId === adapterId)?.value ?? 0;
            return (
            <article className="home-adapter-row home-harness-row" key={adapterId}>
              <i className={usageColorClass(index)} />
              <div>
                <strong>{adapterId}</strong>
                <span>
                  {formatHomeMetricValue(total, metric)} over current window
                </span>
              </div>
              <div className="home-harness-sparkline" aria-hidden="true">
                {days.map((day) => {
                  const dayValue = day.entries
                    .filter((entry) => entry.adapterId === adapterId)
                    .reduce(
                      (sum, entry) =>
                        sum + (metric === "tokens" ? entry.tokens : entry.sessions),
                      0,
                    );
                  return (
                    <span key={day.day}>
                      <i
                        className={usageColorClass(index)}
                        style={{
                          height: `${Math.max(
                            dayValue > 0 ? 12 : 2,
                            (dayValue / maxValue) * 100,
                          ).toFixed(1)}%`,
                        }}
                        title={`${formatUsageDisplayDay(day)}: ${formatHomeMetricValue(
                          dayValue,
                          metric,
                        )}`}
                      />
                    </span>
                  );
                })}
              </div>
            </article>
          );
          })
        ) : (
          <div className="empty-row">No adapter activity recorded yet.</div>
        )}
      </div>
    </section>
  );
}

function HomeMetricToggle({
  metric,
  onChange,
  values = ["tokens", "conversations", "cost"],
}: {
  metric: HomeBreakdownMetric;
  onChange(metric: HomeBreakdownMetric): void;
  values?: HomeBreakdownMetric[];
}) {
  return (
    <div className="home-metric-toggle" role="group" aria-label="Breakdown metric">
      {values.map((value) => (
        <button
          aria-pressed={metric === value}
          className={metric === value ? "active" : ""}
          key={value}
          onClick={() => onChange(value)}
          type="button"
        >
          {homeMetricLabel(value)}
        </button>
      ))}
    </div>
  );
}

function projectMetricValue(
  project: {
    conversationCount: number;
    totalCost: number;
    totalTokens: number;
  },
  metric: HomeBreakdownMetric,
): number {
  if (metric === "conversations") {
    return project.conversationCount;
  }
  if (metric === "cost") {
    return project.totalCost;
  }
  return project.totalTokens;
}

function adapterMetricValue(
  adapter: { conversations: number; cost: number; tokens: number },
  metric: HomeBreakdownMetric,
): number {
  if (metric === "conversations") {
    return adapter.conversations;
  }
  if (metric === "cost") {
    return adapter.cost;
  }
  return adapter.tokens;
}

function homeMetricLabel(metric: HomeBreakdownMetric): string {
  if (metric === "conversations") {
    return "Convs";
  }
  if (metric === "cost") {
    return "Cost";
  }
  return "Tokens";
}

function formatHomeMetricValue(value: number, metric: HomeBreakdownMetric): string {
  if (metric === "cost") {
    return formatCost(value);
  }
  if (metric === "conversations") {
    return `${formatNumber(value)} conv`;
  }
  return `${formatMetricNumber(value).display} tok`;
}

function TokenUsageChart({
  chart,
  monthlyAvailable,
  onNextWindow,
  onPeriodChange,
  onPreviousWindow,
}: {
  chart: UsageWindowedChartModel;
  monthlyAvailable: boolean;
  onNextWindow(): void;
  onPeriodChange(period: UsageChartPeriod): void;
  onPreviousWindow(): void;
}) {
  const [metric, setMetric] = useState<HomeBreakdownMetric>("tokens");

  if (chart.source === "empty" || chart.days.length === 0) {
    return <div className="empty-row">No token usage has been recorded yet.</div>;
  }

  const { adapters, days } = chart;
  const displayDays = chart.days;
  const { chartData, series } = buildUsageRechartsData(
    displayDays,
    adapters,
    metric,
  );
  const summaryDays =
    chart.source === "snapshot" && days.length > 1 ? [days.at(-1)!] : days;
  const latestDay = summaryDays.at(-1)!;
  const latestEntries = [...latestDay.entries].sort(
    (left, right) =>
      usageEntryMetricValue(right, metric) -
        usageEntryMetricValue(left, metric) ||
      left.adapterId.localeCompare(right.adapterId),
  );
  const totalTokens = summaryDays.reduce((sum, day) => sum + day.totalTokens, 0);
  const totalCost = summaryDays.reduce((sum, day) => sum + day.totalCost, 0);
  const totalSessions = summaryDays.reduce(
    (sum, day) => sum + day.totalSessions,
    0,
  );
  const periodLabel = chart.period === "monthly" ? "Weekly" : "Daily";
  const metricLabel = homeMetricLabel(metric).toLowerCase();
  const metricUsageLabel = usageMetricUsageLabel(metric);
  const useWeeklyBars = chart.period === "monthly" && chart.source === "timeline";
  const title =
    chart.source === "snapshot"
      ? "Current activity snapshot"
      : `${periodLabel} ${metricLabel} by adapter`;
  const description =
    chart.source === "snapshot"
      ? "Timeline rows are empty, so this pulse is derived from current aggregate adapter totals."
      : `Stacked ${metricLabel} by adapter, with the conversation rail below.`;
  const ariaLabel =
    chart.source === "snapshot"
      ? `Snapshot-derived ${metricUsageLabel} usage by adapter`
      : chart.period === "monthly"
        ? `Weekly ${metricUsageLabel} usage by adapter`
        : `Daily ${metricUsageLabel} usage by adapter`;
  const xAxisInterval =
    displayDays.length <= 7
      ? 0
      : Math.max(1, Math.ceil(displayDays.length / 6) - 1);

  return (
    <div
      className="usage-chart"
      data-usage-chart-source={chart.source}
      data-usage-period={chart.period}
      data-usage-window={chart.windowLabel}
    >
      <div className="usage-chart-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="usage-chart-controls" aria-label="Usage chart controls">
          <HomeMetricToggle
            metric={metric}
            onChange={setMetric}
          />
          <div className="usage-period-toggle" aria-label="Usage period" role="group">
            <button
              aria-pressed={chart.period === "daily"}
              className={chart.period === "daily" ? "active" : ""}
              onClick={() => onPeriodChange("daily")}
              type="button"
            >
              Daily
            </button>
            <button
              aria-pressed={chart.period === "monthly"}
              className={chart.period === "monthly" ? "active" : ""}
              disabled={!monthlyAvailable}
              onClick={() => onPeriodChange("monthly")}
              title={
                monthlyAvailable
                  ? "Monthly rollup"
                  : "Monthly rollup requires weekly usage buckets"
              }
              type="button"
            >
              Monthly
            </button>
          </div>
          <div className="usage-window-controls" aria-label={chart.rangeLabel}>
            <button
              aria-label="Previous usage window"
              className="toolbar-button usage-window-button"
              disabled={!chart.canGoPrevious}
              onClick={onPreviousWindow}
              title="Previous window"
              type="button"
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <span title={chart.windowLabel}>{chart.rangeLabel}</span>
            <button
              aria-label="Next usage window"
              className="toolbar-button usage-window-button"
              disabled={!chart.canGoNext}
              onClick={onNextWindow}
              title="Next window"
              type="button"
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <div className="usage-chart-kpis">
        <span>
          <strong>{formatMetricNumber(totalTokens).display}</strong>
          tokens
        </span>
        <span>
          <strong>{formatNumber(totalSessions)}</strong>
          conversations
        </span>
        <span>
          <strong>{formatCost(totalCost)}</strong>
          est. cost
        </span>
      </div>
      <div className="usage-chart-frame">
        <div
          aria-label={ariaLabel}
          className="usage-area-chart-shell"
          role="img"
        >
          <ComposedChart
            accessibilityLayer
            className="usage-area-chart"
            data={chartData}
            height={USAGE_CHART_HEIGHT}
            margin={{ bottom: 36, left: 12, right: 36, top: 18 }}
            width={USAGE_CHART_WIDTH}
            barCategoryGap={useWeeklyBars ? "28%" : "10%"}
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
              interval={xAxisInterval}
              padding={{ left: 16, right: 36 }}
              tick={{ fill: "var(--text-dim)", fontSize: 12 }}
              tickFormatter={(value, index) =>
                displayDays.length > 6 && index === displayDays.length - 1
                  ? ""
                  : String(value)
              }
              tickMargin={10}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: "var(--text-dim)", fontSize: 12 }}
              tickFormatter={(value) =>
                formatHomeMetricValue(Number(value), metric)
                  .replace(" conv", "")
                  .replace(" tok", "")
              }
              tickMargin={8}
              tickLine={false}
              width={64}
            />
            <RechartsTooltip
              content={<UsageChartTooltip metric={metric} />}
              cursor={{ stroke: "rgba(246, 248, 253, 0.5)", strokeDasharray: "6 6" }}
              wrapperStyle={{ outline: "none" }}
            />
            {series.map((adapter) =>
              useWeeklyBars ? (
                <Bar
                  dataKey={adapter.key}
                  fill={adapter.color}
                  isAnimationActive={false}
                  key={adapter.key}
                  maxBarSize={44}
                  name={adapter.adapterId}
                  stackId={metric}
                />
              ) : (
                <Area
                  dataKey={adapter.key}
                  dot={false}
                  fill={`url(#usage-fill-${adapter.key})`}
                  isAnimationActive={false}
                  key={adapter.key}
                  name={adapter.adapterId}
                  stackId={metric}
                  stroke={adapter.color}
                  strokeWidth={1.6}
                  type="monotone"
                />
              ),
            )}
          </ComposedChart>
        </div>
      </div>
      <div className="usage-callout usage-latest-strip">
        <strong>
          {chart.source === "snapshot"
            ? "Current snapshot"
            : formatUsageDisplayDay(latestDay)}
        </strong>
        <span>
          <i className="usage-session-dot" />
          tokens
          <b>{formatMetricNumber(latestDay.totalTokens).display}</b>
        </span>
        <span>
          <i className="usage-session-dot" />
          conversations
          <b>{formatNumber(latestDay.totalSessions)}</b>
        </span>
        <span>
          <i className="usage-session-dot" />
          est. cost
          <b>{formatCost(latestDay.totalCost)}</b>
        </span>
        {latestEntries.slice(0, 6).map((entry) => {
          const colorIndex = Math.max(0, adapters.indexOf(entry.adapterId));
          return (
            <span key={entry.adapterId}>
              <i className={usageColorClass(colorIndex)} />
              {entry.adapterId}
              <b>{formatHomeMetricValue(usageEntryMetricValue(entry, metric), metric)}</b>
            </span>
          );
        })}
      </div>
      <UsageSessionRail days={displayDays} />
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
  metric,
  payload,
}: {
  active?: boolean;
  label?: string | number;
  metric: HomeBreakdownMetric;
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
      {rows[0]?.payload ? (
        <>
          <span>
            <i className="usage-session-dot" />
            tokens
            <b>{formatMetricNumber(rows[0].payload.totalTokens).display}</b>
          </span>
          <span>
            <i className="usage-session-dot" />
            conversations
            <b>{formatNumber(rows[0].payload.totalSessions)}</b>
          </span>
          <span>
            <i className="usage-session-dot" />
            est. cost
            <b>{formatCost(rows[0].payload.totalCost)}</b>
          </span>
        </>
      ) : null}
      {rows.slice(0, 6).map((entry) => (
        <span key={entry.name}>
          <i style={{ background: entry.color ?? "#89d4a1" }} />
          {entry.name}
          <b>{formatHomeMetricValue(Number(entry.value), metric)}</b>
        </span>
      ))}
    </div>
  );
}

function UsageSessionRail({ days }: { days: UsageDisplayBucket[] }) {
  if (days.length === 0) {
    return null;
  }

  const maxSessions = Math.max(...days.map((day) => day.totalSessions), 1);

  return (
    <div className="usage-session-rail" aria-label="Conversation volume by day">
      {days.map((day) => (
        <span
          key={day.day}
          title={`${formatUsageDisplayDay(day)}: ${formatNumber(
            day.totalSessions,
          )} conversations`}
        >
          <i
            style={{
              height: `${Math.max(10, (day.totalSessions / maxSessions) * 100).toFixed(
                1,
              )}%`,
            }}
          />
        </span>
      ))}
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

function PreformattedText({ value }: { value: string }) {
  return <pre>{value.length > 0 ? value : " "}</pre>;
}

function formatConversationTitle(value: string): string {
  const compact = value
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .replace(/\s+#+\s+/g, " - ")
    .trim();

  return compact || "Untitled conversation";
}

function messageMetadata(message: Message): string[] {
  const metadata: string[] = [];

  if (Number.isFinite(message.turn) && message.turn >= 0) {
    metadata.push(`Turn ${message.turn}`);
  }

  metadata.push(formatDate(message.timestamp));

  const model = message.model?.trim() ?? "";
  if (model.length > 0) {
    metadata.push(model);
  }

  return metadata;
}

function formatProjectReference(value?: string | null): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "local / unlinked";
  }

  const githubSshMatch = /^git@github\.com:(.+)$/i.exec(trimmed);
  if (githubSshMatch?.[1]) {
    return githubSshMatch[1];
  }

  const githubSshUrlMatch = /^ssh:\/\/git@github\.com\/(.+)$/i.exec(trimmed);
  if (githubSshUrlMatch?.[1]) {
    return githubSshUrlMatch[1];
  }

  return trimmed
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^(?:www\.)?github\.com\//i, "");
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

function buildWindowedUsageChart(
  chart: UsageChartModel,
  period: UsageChartPeriod,
  windowOffset: number,
): UsageWindowedChartModel {
  const displayDays =
    chart.source === "snapshot"
      ? buildUsageDisplayBuckets(chart)
      : period === "monthly"
        ? chart.weeklyDays ?? []
        : chart.days;

  if (chart.source === "empty" || displayDays.length === 0) {
    return {
      ...chart,
      canGoNext: false,
      canGoPrevious: false,
      days: [],
      period,
      rangeLabel: "No usage",
      windowLabel: "No window",
    };
  }

  const windowSize =
    chart.source === "snapshot"
      ? displayDays.length
      : period === "monthly"
        ? USAGE_MONTHLY_WINDOW_SIZE
        : USAGE_DAILY_WINDOW_SIZE;
  const windowCount = Math.max(1, Math.ceil(displayDays.length / windowSize));
  const safeOffset = Math.min(Math.max(0, windowOffset), windowCount - 1);
  const end = displayDays.length - safeOffset * windowSize;
  const start = Math.max(0, end - windowSize);
  const windowDays = displayDays.slice(start, end);
  const windowNumber = windowCount - safeOffset;

  return {
    ...chart,
    canGoNext: safeOffset > 0,
    canGoPrevious: start > 0,
    days: windowDays,
    period,
    rangeLabel: formatUsageWindowRange(windowDays),
    windowLabel:
      windowCount === 1 ? "Only window" : `Window ${windowNumber} of ${windowCount}`,
  };
}

function formatUsageWindowRange(days: UsageDisplayBucket[]): string {
  const first = days[0];
  const last = days.at(-1);

  if (!first || !last) {
    return "No usage";
  }

  const firstLabel = formatUsageDisplayDay(first);
  const lastLabel = formatUsageDisplayDay(last);

  if (first.rangeEnd || last.rangeEnd) {
    const rangeStart = formatChartDay(first.day);
    const rangeEnd = formatChartDay(last.rangeEnd ?? last.day);
    return rangeStart === rangeEnd ? rangeStart : `${rangeStart} - ${rangeEnd}`;
  }

  return firstLabel === lastLabel ? firstLabel : `${firstLabel} - ${lastLabel}`;
}

function buildUsageChartModel(data: DesktopHomeData): UsageChartModel {
  const timelineEntries = (data.tokenUsageByDay ?? []).filter(
    (entry) => entry.sessions > 0 || entry.tokens > 0 || entry.cost > 0,
  );
  const weeklyEntries = (data.tokenUsageByWeek ?? []).filter(
    (entry) => entry.sessions > 0 || entry.tokens > 0 || entry.cost > 0,
  );

  if (timelineEntries.length > 0) {
    const chart = buildUsageChartModelFromEntries(timelineEntries, "timeline");
    return {
      ...chart,
      weeklyDays: buildUsageChartModelFromEntries(
        weeklyEntries.map((entry) => ({
          adapterId: entry.adapterId,
          cost: entry.cost,
          day: entry.weekStart,
          sessions: entry.sessions,
          tokens: entry.tokens,
        })),
        "timeline",
      ).days.map((day) => ({
        ...day,
        label: formatUsageWeekRange(
          day.day,
          weeklyEntries.find((entry) => entry.weekStart === day.day)?.weekEnd ??
            day.day,
        ),
        rangeEnd:
          weeklyEntries.find((entry) => entry.weekStart === day.day)?.weekEnd ??
          day.day,
      })),
    };
  }

  const snapshotDay = normalizeUsageSnapshotDay(data.generatedAt);
  const adapterEntries = data.topAdapters
    .filter(
      (adapter) =>
        adapter.conversations > 0 || adapter.tokens > 0 || adapter.cost > 0,
    )
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

  if (
    data.overview.conversations > 0 ||
    data.overview.tokens > 0 ||
    data.overview.cost > 0
  ) {
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
    weeklyDays: [],
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
      totalSessions: 0,
      totalTokens: 0,
    };
    day.totalTokens += entry.tokens;
    day.totalCost += entry.cost;
    day.totalSessions += entry.sessions;
    const existingEntry = day.entries.find(
      (dayEntry) => dayEntry.adapterId === adapterId,
    );
    if (existingEntry) {
      existingEntry.cost += entry.cost;
      existingEntry.sessions += entry.sessions;
      existingEntry.tokens += entry.tokens;
    } else {
      day.entries.push({
        adapterId,
        cost: entry.cost,
        sessions: entry.sessions,
        tokens: entry.tokens,
      });
    }
    dayMap.set(entry.day, day);
    adapterTotals.set(
      adapterId,
      (adapterTotals.get(adapterId) ?? 0) + entry.tokens + entry.sessions,
    );
  }

  const adapters = Array.from(adapterTotals.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([adapterId]) => adapterId);
  const days = Array.from(dayMap.values())
    .sort((left, right) => left.day.localeCompare(right.day))
    .slice(-USAGE_MAX_HISTORY_DAYS);

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
  metric: HomeBreakdownMetric,
): { chartData: UsageChartDatum[]; series: UsageChartSeries[] } {
  const metricTotals = new Map<string, number>();
  for (const adapterId of adapters) {
    const total = days.reduce(
      (sum, day) =>
        sum +
        day.entries
          .filter((entry) => entry.adapterId === adapterId)
          .reduce(
            (entrySum, entry) =>
              entrySum + usageEntryMetricValue(entry, metric),
            0,
          ),
      0,
    );
    metricTotals.set(adapterId, total);
  }
  const orderedAdapters = [...adapters].sort(
    (left, right) =>
      (metricTotals.get(right) ?? 0) - (metricTotals.get(left) ?? 0) ||
      left.localeCompare(right),
  );

  const series = orderedAdapters.map((adapterId, index) => ({
    adapterId,
    color: usageColorHex(index),
    key: `adapter_${index}`,
  }));

  const chartData = days.map((day) => {
    const datum: UsageChartDatum = {
      day: day.day,
      label: formatUsageDisplayDay(day),
      totalCost: day.totalCost,
      totalSessions: day.totalSessions,
      totalTokens: day.totalTokens,
    };

    for (const [index, adapterId] of orderedAdapters.entries()) {
      datum[`adapter_${index}`] = day.entries
        .filter((entry) => entry.adapterId === adapterId)
        .reduce(
          (sum, entry) => sum + usageEntryMetricValue(entry, metric),
          0,
        );
    }

    return datum;
  });

  return { chartData, series };
}

function usageEntryMetricValue(
  entry: { cost: number; sessions: number; tokens: number },
  metric: HomeBreakdownMetric,
): number {
  if (metric === "conversations") {
    return entry.sessions;
  }
  if (metric === "cost") {
    return entry.cost;
  }
  return entry.tokens;
}

function usageMetricUsageLabel(metric: HomeBreakdownMetric): string {
  if (metric === "conversations") {
    return "conversation";
  }
  if (metric === "cost") {
    return "cost";
  }
  return "token";
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

function formatUsageWeekRange(weekStart: string, weekEnd: string): string {
  const startDate = new Date(`${weekStart}T00:00:00`);
  const endDate = new Date(`${weekEnd}T00:00:00`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return formatChartDay(weekStart);
  }

  const sameMonth = startDate.getMonth() === endDate.getMonth();
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const startLabel = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: sameMonth ? undefined : "short",
    year: sameYear ? undefined : "numeric",
  }).format(endDate);

  return `${startLabel} - ${endLabel}`;
}
