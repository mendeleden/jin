import type { Conversation, Message } from "../src/contracts/conversations";
import type {
  DesktopCompatibilityStatus,
  DesktopConversationDetailView,
  DesktopConversationListRequest,
  DesktopConversationListView,
  DesktopControlAction,
  DesktopControlStatus,
  DesktopHomeData,
  DesktopHomeSnapshot,
  DesktopTraceView,
  DesktopTreeView,
} from "../src/contracts/desktop";

export type DesktopNavigationView = "home" | "conversations" | "settings";
export type DesktopConversationSubview = "timeline" | "trace" | "tree";
type DesktopHomePanel = "harness" | "models" | "usage";

export interface RendererState {
  activeView: DesktopNavigationView;
  selectedSubview: DesktopConversationSubview;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  collapsedHomePanels: Record<DesktopHomePanel, boolean>;
  loading: boolean;
  refreshing: boolean;
  busyAction: DesktopControlAction | null;
  message: string | null;
  snapshot: DesktopHomeSnapshot | null;
  libraryRequest: DesktopConversationListRequest;
  library: DesktopConversationListView | null;
  libraryLoading: boolean;
  libraryError: string | null;
  selectedConversationId: string | null;
  selectedConversationLoading: boolean;
  selectedConversationError: string | null;
  detail: DesktopConversationDetailView | null;
  trace: DesktopTraceView | null;
  tree: DesktopTreeView | null;
}

const DEFAULT_CONVERSATION_LIMIT = 48;
const TIME_FILTERS: Array<{ label: string; value: string }> = [
  { label: "All time", value: "" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
];
const USAGE_COLORS = [
  "#89d4a1",
  "#89b4ff",
  "#f0c46d",
  "#ff8f84",
  "#a8d8ea",
  "#d6b3ff",
];

const state: RendererState = {
  activeView: "conversations",
  selectedSubview: "timeline",
  sidebarCollapsed: false,
  inspectorCollapsed: false,
  collapsedHomePanels: {
    harness: false,
    models: false,
    usage: false,
  },
  loading: true,
  refreshing: false,
  busyAction: null,
  message: null,
  snapshot: null,
  libraryRequest: {
    limit: DEFAULT_CONVERSATION_LIMIT,
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
};

let root: HTMLElement | null = null;
let shellRequestToken = 0;
let libraryRequestToken = 0;
let detailRequestToken = 0;

if (typeof document !== "undefined") {
  const appRoot = document.querySelector<HTMLElement>("#app");
  if (!appRoot) {
    throw new Error("Desktop renderer root container was not found.");
  }

  root = appRoot;
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action) {
      void runControlAction(action as DesktopControlAction);
      return;
    }

    const toggle = target.closest<HTMLElement>("[data-toggle]")?.dataset.toggle;
    if (toggle === "sidebar") {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      render();
      return;
    }

    if (toggle === "inspector") {
      state.inspectorCollapsed = !state.inspectorCollapsed;
      render();
      return;
    }

    const homePanel =
      target.closest<HTMLElement>("[data-home-panel]")?.dataset.homePanel ?? null;
    if (isDesktopHomePanel(homePanel)) {
      state.collapsedHomePanels = {
        ...state.collapsedHomePanels,
        [homePanel]: !state.collapsedHomePanels[homePanel],
      };
      render();
      return;
    }

    const refresh = target.closest<HTMLElement>("[data-refresh]")?.dataset.refresh;
    if (refresh === "shell") {
      void refreshShell({ preserveSelection: true });
      return;
    }

    const navigation =
      target.closest<HTMLElement>("[data-nav]")?.dataset.nav ?? null;
    if (
      navigation === "home" ||
      navigation === "conversations" ||
      navigation === "settings"
    ) {
      void switchView(navigation);
      return;
    }

    const subview =
      target.closest<HTMLElement>("[data-subview]")?.dataset.subview ?? null;
    if (subview === "timeline" || subview === "trace" || subview === "tree") {
      state.selectedSubview = subview;
      render();
      return;
    }

    const conversationId =
      target
        .closest<HTMLElement>("[data-conversation-id]")
        ?.dataset.conversationId ?? null;
    if (conversationId) {
      void openConversation(conversationId);
    }
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const filter = target.dataset.filter;
    if (filter === "adapter") {
      state.libraryRequest = {
        ...state.libraryRequest,
        adapterId: normalizeFilterValue(target.value),
      };
      void refreshConversationLibrary({ preserveSelection: false });
      return;
    }

    if (filter === "since") {
      state.libraryRequest = {
        ...state.libraryRequest,
        since: normalizeFilterValue(target.value),
      };
      void refreshConversationLibrary({ preserveSelection: false });
    }
  });

  void refreshShell({ preserveSelection: true });
}

async function refreshShell(options: {
  preserveSelection: boolean;
  preserveMessage?: boolean;
}): Promise<void> {
  const requestToken = ++shellRequestToken;
  const initialLoad = state.snapshot === null;
  state.loading = initialLoad;
  state.refreshing = !initialLoad;
  if (!options.preserveMessage) {
    state.message = null;
  }
  render();

  try {
    const snapshot = await window.jinDesktop.getHomeSnapshot();
    if (requestToken !== shellRequestToken) {
      return;
    }

    state.snapshot = snapshot;

    if (isRuntimeQueryable(snapshot.status.runtime.state)) {
      if (state.activeView === "conversations" || state.library !== null) {
        await refreshConversationLibrary({
          preserveSelection: options.preserveSelection,
        });
      }
    } else {
      clearConversationWorkspace();
    }
  } catch (error) {
    if (requestToken !== shellRequestToken) {
      return;
    }

    state.snapshot = null;
    clearConversationWorkspace();
    if (!options.preserveMessage) {
      state.message = formatError(error);
    }
  } finally {
    if (requestToken === shellRequestToken) {
      state.loading = false;
      state.refreshing = false;
      render();
    }
  }
}

async function switchView(view: DesktopNavigationView): Promise<void> {
  state.activeView = view;
  render();

  if (
    view === "conversations" &&
    state.snapshot &&
    isRuntimeQueryable(state.snapshot.status.runtime.state) &&
    state.library === null
  ) {
    await refreshConversationLibrary({ preserveSelection: true });
  }
}

async function refreshConversationLibrary(options: {
  preserveSelection: boolean;
}): Promise<void> {
  if (!state.snapshot || !isRuntimeQueryable(state.snapshot.status.runtime.state)) {
    return;
  }

  const requestToken = ++libraryRequestToken;
  state.libraryLoading = true;
  state.libraryError = null;
  render();

  try {
    const library = await window.jinDesktop.listConversations(
      state.libraryRequest,
    );
    if (requestToken !== libraryRequestToken) {
      return;
    }

    state.library = library;
    state.libraryRequest = {
      adapterId: library.filters.adapterId ?? undefined,
      since: library.filters.since ?? undefined,
      limit: library.filters.limit,
    };
    state.libraryError = null;

    const nextConversationId = pickConversationId(
      library.conversations,
      options.preserveSelection ? state.selectedConversationId : null,
    );

    if (!nextConversationId) {
      clearSelectedConversation();
      return;
    }

    const shouldLoadDetail =
      nextConversationId !== state.selectedConversationId ||
      state.detail?.conversation.id !== nextConversationId ||
      state.trace?.selectedConversationId !== nextConversationId ||
      state.tree?.selectedConversationId !== nextConversationId;

    state.selectedConversationId = nextConversationId;

    if (shouldLoadDetail) {
      await loadConversationWorkspace(nextConversationId);
    }
  } catch (error) {
    if (requestToken !== libraryRequestToken) {
      return;
    }

    state.libraryError = formatError(error);
    clearSelectedConversation();
  } finally {
    if (requestToken === libraryRequestToken) {
      state.libraryLoading = false;
      render();
    }
  }
}

async function openConversation(conversationId: string): Promise<void> {
  state.activeView = "conversations";
  state.selectedConversationId = conversationId;
  render();
  await loadConversationWorkspace(conversationId);
}

async function loadConversationWorkspace(conversationId: string): Promise<void> {
  const requestToken = ++detailRequestToken;
  state.selectedConversationId = conversationId;
  state.selectedConversationLoading = true;
  state.selectedConversationError = null;
  render();

  try {
    const [detail, trace, tree] = await Promise.all([
      window.jinDesktop.getConversationDetail(conversationId),
      window.jinDesktop.getTraceView(conversationId),
      window.jinDesktop.getTreeView(conversationId),
    ]);

    if (requestToken !== detailRequestToken) {
      return;
    }

    state.detail = detail;
    state.trace = trace;
    state.tree = tree;
    state.selectedConversationError = null;
  } catch (error) {
    if (requestToken !== detailRequestToken) {
      return;
    }

    clearSelectedConversation(false);
    state.selectedConversationId = conversationId;
    state.selectedConversationError = formatError(error);
  } finally {
    if (requestToken === detailRequestToken) {
      state.selectedConversationLoading = false;
      render();
    }
  }
}

async function runControlAction(action: DesktopControlAction): Promise<void> {
  state.busyAction = action;
  state.message = null;
  render();

  try {
    const result = await window.jinDesktop.runControlAction(action);
    state.message = result.ok
      ? `${capitalize(action)} requested.`
      : result.stderr || result.stdout || `Unable to ${action} Jin.`;
    state.snapshot = {
      status: result.status,
      compatibility: null,
      data: null,
      transportError: null,
    };
    if (!isRuntimeQueryable(result.status.runtime.state)) {
      clearConversationWorkspace();
    }
    await refreshShell({ preserveSelection: true, preserveMessage: true });
  } catch (error) {
    state.message = formatError(error);
    render();
  } finally {
    state.busyAction = null;
    render();
  }
}

function clearConversationWorkspace(): void {
  state.library = null;
  state.libraryError = null;
  state.libraryLoading = false;
  clearSelectedConversation();
}

function clearSelectedConversation(clearId = true): void {
  if (clearId) {
    state.selectedConversationId = null;
  }
  state.selectedConversationLoading = false;
  state.selectedConversationError = null;
  state.detail = null;
  state.trace = null;
  state.tree = null;
}

function render(): void {
  if (!root) {
    return;
  }

  root.innerHTML = renderApp(state);
}

export function renderApp(currentState: RendererState): string {
  if (currentState.loading && !currentState.snapshot) {
    return renderBootShell(currentState);
  }

  if (!currentState.snapshot) {
    return renderDisconnectedState(currentState);
  }

  return renderShell(currentState, renderActiveWorkspace(currentState));
}

function renderBootShell(currentState: RendererState): string {
  return `
    <div class="${renderShellClass(currentState)}">
      ${renderSidebar(currentState)}
      <main class="main-shell">
        ${renderTopbar(
          currentState,
          "Booting Desktop",
          "Restoring the typed daemon-backed shell",
        )}
        <section class="state-panel">
          <span class="eyebrow">Transport</span>
          <h2>Loading the desktop workbench.</h2>
          <p>The renderer is reconnecting through the preload bridge before loading the conversation library.</p>
        </section>
      </main>
    </div>
  `;
}

function renderDisconnectedState(currentState: RendererState): string {
  return `
    <div class="${renderShellClass(currentState)}">
      ${renderSidebar(currentState)}
      <main class="main-shell">
        ${renderTopbar(
          currentState,
          "Desktop unavailable",
          "Renderer bridge did not return a snapshot",
        )}
        ${renderNotices(currentState)}
        <section class="state-panel">
          <span class="eyebrow">Bridge</span>
          <h2>Desktop could not reach its typed preload bridge.</h2>
          <p>${escapeHtml(
            currentState.message ?? "Refresh after the Electron main process is available.",
          )}</p>
          <div class="action-row">
            <button class="toolbar-button primary" data-refresh="shell">Retry</button>
          </div>
        </section>
      </main>
    </div>
  `;
}

function renderShell(currentState: RendererState, workspace: string): string {
  const title =
    currentState.activeView === "home"
      ? "Home"
      : currentState.activeView === "settings"
        ? "Settings"
        : "Conversations";
  const subtitle =
    currentState.activeView === "home"
      ? renderHomeSubtitle(currentState)
      : currentState.activeView === "settings"
        ? renderSettingsSubtitle(currentState)
      : renderConversationSubtitle(currentState);

  return `
    <div class="${renderShellClass(currentState)}">
      ${renderSidebar(currentState)}
      <main class="main-shell">
        ${renderTopbar(currentState, title, subtitle)}
        ${renderNotices(currentState)}
        ${workspace}
      </main>
    </div>
  `;
}

function renderShellClass(currentState: RendererState): string {
  return `shell ${currentState.sidebarCollapsed ? "sidebar-collapsed" : ""}`;
}

function renderActiveWorkspace(currentState: RendererState): string {
  const compatibility = getIncompatibleCompatibility(currentState);
  if (compatibility) {
    return renderCompatibilityState(currentState, compatibility);
  }

  if (currentState.activeView === "home") {
    return renderHomeWorkspace(currentState);
  }

  if (currentState.activeView === "settings") {
    return renderSettingsWorkspace(currentState);
  }

  return renderConversationWorkspace(currentState);
}

function renderSidebar(currentState: RendererState): string {
  const runtimeState = currentState.snapshot?.status.runtime.state ?? "offline";
  const overview = currentState.snapshot?.data?.overview;
  const collapsed = currentState.sidebarCollapsed;

  return `
    <aside class="sidebar ${collapsed ? "collapsed" : ""}">
      <div class="sidebar-top">
        <div class="brand-lockup">
          <div class="brand-copy">
            <div class="brand-title">Jin Desktop</div>
            <div class="brand-subtitle">Conversation Workbench</div>
          </div>
        </div>
        <button
          type="button"
          class="sidebar-toggle"
          data-toggle="sidebar"
          aria-label="${collapsed ? "Expand sidebar" : "Collapse sidebar"}"
          title="${collapsed ? "Expand sidebar" : "Collapse sidebar"}"
        >
          <span aria-hidden="true">${collapsed ? "&gt;" : "&lt;"}</span>
        </button>
      </div>

      <nav class="nav-list" aria-label="Primary">
        ${renderNavButton("home", "Home", currentState.activeView)}
        ${renderNavButton("conversations", "Conversations", currentState.activeView)}
        ${renderNavButton("settings", "Settings", currentState.activeView)}
      </nav>

      <section class="sidebar-panel sidebar-panel-muted">
        <div class="sidebar-panel-title">Next surfaces</div>
        <ul class="sidebar-list">
          <li>Search</li>
          <li>Projects</li>
          <li>Health</li>
        </ul>
      </section>

      <div class="sidebar-spacer"></div>

      <section class="sidebar-panel sidebar-runtime">
        <div class="sidebar-panel-title">Runtime</div>
        <div class="sidebar-status">
          <span class="status-badge ${escapeHtml(runtimeState)}">${escapeHtml(runtimeState)}</span>
          ${
            currentState.snapshot
              ? `<span class="sidebar-status-copy">${escapeHtml(renderRuntimeHeading(currentState.snapshot.status))}</span>`
              : `<span class="sidebar-status-copy">Waiting for preload bridge</span>`
          }
        </div>
        <div class="sidebar-metrics">
          ${
            overview
              ? [
                  renderSidebarMetric("Conversations", overview.conversations),
                  renderSidebarMetric("Messages", overview.messages),
                  renderSidebarMetric("Tool calls", overview.toolCalls),
                  renderSidebarMetric("Tokens", overview.tokens, true),
                  renderSidebarMetric("Cost", formatCost(overview.cost)),
                  renderSidebarMetric("Traces", overview.traces),
                ].join("")
              : [
                  renderSidebarMetric("Conversations", "-"),
                  renderSidebarMetric("Messages", "-"),
                  renderSidebarMetric("Tool calls", "-"),
                  renderSidebarMetric("Tokens", "-"),
                  renderSidebarMetric("Cost", "-"),
                  renderSidebarMetric("Traces", "-"),
                ].join("")
          }
        </div>
      </section>
    </aside>
  `;
}

function renderNavButton(
  view: DesktopNavigationView,
  label: string,
  activeView: DesktopNavigationView,
): string {
  return `
    <button
      type="button"
      class="nav-item ${activeView === view ? "active" : ""}"
      data-nav="${view}"
      data-short="${escapeHtml(label.slice(0, 1))}"
      title="${escapeHtml(label)}"
    >
      <span class="nav-label">${escapeHtml(label)}</span>
    </button>
  `;
}

function renderTopbar(
  currentState: RendererState,
  title: string,
  subtitle: string,
): string {
  const status = currentState.snapshot?.status ?? null;
  const runtimeState = status?.runtime.state ?? "offline";

  return `
    <header class="topbar">
      <div class="topbar-copy">
        <div class="eyebrow">Native shell</div>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <div class="topbar-actions">
        <span class="status-badge ${escapeHtml(runtimeState)}">${escapeHtml(runtimeState)}</span>
        ${
          status
            ? renderRuntimeActions(currentState, status.runtime.state)
            : ""
        }
        <button class="toolbar-button" data-refresh="shell">
          ${currentState.refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </header>
  `;
}

function renderRuntimeActions(
  currentState: RendererState,
  runtimeState: DesktopControlStatus["runtime"]["state"],
): string {
  if (runtimeState === "stopped") {
    return `
      <button class="toolbar-button primary" data-action="start" ${isBusy(currentState, "start")}>
        ${currentState.busyAction === "start" ? "Starting..." : "Start Jin"}
      </button>
    `;
  }

  if (runtimeState === "starting" || runtimeState === "stopping") {
    return "";
  }

  return `
    <button class="toolbar-button" data-action="restart" ${isBusy(currentState, "restart")}>
      ${currentState.busyAction === "restart" ? "Restarting..." : "Restart"}
    </button>
    <button class="toolbar-button" data-action="stop" ${isBusy(currentState, "stop")}>
      ${currentState.busyAction === "stop" ? "Stopping..." : "Stop"}
    </button>
  `;
}

function renderNotices(currentState: RendererState): string {
  const notices: string[] = [];
  const incompatible = Boolean(getIncompatibleCompatibility(currentState));

  if (currentState.message) {
    notices.push(`<div class="notice">${escapeHtml(currentState.message)}</div>`);
  }

  if (currentState.snapshot?.transportError && !incompatible) {
    notices.push(
      `<div class="notice warning">${escapeHtml(currentState.snapshot.transportError)}</div>`,
    );
  }

  if (currentState.activeView === "conversations" && currentState.libraryError) {
    notices.push(
      `<div class="notice warning">${escapeHtml(currentState.libraryError)}</div>`,
    );
  }

  if (
    currentState.activeView === "conversations" &&
    currentState.selectedConversationError
  ) {
    notices.push(
      `<div class="notice warning">${escapeHtml(currentState.selectedConversationError)}</div>`,
    );
  }

  if (notices.length === 0) {
    return "";
  }

  return `<div class="notice-stack">${notices.join("")}</div>`;
}

function renderHomeSubtitle(currentState: RendererState): string {
  const snapshot = currentState.snapshot;
  if (!snapshot) {
    return "Desktop is waiting for the daemon snapshot.";
  }

  if (snapshot.status.runtime.state === "stopped") {
    return "Start Jin to browse local conversations and trace structure.";
  }

  const compatibility = getIncompatibleCompatibility(currentState);
  if (compatibility) {
    return compatibility.reason === "desktop_too_old"
      ? "This Desktop build needs an update before it can read the daemon API."
      : "This Desktop build needs a newer jin CLI/daemon before it can read data.";
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return snapshot.status.runtime.state === "starting"
      ? "The daemon is starting. Home data will appear when runtime settles."
      : "The daemon is stopping. Home data will pause until shutdown completes.";
  }

  if (!snapshot.data) {
    return "Runtime is active, but the overview query is currently unavailable.";
  }

  return "";
}

function renderConversationSubtitle(currentState: RendererState): string {
  const snapshot = currentState.snapshot;
  if (!snapshot) {
    return "Desktop is waiting for the daemon snapshot.";
  }

  if (snapshot.status.runtime.state === "stopped") {
    return "Start Jin to open the local conversation library.";
  }

  const compatibility = getIncompatibleCompatibility(currentState);
  if (compatibility) {
    return "Compatibility check failed before loading the conversation library.";
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return snapshot.status.runtime.state === "starting"
      ? "Runtime startup is in progress."
      : "Runtime shutdown is in progress.";
  }

  const library = currentState.library;
  if (!library) {
    return "Loading the daemon-backed conversation library.";
  }

  const selectedTitle =
    currentState.detail?.conversation.name ??
    library.conversations.find(
      (conversation) => conversation.id === currentState.selectedConversationId,
    )?.name ??
    "No conversation selected";

  return `${formatNumber(library.conversations.length)} rows loaded. ${selectedTitle}`;
}

function renderSettingsSubtitle(currentState: RendererState): string {
  const snapshot = currentState.snapshot;
  if (!snapshot) {
    return "Desktop is waiting for runtime paths.";
  }

  return renderRuntimeHeading(snapshot.status);
}

function renderHomeWorkspace(currentState: RendererState): string {
  const snapshot = currentState.snapshot;
  if (!snapshot) {
    return "";
  }

  if (snapshot.status.runtime.state === "stopped") {
    return renderLifecycleState(
      currentState,
      "Stopped",
      "Jin is ready, but the daemon is not running.",
      "Desktop remains a client of the daemon boundary and waits for the single runtime owner to come online.",
    );
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return renderLifecycleState(
      currentState,
      capitalize(snapshot.status.runtime.state),
      snapshot.status.runtime.state === "starting"
        ? "Jin is starting up."
        : "Jin is shutting down.",
      snapshot.status.runtime.state === "starting"
        ? "Overview data will render once the daemon reaches a steady runtime state."
        : "Desktop is holding the shell while shutdown completes.",
    );
  }

  if (!snapshot.data) {
    return renderLifecycleState(
      currentState,
      "Transport",
      "Home data is temporarily unavailable.",
      snapshot.transportError ??
        "Desktop could not load the current overview from the daemon.",
    );
  }

  const { data } = snapshot;

  return `
    <section class="workspace-home">
      <section class="summary-strip">
        ${renderSummaryMetric("Conversations", formatMetricNumber(data.overview.conversations))}
        ${renderSummaryMetric("Messages", formatMetricNumber(data.overview.messages))}
        ${renderSummaryMetric("Tool calls", formatMetricNumber(data.overview.toolCalls))}
        ${renderSummaryMetric("Tokens", formatMetricNumber(data.overview.tokens))}
        ${renderSummaryMetric("Cost", { display: formatCost(data.overview.cost) })}
        ${renderSummaryMetric("Traces", formatMetricNumber(data.overview.traces))}
      </section>

      ${renderHomeStatsPanel(
        "harness",
        "Stats",
        "Usage by harness",
        currentState.collapsedHomePanels.harness,
        renderHarnessStatsRows(data.topAdapters),
      )}

      ${renderHomeStatsPanel(
        "models",
        "Stats",
        "Usage by model",
        currentState.collapsedHomePanels.models,
        renderModelStatsRows(data.topModels ?? []),
      )}

      ${renderHomeStatsPanel(
        "usage",
        "Tokens",
        "Daily usage by harness",
        currentState.collapsedHomePanels.usage,
        renderTokenUsageChart(data.tokenUsageByDay ?? []),
        "compact-panel-wide usage-panel",
      )}

      <section class="compact-panel compact-panel-span">
        <div class="panel-header">
          <div>
            <span class="eyebrow">Recent</span>
            <h2>Latest conversations</h2>
          </div>
          <button class="toolbar-button subtle" data-nav="conversations">Open library</button>
        </div>
        <div class="mini-list">
          ${
            data.recentConversations.length > 0
              ? data.recentConversations
                  .map((conversation) => renderRecentConversationRow(conversation))
                  .join("")
              : `<div class="empty-row">No indexed conversations yet.</div>`
          }
        </div>
      </section>

      <section class="compact-panel">
        <div class="panel-header">
          <h2>Projects</h2>
        </div>
        <div class="mini-list">
          ${
            data.topProjects.length > 0
              ? data.topProjects
                  .map(
                    (project) => `
                      <div class="key-value-row">
                        <span>${escapeHtml(project.name)}</span>
                        <strong>${formatNumber(project.conversationCount)} conv</strong>
                      </div>
                    `,
                  )
                  .join("")
              : `<div class="empty-row">No linked projects yet.</div>`
          }
        </div>
      </section>
    </section>
  `;
}

function renderCompatibilityState(
  currentState: RendererState,
  compatibility: DesktopCompatibilityStatus,
): string {
  const title =
    compatibility.reason === "desktop_too_old"
      ? "Desktop update required."
      : "Jin CLI update required.";
  const command =
    compatibility.reason === "desktop_too_old"
      ? compatibility.updateCommand
      : compatibility.cliUpdateCommand;

  return `
    <section class="state-panel">
      <span class="eyebrow">Compatibility</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(compatibility.message)}</p>
      <div class="runtime-grid">
        ${renderRuntimeField("Jin version", compatibility.jinVersion)}
        ${renderRuntimeField("Desktop API", String(compatibility.clientDesktopApiVersion))}
        ${renderRuntimeField("Daemon API", String(compatibility.desktopApiVersion))}
        ${renderRuntimeField("Minimum Desktop API", String(compatibility.minimumDesktopApiVersion))}
      </div>
      <div class="action-row">
        <code>${escapeHtml(command)}</code>
        <button class="toolbar-button" data-refresh="shell">Retry</button>
      </div>
    </section>
  `;
}

function renderSettingsWorkspace(currentState: RendererState): string {
  const snapshot = currentState.snapshot;
  if (!snapshot) {
    return "";
  }

  const { status } = snapshot;

  return `
    <section class="workspace-settings">
      <section class="compact-panel compact-panel-span">
        <div class="panel-header">
          <div>
            <span class="eyebrow">Runtime</span>
            <h2>Daemon status</h2>
          </div>
          <span class="status-badge ${escapeHtml(status.runtime.state)}">${escapeHtml(status.runtime.state)}</span>
        </div>
        <div class="runtime-grid">
          ${renderRuntimeField("Runtime owner", status.runtime.owner?.mode ?? "none")}
          ${renderRuntimeField("Health", status.health.status)}
          ${renderRuntimeField("Ingest", status.health.ingest)}
          ${renderRuntimeField("Push", status.health.push)}
        </div>
      </section>

      <section class="compact-panel compact-panel-span">
        <div class="panel-header">
          <div>
            <span class="eyebrow">Paths</span>
            <h2>Local files</h2>
          </div>
        </div>
        <div class="runtime-grid runtime-grid-paths">
          ${renderRuntimeField("Config", status.paths.config)}
          ${renderRuntimeField("Store", status.paths.store)}
          ${renderRuntimeField("Socket", status.paths.socket)}
          ${renderRuntimeField("Log", status.paths.log)}
        </div>
      </section>
    </section>
  `;
}

function renderConversationWorkspace(currentState: RendererState): string {
  const snapshot = currentState.snapshot;
  if (!snapshot) {
    return "";
  }

  if (snapshot.status.runtime.state === "stopped") {
    return renderLifecycleState(
      currentState,
      "Conversations",
      "Conversation browsing is paused while Jin is stopped.",
      "Start the daemon to load the library, selected conversation timeline, trace, and tree views.",
    );
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return renderLifecycleState(
      currentState,
      "Conversations",
      snapshot.status.runtime.state === "starting"
        ? "Jin is starting up."
        : "Jin is shutting down.",
      snapshot.status.runtime.state === "starting"
        ? "The library will populate once the daemon is queryable."
        : "The library is paused until shutdown completes.",
    );
  }

  return `
    <section class="workspace-conversations ${currentState.inspectorCollapsed ? "inspector-collapsed" : ""}">
      <aside class="library-panel">
        <div class="panel-header panel-header-tight">
          <div>
            <span class="eyebrow">Library</span>
            <h2>Conversation index</h2>
          </div>
          <span class="panel-meta">
            ${
              currentState.library
                ? `${formatNumber(currentState.library.conversations.length)} shown`
                : currentState.libraryLoading
                  ? "Loading..."
                  : "Waiting"
            }
          </span>
        </div>
        ${renderConversationFilters(currentState)}
        ${renderRelationshipMix(currentState.library)}
        ${renderConversationLibrary(currentState)}
      </aside>

      <section class="detail-panel">
        ${renderConversationDetailSurface(currentState)}
      </section>

      ${
        currentState.inspectorCollapsed
          ? renderInspectorRail()
          : `
            <aside class="inspector-panel">
              ${renderConversationInspector(currentState)}
            </aside>
          `
      }
    </section>
  `;
}

function renderLifecycleState(
  currentState: RendererState,
  label: string,
  title: string,
  description: string,
): string {
  const snapshot = currentState.snapshot;

  return `
    <section class="state-panel">
      <span class="eyebrow">${escapeHtml(label)}</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description)}</p>
      ${
        snapshot
          ? `
            <div class="runtime-grid">
              ${renderRuntimeField("Socket", snapshot.status.paths.socket)}
              ${renderRuntimeField("Store", snapshot.status.paths.store)}
              ${renderRuntimeField(
                "Runtime owner",
                snapshot.status.runtime.owner?.mode ?? "none",
              )}
            </div>
          `
          : ""
      }
      <div class="action-row">
        ${
          snapshot?.status.runtime.state === "stopped"
            ? `<button class="toolbar-button primary" data-action="start" ${isBusy(currentState, "start")}>
                ${currentState.busyAction === "start" ? "Starting..." : "Start Jin"}
              </button>`
            : ""
        }
        <button class="toolbar-button" data-refresh="shell">Refresh</button>
      </div>
    </section>
  `;
}

interface FormattedMetric {
  display: string;
  exact?: string;
}

function renderSummaryMetric(label: string, value: FormattedMetric): string {
  const exact = value.exact && value.exact !== value.display ? value.exact : "";

  return `
    <article class="summary-metric" ${exact ? `title="${escapeHtml(`${label}: ${exact}`)}"` : ""}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value.display)}</strong>
      ${exact ? `<small>${escapeHtml(exact)}</small>` : ""}
    </article>
  `;
}

function renderHomeStatsPanel(
  id: DesktopHomePanel,
  eyebrow: string,
  title: string,
  collapsed: boolean,
  body: string,
  extraClass = "",
): string {
  return `
    <section class="compact-panel stats-panel ${extraClass} ${collapsed ? "collapsed" : ""}">
      <button
        type="button"
        class="stats-panel-summary"
        data-home-panel="${id}"
        aria-expanded="${!collapsed}"
      >
        <span>
          <span class="eyebrow">${escapeHtml(eyebrow)}</span>
          <strong>${escapeHtml(title)}</strong>
        </span>
        <span class="stats-panel-toggle">${collapsed ? "+" : "-"}</span>
      </button>
      ${collapsed ? "" : `<div class="stats-panel-body">${body}</div>`}
    </section>
  `;
}

function renderHarnessStatsRows(
  adapters: DesktopHomeData["topAdapters"],
): string {
  if (adapters.length === 0) {
    return `<div class="empty-row">No harness usage recorded yet.</div>`;
  }

  return `
    <div class="stats-row-list">
      ${adapters
        .map(
          (adapter) => `
            <article class="stats-row">
              <div class="stats-row-heading">
                <strong>${escapeHtml(adapter.adapterId)}</strong>
                <span>${escapeHtml(formatCost(adapter.cost))}</span>
              </div>
              <div class="stats-row-metrics">
                ${renderStatCell("Sessions", formatMetricNumber(adapter.conversations))}
                ${renderStatCell("Messages", formatMetricNumber(adapter.messages))}
                ${renderStatCell("Billed", formatMetricNumber(adapter.tokens))}
                ${renderStatCell("Display", formatMetricNumber(adapter.displayTokens))}
                ${renderStatCell("Cache", formatMetricNumber(adapter.cacheTokens))}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderModelStatsRows(models: DesktopHomeData["topModels"]): string {
  if (models.length === 0) {
    return `<div class="empty-row">No model usage recorded yet.</div>`;
  }

  return `
    <div class="stats-row-list">
      ${models
        .map((model) => {
          const totalTokens = model.inputTokens + model.outputTokens;
          return `
            <article class="stats-row">
              <div class="stats-row-heading">
                <strong title="${escapeHtml(model.model)}">${escapeHtml(model.model)}</strong>
                <span>${escapeHtml(formatMetricNumber(totalTokens).display)} total</span>
              </div>
              <div class="stats-row-metrics">
                ${renderStatCell("Messages", formatMetricNumber(model.messages))}
                ${renderStatCell("Input", formatMetricNumber(model.inputTokens))}
                ${renderStatCell("Output", formatMetricNumber(model.outputTokens))}
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderStatCell(label: string, value: FormattedMetric): string {
  const exact = value.exact && value.exact !== value.display ? value.exact : "";
  return `
    <span class="stats-cell" ${exact ? `title="${escapeHtml(`${label}: ${exact}`)}"` : ""}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value.display)}</strong>
    </span>
  `;
}

function renderTokenUsageChart(
  entries: DesktopHomeData["tokenUsageByDay"],
): string {
  if (entries.length === 0) {
    return `<div class="empty-row">No token usage timeline is available yet.</div>`;
  }

  const dayMap = new Map<
    string,
    { day: string; totalTokens: number; entries: Array<{ adapterId: string; tokens: number }> }
  >();
  const adapterTotals = new Map<string, number>();

  for (const entry of entries) {
    const adapterId = entry.adapterId || "unknown";
    const day = dayMap.get(entry.day) ?? {
      day: entry.day,
      totalTokens: 0,
      entries: [],
    };
    day.totalTokens += entry.tokens;
    day.entries.push({ adapterId, tokens: entry.tokens });
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

  return `
    <div class="usage-chart">
      <div class="usage-legend">
        ${adapters
          .map(
            (adapterId) => `
              <span>
                <i style="--usage-color: ${usageColor(adapterIndex.get(adapterId) ?? 0)};"></i>
                ${escapeHtml(adapterId)}
              </span>
            `,
          )
          .join("")}
      </div>
      <div class="usage-rows">
        ${days
          .map((day) => {
            const sortedEntries = [...day.entries].sort((left, right) => {
              return (
                (adapterIndex.get(left.adapterId) ?? 0) -
                (adapterIndex.get(right.adapterId) ?? 0)
              );
            });

            return `
              <div class="usage-row">
                <span class="usage-day">${escapeHtml(formatChartDay(day.day))}</span>
                <div class="usage-bar-track" title="${escapeHtml(
                  `${day.day}: ${formatNumber(day.totalTokens)} tokens`,
                )}">
                  ${sortedEntries
                    .map((entry) => {
                      const width = Math.max(
                        0,
                        (entry.tokens / maxDailyTokens) * 100,
                      );
                      return `
                        <span
                          class="usage-bar-segment"
                          title="${escapeHtml(`${entry.adapterId}: ${formatNumber(entry.tokens)} tokens`)}"
                          style="width: ${width.toFixed(3)}%; --usage-color: ${usageColor(
                            adapterIndex.get(entry.adapterId) ?? 0,
                          )};"
                        ></span>
                      `;
                    })
                    .join("")}
                </div>
                <span class="usage-total">${escapeHtml(formatMetricNumber(day.totalTokens).display)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function usageColor(index: number): string {
  return USAGE_COLORS[index % USAGE_COLORS.length]!;
}

function renderSidebarMetric(
  label: string,
  value: number | string,
  preferCompact = true,
): string {
  const formatted =
    typeof value === "number"
      ? preferCompact
        ? formatMetricNumber(value)
        : { display: formatNumber(value) }
      : { display: value };
  const exact = formatted.exact && formatted.exact !== formatted.display ? formatted.exact : "";

  return `
    <div title="${escapeHtml(exact ? `${label}: ${exact}` : label)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatted.display)}</strong>
    </div>
  `;
}

function renderRuntimeField(label: string, value: string): string {
  return `
    <div class="runtime-field">
      <span>${escapeHtml(label)}</span>
      <strong class="mono">${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderRecentConversationRow(conversation: Conversation): string {
  return `
    <button
      type="button"
      class="mini-row"
      data-conversation-id="${escapeHtml(conversation.id)}"
    >
      <div>
        <div class="mini-row-title">${escapeHtml(conversation.name)}</div>
        <div class="mini-row-meta">
          <span>${escapeHtml(conversation.adapterId)}</span>
          <span>${escapeHtml(formatDate(conversation.endedAt || conversation.startedAt))}</span>
        </div>
      </div>
      <span class="relationship-chip ${escapeHtml(conversation.relationship)}">${escapeHtml(conversation.relationship)}</span>
    </button>
  `;
}

function renderConversationFilters(currentState: RendererState): string {
  const adapterOptions = currentState.library?.availableAdapters ?? [];
  const adapterValue = currentState.libraryRequest.adapterId ?? "";
  const sinceValue = currentState.libraryRequest.since ?? "";

  return `
    <div class="filter-bar">
      <label class="filter-field">
        <span>Adapter</span>
        <select class="select-field" data-filter="adapter">
          <option value="">All adapters</option>
          ${adapterOptions
            .map(
              (adapter) => `
                <option value="${escapeHtml(adapter)}" ${adapterValue === adapter ? "selected" : ""}>
                  ${escapeHtml(adapter)}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>
      <label class="filter-field">
        <span>Range</span>
        <select class="select-field" data-filter="since">
          ${TIME_FILTERS.map(
            (option) => `
              <option value="${escapeHtml(option.value)}" ${sinceValue === option.value ? "selected" : ""}>
                ${escapeHtml(option.label)}
              </option>
            `,
          ).join("")}
        </select>
      </label>
    </div>
  `;
}

function renderRelationshipMix(
  library: DesktopConversationListView | null,
): string {
  const relationships = library?.relationshipMix ?? [];
  if (relationships.length === 0) {
    return "";
  }

  return `
    <div class="relationship-strip">
      ${relationships
        .map(
          (entry) => `
            <span class="relationship-pill">
              <span>${escapeHtml(entry.relationship)}</span>
              <strong>${formatNumber(entry.conversations)}</strong>
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderConversationLibrary(currentState: RendererState): string {
  if (currentState.libraryLoading && !currentState.library) {
    return `
      <div class="list-placeholder">
        <div class="placeholder-line wide"></div>
        <div class="placeholder-line"></div>
        <div class="placeholder-line"></div>
        <div class="placeholder-line short"></div>
      </div>
    `;
  }

  if (currentState.libraryError && !currentState.library) {
    return `
      <div class="empty-state">
        <h3>Conversation library unavailable</h3>
        <p>${escapeHtml(currentState.libraryError)}</p>
        <button class="toolbar-button" data-refresh="shell">Retry</button>
      </div>
    `;
  }

  const conversations = currentState.library?.conversations ?? [];
  if (conversations.length === 0) {
    return `
      <div class="empty-state">
        <h3>No conversations match the current filters.</h3>
        <p>Desktop is connected, but the library is empty for this adapter/range combination.</p>
      </div>
    `;
  }

  return `
    <div class="conversation-list">
      ${conversations
        .map((conversation) =>
          renderConversationRow(
            conversation,
            conversation.id === currentState.selectedConversationId,
          ),
        )
        .join("")}
    </div>
  `;
}

function renderConversationRow(
  conversation: Conversation,
  selected: boolean,
): string {
  return `
    <button
      type="button"
      class="conversation-row ${selected ? "selected" : ""}"
      data-conversation-id="${escapeHtml(conversation.id)}"
    >
      <div class="conversation-row-top">
        <div class="conversation-row-title">${escapeHtml(conversation.name)}</div>
        <span class="relationship-chip ${escapeHtml(conversation.relationship)}">${escapeHtml(conversation.relationship)}</span>
      </div>
      <div class="conversation-row-meta">
        <span>${escapeHtml(conversation.adapterId)}</span>
        <span>${escapeHtml(conversation.model || "unknown model")}</span>
        <span>${escapeHtml(formatDate(conversation.endedAt || conversation.startedAt))}</span>
      </div>
      <div class="conversation-row-meta">
        <span>${formatNumber(conversation.messageCount)} msg</span>
        <span>${formatNumber(conversation.toolCount)} tools</span>
        <span>${formatMetricNumber(totalTokens(conversation)).display} tok</span>
      </div>
      <div class="conversation-row-foot">
        <span class="mono">${escapeHtml(shortId(conversation.id))}</span>
        <span class="truncate">${escapeHtml(conversation.gitRemote || conversation.cwd || "local / unlinked")}</span>
      </div>
    </button>
  `;
}

function renderConversationDetailSurface(currentState: RendererState): string {
  if (currentState.selectedConversationLoading && !currentState.detail) {
    return `
      <div class="detail-empty detail-loading">
        <h3>Loading selected conversation</h3>
        <p>Fetching detail, trace, and tree views through the typed daemon boundary.</p>
      </div>
    `;
  }

  if (currentState.selectedConversationError && !currentState.detail) {
    return `
      <div class="detail-empty">
        <h3>Conversation detail unavailable</h3>
        <p>${escapeHtml(currentState.selectedConversationError)}</p>
      </div>
    `;
  }

  if (!currentState.detail) {
    return `
      <div class="detail-empty">
        <h3>Select a conversation</h3>
        <p>The detail pane will show timeline, trace, and tree views for the selected conversation.</p>
      </div>
    `;
  }

  const conversation = currentState.detail.conversation;

  return `
    <div class="detail-surface">
      <div class="detail-header">
        <div>
          <div class="detail-kicker">
            <span class="relationship-chip ${escapeHtml(conversation.relationship)}">${escapeHtml(conversation.relationship)}</span>
            <span class="mono">${escapeHtml(shortId(conversation.id))}</span>
          </div>
          <h2>${escapeHtml(conversation.name)}</h2>
          <p>${escapeHtml(renderConversationHeaderSummary(currentState.detail))}</p>
        </div>
        <div class="subview-tabs" role="tablist" aria-label="Conversation views">
          ${renderSubviewTab("timeline", "Timeline", currentState.selectedSubview)}
          ${renderSubviewTab("trace", "Trace", currentState.selectedSubview)}
          ${renderSubviewTab("tree", "Tree", currentState.selectedSubview)}
        </div>
      </div>

      <div class="detail-summary">
        <span class="metric-chip">${formatNumber(conversation.messageCount)} messages</span>
        <span class="metric-chip">${formatNumber(conversation.toolCount)} tools</span>
        <span class="metric-chip" title="${escapeHtml(formatNumber(totalTokens(conversation)))} tokens">${formatMetricNumber(totalTokens(conversation)).display} tokens</span>
        <span class="metric-chip">${formatCost(conversation.estCost)}</span>
        <span class="metric-chip">Trace ${escapeHtml(shortId(currentState.detail.trace.traceId))}</span>
      </div>

      ${
        currentState.selectedConversationLoading
          ? `<div class="detail-refreshing">Refreshing selected conversation...</div>`
          : ""
      }

      <div class="detail-body">
        ${renderSelectedSubview(currentState)}
      </div>
    </div>
  `;
}

function renderSubviewTab(
  value: DesktopConversationSubview,
  label: string,
  selectedSubview: DesktopConversationSubview,
): string {
  return `
    <button
      type="button"
      class="subview-tab ${selectedSubview === value ? "active" : ""}"
      data-subview="${value}"
      role="tab"
      aria-selected="${selectedSubview === value}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderConversationHeaderSummary(
  detail: DesktopConversationDetailView,
): string {
  const parentSummary = detail.parent
    ? `Parent ${shortId(detail.parent.id)}`
    : "Root conversation";
  const childSummary =
    detail.children.length > 0
      ? `${formatNumber(detail.children.length)} child conversation${detail.children.length === 1 ? "" : "s"}`
      : "No child conversations";

  return `${parentSummary} · ${childSummary} · ${formatNumber(detail.trace.conversationCount)} conversations in trace`;
}

function renderSelectedSubview(currentState: RendererState): string {
  if (currentState.selectedSubview === "trace") {
    return renderTraceSubview(currentState);
  }

  if (currentState.selectedSubview === "tree") {
    return renderTreeSubview(currentState);
  }

  return renderTimelineSubview(currentState.detail!);
}

function renderTimelineSubview(detail: DesktopConversationDetailView): string {
  if (detail.messages.length === 0) {
    return `
      <div class="detail-empty">
        <h3>No messages recorded</h3>
        <p>This conversation exists in the trace graph but currently has no stored message timeline.</p>
      </div>
    `;
  }

  return `
    <div class="timeline-list">
      ${detail.messages.map((message) => renderMessageCard(message)).join("")}
    </div>
  `;
}

function renderMessageCard(message: Message): string {
  return `
    <article class="message-card">
      <div class="message-header">
        <div class="message-role ${escapeHtml(message.role)}">${escapeHtml(message.role)}</div>
        <div class="message-meta">
          <span>Turn ${message.turn}</span>
          <span>${escapeHtml(formatDate(message.timestamp))}</span>
          <span>${escapeHtml(message.model || "unknown model")}</span>
        </div>
      </div>
      <div class="message-content">${renderPreformattedText(message.content)}</div>
      ${message.thinkingContent ? renderThinkingBlock(message) : ""}
      ${
        message.toolUses.length > 0
          ? `
            <div class="tool-stack">
              ${message.toolUses.map((tool) => renderToolCall(tool.name, tool.input, tool.output, tool.isError)).join("")}
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderThinkingBlock(message: Message): string {
  return `
    <details class="trace-detail-block">
      <summary>Thinking ${message.thinkingTokens > 0 ? `(${formatNumber(message.thinkingTokens)} tok)` : ""}</summary>
      <div class="detail-block-body">${renderPreformattedText(message.thinkingContent)}</div>
    </details>
  `;
}

function renderToolCall(
  name: string,
  input: string,
  output: string,
  isError: boolean,
): string {
  return `
    <details class="trace-detail-block ${isError ? "error" : ""}">
      <summary>${escapeHtml(name)}${isError ? " · error" : ""}</summary>
      ${input ? `<div class="detail-block-label">Input</div><div class="detail-block-body">${renderPreformattedText(input)}</div>` : ""}
      ${output ? `<div class="detail-block-label">Output</div><div class="detail-block-body">${renderPreformattedText(output)}</div>` : ""}
    </details>
  `;
}

function renderTraceSubview(currentState: RendererState): string {
  const trace = currentState.trace;
  if (!trace || trace.conversations.length === 0) {
    return `
      <div class="detail-empty">
        <h3>No trace graph available</h3>
        <p>The selected conversation has no related trace conversations to display.</p>
      </div>
    `;
  }

  return `
    <div class="trace-list">
      ${trace.conversations
        .map((entry) => {
          const selected =
            entry.conversation.id === currentState.selectedConversationId;
          return `
            <button
              type="button"
              class="trace-row ${selected ? "selected" : ""}"
              data-conversation-id="${escapeHtml(entry.conversation.id)}"
            >
              <div class="trace-row-top">
                <div class="trace-row-title">${escapeHtml(entry.conversation.name)}</div>
                <span class="relationship-chip ${escapeHtml(entry.conversation.relationship)}">${escapeHtml(entry.conversation.relationship)}</span>
              </div>
              <div class="trace-row-meta">
                <span>${escapeHtml(entry.conversation.adapterId)}</span>
                <span>${formatNumber(entry.messages.length)} msg</span>
                <span>${formatNumber(entry.toolCalls.length)} tools</span>
                <span>${escapeHtml(formatDate(entry.conversation.startedAt))}</span>
              </div>
              <div class="trace-row-foot">
                <span class="mono">${escapeHtml(shortId(entry.conversation.id))}</span>
                <span>${escapeHtml(entry.conversation.model || "unknown model")}</span>
              </div>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTreeSubview(currentState: RendererState): string {
  const tree = currentState.tree?.tree ?? null;
  if (!tree) {
    return `
      <div class="detail-empty">
        <h3>No tree view available</h3>
        <p>The selected conversation trace does not currently resolve to a rooted tree.</p>
      </div>
    `;
  }

  return `
    <div class="tree-view">
      ${renderTreeNode(tree, currentState.selectedConversationId, 0)}
    </div>
  `;
}

function renderTreeNode(
  node: DesktopTreeView["tree"],
  selectedConversationId: string | null,
  depth: number,
): string {
  if (!node) {
    return "";
  }

  const selected = node.conversation.id === selectedConversationId;

  return `
    <div class="tree-node-wrap">
      <button
        type="button"
        class="tree-node ${selected ? "selected" : ""}"
        data-conversation-id="${escapeHtml(node.conversation.id)}"
        style="--tree-depth: ${depth};"
      >
        <div class="tree-node-main">
          <span class="tree-node-title">${escapeHtml(node.conversation.name)}</span>
          <span class="relationship-chip ${escapeHtml(node.conversation.relationship)}">${escapeHtml(node.conversation.relationship)}</span>
        </div>
        <div class="tree-node-meta">
          <span>${escapeHtml(node.conversation.adapterId)}</span>
          <span>${formatNumber(node.conversation.messageCount)} msg</span>
          <span>${escapeHtml(formatDate(node.conversation.startedAt))}</span>
        </div>
      </button>
      ${
        node.children.length > 0
          ? `
            <div class="tree-children">
              ${node.children
                .map((child) =>
                  renderTreeNode(child, selectedConversationId, depth + 1),
                )
                .join("")}
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderConversationInspector(currentState: RendererState): string {
  const detail = currentState.detail;
  if (!detail) {
    return `
      <div class="detail-empty inspector-empty">
        <button
          type="button"
          class="inspector-toggle"
          data-toggle="inspector"
          aria-label="Collapse metadata inspector"
          title="Collapse metadata inspector"
        >
          <span aria-hidden="true">&gt;</span>
        </button>
        <h3>Metadata inspector</h3>
        <p>Select a conversation to inspect identity, trace linkage, tokens, cost, and project metadata.</p>
      </div>
    `;
  }

  const { conversation } = detail;

  return `
    <div class="inspector-surface">
      <div class="panel-header panel-header-tight">
        <div>
          <span class="eyebrow">Inspector</span>
          <h2>Metadata</h2>
        </div>
        <div class="panel-actions">
          <span class="panel-meta">${escapeHtml(conversation.adapterId)}</span>
          <button
            type="button"
            class="inspector-toggle"
            data-toggle="inspector"
            aria-label="Collapse metadata inspector"
            title="Collapse metadata inspector"
          >
            <span aria-hidden="true">&gt;</span>
          </button>
        </div>
      </div>

      ${renderInspectorSection(
        "Identity",
        [
          renderInspectorRow("Conversation ID", shortId(conversation.id), true),
          renderInspectorRow("Trace ID", shortId(detail.trace.traceId), true),
          renderInspectorRow("Root ID", shortId(detail.trace.rootId), true),
          renderInspectorRow("Relationship", conversation.relationship),
        ].join(""),
      )}

      ${renderInspectorSection(
        "Runtime",
        [
          renderInspectorRow("Model", conversation.model || "unknown"),
          renderInspectorRow("Started", formatDate(conversation.startedAt)),
          renderInspectorRow("Ended", formatDate(conversation.endedAt || conversation.startedAt)),
          renderInspectorRow("Duration", formatDuration(conversation.durationMs)),
        ].join(""),
      )}

      ${renderInspectorSection(
        "Usage",
        [
          renderInspectorRow("Messages", formatNumber(conversation.messageCount)),
          renderInspectorRow("Tool calls", formatNumber(conversation.toolCount)),
          renderInspectorRow("Display tokens", formatMetricNumber(conversation.inputTokens + conversation.outputTokens).display),
          renderInspectorRow("Cache tokens", formatMetricNumber(conversation.cacheRead + conversation.cacheWrite).display),
          renderInspectorRow("Estimated cost", formatCost(conversation.estCost)),
        ].join(""),
      )}

      ${renderInspectorSection(
        "Lineage",
        [
          renderInspectorRow(
            "Parent",
            detail.parent ? detail.parent.name : "None",
          ),
          renderInspectorRow(
            "Children",
            detail.children.length === 0
              ? "None"
              : detail.children.map((child) => child.name).join(", "),
          ),
          renderInspectorRow(
            "Trace size",
            `${formatNumber(detail.trace.conversationCount)} conversations`,
          ),
        ].join(""),
      )}

      ${renderInspectorSection(
        "Project",
        [
          renderInspectorRow("Remote", conversation.gitRemote || "local / unlinked"),
          renderInspectorRow("Branch", conversation.branch || "unknown"),
          renderInspectorRow("Path", conversation.cwd || conversation.sourcePath),
          renderInspectorRow("Source format", conversation.sourceFormat),
        ].join(""),
      )}
    </div>
  `;
}

function renderInspectorRail(): string {
  return `
    <aside class="inspector-rail">
      <button
        type="button"
        class="inspector-rail-button"
        data-toggle="inspector"
        aria-label="Expand metadata inspector"
        title="Expand metadata inspector"
      >
        <span aria-hidden="true">i</span>
      </button>
    </aside>
  `;
}

function renderInspectorSection(title: string, body: string): string {
  return `
    <section class="inspector-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="inspector-grid">
        ${body}
      </div>
    </section>
  `;
}

function renderInspectorRow(
  label: string,
  value: string,
  mono = false,
): string {
  return `
    <div class="inspector-row">
      <span>${escapeHtml(label)}</span>
      <strong class="${mono ? "mono" : ""}">${escapeHtml(value)}</strong>
    </div>
  `;
}

function pickConversationId(
  conversations: Conversation[],
  preferredConversationId: string | null,
): string | null {
  if (preferredConversationId) {
    const match = conversations.find(
      (conversation) => conversation.id === preferredConversationId,
    );
    if (match) {
      return match.id;
    }
  }

  return conversations[0]?.id ?? null;
}

function normalizeFilterValue(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}

function totalTokens(conversation: Conversation): number {
  return (
    conversation.inputTokens +
    conversation.outputTokens +
    conversation.cacheRead +
    conversation.cacheWrite
  );
}

function renderRuntimeHeading(status: DesktopControlStatus): string {
  if (
    status.health.status === "degraded" &&
    status.health.issueSubsystems.length > 0
  ) {
    return `Degraded in ${status.health.issueSubsystems.join(", ")}`;
  }

  return `Daemon ${status.runtime.state}`;
}

function renderPreformattedText(value: string): string {
  const safeValue = escapeHtml(value.length > 0 ? value : " ");
  return `<pre>${safeValue}</pre>`;
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}..${value.slice(-2)}`;
}

function formatDate(value: string): string {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0s";
  }

  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMetricNumber(value: number): FormattedMetric {
  const exact = formatNumber(value);
  if (Math.abs(value) < 10_000) {
    return { display: exact };
  }

  return {
    display: formatCompactNumber(value),
    exact,
  };
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCost(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function isTransitionalRuntimeState(
  state: DesktopControlStatus["runtime"]["state"],
): boolean {
  return state === "starting" || state === "stopping";
}

function isRuntimeQueryable(
  state: DesktopControlStatus["runtime"]["state"],
): boolean {
  return state === "running" || state === "degraded";
}

function isDesktopHomePanel(value: string | null): value is DesktopHomePanel {
  return value === "harness" || value === "models" || value === "usage";
}

function getIncompatibleCompatibility(
  currentState: RendererState,
): DesktopCompatibilityStatus | null {
  const compatibility = currentState.snapshot?.compatibility ?? null;
  return compatibility && !compatibility.compatible ? compatibility : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isBusy(
  currentState: RendererState,
  action: DesktopControlAction,
): string {
  return currentState.busyAction === action ? "disabled" : "";
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
