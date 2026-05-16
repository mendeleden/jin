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
  DesktopLogsRequest,
  DesktopLogsView,
  DesktopRoutingView,
  DesktopTraceView,
  DesktopTreeView,
} from "../src/contracts/desktop";
import type { JinDesktopBridge } from "./bridge";
import {
  renderHomeMissionControlGraph,
  renderRoutingFlowGraph,
} from "./graph-components";

export type DesktopNavigationView =
  | "home"
  | "conversations"
  | "routing"
  | "logs"
  | "settings";
export type LegacyDesktopNavigationView = Extract<
  DesktopNavigationView,
  "conversations" | "logs" | "settings"
>;
export type DesktopConversationSubview = "timeline" | "trace" | "tree";
export type DesktopHomePanel = "harness" | "models" | "usage";

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
  logsRequest: DesktopLogsRequest;
  logs: DesktopLogsView | null;
  logsLoading: boolean;
  logsError: string | null;
  routing: DesktopRoutingView | null;
  routingLoading: boolean;
  routingError: string | null;
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
const DEFAULT_LOG_LIMIT = 240;
const TIME_FILTERS: Array<{ label: string; value: string }> = [
  { label: "All time", value: "" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
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
const TREE_DEPTH_CLASS_MAX = 12;
export const ESTIMATED_COST_HELP =
  "Calculated from API pricing estimates; not subscription usage or billing-plan spend.";

type UsageDayBucket = {
  day: string;
  totalTokens: number;
  totalCost: number;
  entries: Array<{ adapterId: string; tokens: number; cost: number }>;
};

export function createInitialRendererState(
  overrides: Partial<RendererState> = {},
): RendererState {
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
    loading: true,
    refreshing: false,
    busyAction: null,
    message: null,
    snapshot: null,
    logsRequest: {
      limit: DEFAULT_LOG_LIMIT,
    },
    logs: null,
    logsLoading: false,
    logsError: null,
    routing: null,
    routingLoading: false,
    routingError: null,
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
    ...overrides,
  };
}

export type DesktopRendererChangeListener = (state: RendererState) => void;

export class DesktopRendererController {
  private readonly bridge: JinDesktopBridge;
  private readonly onChange: DesktopRendererChangeListener;
  private readonly state: RendererState;
  private shellRequestToken = 0;
  private routingRequestToken = 0;
  private libraryRequestToken = 0;
  private detailRequestToken = 0;

  constructor(options: {
    bridge: JinDesktopBridge;
    onChange?: DesktopRendererChangeListener;
    initialState?: Partial<RendererState>;
  }) {
    this.bridge = options.bridge;
    this.onChange = options.onChange ?? (() => {});
    this.state = createInitialRendererState(options.initialState);
  }

  getSnapshot(): RendererState {
    return cloneRendererState(this.state);
  }

  toggleSidebar(): void {
    this.state.sidebarCollapsed = !this.state.sidebarCollapsed;
    this.notify();
  }

  toggleInspector(): void {
    this.state.inspectorCollapsed = !this.state.inspectorCollapsed;
    this.notify();
  }

  toggleHomePanel(panel: DesktopHomePanel): void {
    this.state.collapsedHomePanels = {
      ...this.state.collapsedHomePanels,
      [panel]: !this.state.collapsedHomePanels[panel],
    };
    this.notify();
  }

  selectSubview(subview: DesktopConversationSubview): void {
    this.state.selectedSubview = subview;
    this.notify();
  }

  async refreshShell(options: {
    preserveSelection: boolean;
    preserveMessage?: boolean;
  }): Promise<void> {
    const requestToken = ++this.shellRequestToken;
    const initialLoad = this.state.snapshot === null;
    this.state.loading = initialLoad;
    this.state.refreshing = !initialLoad;
    if (!options.preserveMessage) {
      this.state.message = null;
    }
    this.notify();

    try {
      const snapshot = await this.bridge.getHomeSnapshot();
      if (requestToken !== this.shellRequestToken) {
        return;
      }

      this.state.snapshot = snapshot;

      if (isRuntimeQueryable(snapshot.status.runtime.state)) {
        if (this.state.activeView === "logs" || this.state.logs !== null) {
          await this.refreshLogs();
        }
        if (this.state.activeView === "routing" || this.state.routing !== null) {
          await this.refreshRouting();
        }
        if (this.state.activeView === "conversations" || this.state.library !== null) {
          await this.refreshConversationLibrary({
            preserveSelection: options.preserveSelection,
          });
        }
      } else {
        clearConversationWorkspace(this.state);
        clearRoutingWorkspace(this.state);
      }
    } catch (error) {
      if (requestToken !== this.shellRequestToken) {
        return;
      }

      this.state.snapshot = null;
      clearConversationWorkspace(this.state);
      clearRoutingWorkspace(this.state);
      if (!options.preserveMessage) {
        this.state.message = formatError(error);
      }
    } finally {
      if (requestToken === this.shellRequestToken) {
        this.state.loading = false;
        this.state.refreshing = false;
        this.notify();
      }
    }
  }

  async switchView(view: DesktopNavigationView): Promise<void> {
    this.state.activeView = view;
    this.notify();

    if (
      view === "conversations" &&
      this.state.snapshot &&
      isRuntimeQueryable(this.state.snapshot.status.runtime.state) &&
      this.state.library === null
    ) {
      await this.refreshConversationLibrary({ preserveSelection: true });
    }

    if (
      view === "logs" &&
      this.state.snapshot &&
      isRuntimeQueryable(this.state.snapshot.status.runtime.state)
    ) {
      await this.refreshLogs();
    }

    if (
      view === "routing" &&
      this.state.snapshot &&
      isRuntimeQueryable(this.state.snapshot.status.runtime.state)
    ) {
      await this.refreshRouting();
    }
  }

  async refreshRouting(): Promise<void> {
    if (
      !this.state.snapshot ||
      !isRuntimeQueryable(this.state.snapshot.status.runtime.state)
    ) {
      return;
    }

    const requestToken = ++this.routingRequestToken;
    this.state.routingLoading = true;
    this.state.routingError = null;
    this.notify();

    try {
      const getRouting = (this.bridge as Partial<JinDesktopBridge>).getRouting;
      if (typeof getRouting !== "function") {
        throw new Error(
          "Desktop preload bridge is stale. Restart Jin Desktop so the native bridge exposes routing.",
        );
      }

      const routing = await getRouting.call(this.bridge);
      if (requestToken !== this.routingRequestToken) {
        return;
      }
      this.state.routing = routing;
      this.state.routingError = null;
    } catch (error) {
      if (requestToken !== this.routingRequestToken) {
        return;
      }
      this.state.routingError = formatError(error);
    } finally {
      if (requestToken === this.routingRequestToken) {
        this.state.routingLoading = false;
        this.notify();
      }
    }
  }

  async refreshLogs(): Promise<void> {
    if (
      !this.state.snapshot ||
      !isRuntimeQueryable(this.state.snapshot.status.runtime.state)
    ) {
      return;
    }

    this.state.logsLoading = true;
    this.state.logsError = null;
    this.notify();

    try {
      const getLogs = (this.bridge as Partial<JinDesktopBridge>).getLogs;
      if (typeof getLogs !== "function") {
        throw new Error(
          "Desktop preload bridge is stale. Restart Jin Desktop so the native bridge exposes logs.",
        );
      }

      this.state.logs = await getLogs.call(this.bridge, this.state.logsRequest);
      this.state.logsError = null;
    } catch (error) {
      this.state.logsError = formatError(error);
    } finally {
      this.state.logsLoading = false;
      this.notify();
    }
  }

  async setAdapterFilter(value: string): Promise<void> {
    this.state.libraryRequest = {
      ...this.state.libraryRequest,
      adapterId: normalizeFilterValue(value),
    };
    await this.refreshConversationLibrary({ preserveSelection: false });
  }

  async setSinceFilter(value: string): Promise<void> {
    this.state.libraryRequest = {
      ...this.state.libraryRequest,
      since: normalizeFilterValue(value),
    };
    await this.refreshConversationLibrary({ preserveSelection: false });
  }

  async refreshConversationLibrary(options: {
    preserveSelection: boolean;
  }): Promise<void> {
    if (
      !this.state.snapshot ||
      !isRuntimeQueryable(this.state.snapshot.status.runtime.state)
    ) {
      return;
    }

    const requestToken = ++this.libraryRequestToken;
    this.state.libraryLoading = true;
    this.state.libraryError = null;
    this.notify();

    try {
      const library = await this.bridge.listConversations(this.state.libraryRequest);
      if (requestToken !== this.libraryRequestToken) {
        return;
      }

      this.state.library = library;
      this.state.libraryRequest = {
        adapterId: library.filters.adapterId ?? undefined,
        since: library.filters.since ?? undefined,
        limit: library.filters.limit,
      };
      this.state.libraryError = null;

      const nextConversationId = pickConversationId(
        library.conversations,
        options.preserveSelection ? this.state.selectedConversationId : null,
      );

      if (!nextConversationId) {
        clearSelectedConversation(this.state);
        return;
      }

      const shouldLoadDetail =
        nextConversationId !== this.state.selectedConversationId ||
        this.state.detail?.conversation.id !== nextConversationId ||
        this.state.trace?.selectedConversationId !== nextConversationId ||
        this.state.tree?.selectedConversationId !== nextConversationId;

      this.state.selectedConversationId = nextConversationId;

      if (shouldLoadDetail) {
        await this.loadConversationWorkspace(nextConversationId);
      }
    } catch (error) {
      if (requestToken !== this.libraryRequestToken) {
        return;
      }

      this.state.libraryError = formatError(error);
      clearSelectedConversation(this.state);
    } finally {
      if (requestToken === this.libraryRequestToken) {
        this.state.libraryLoading = false;
        this.notify();
      }
    }
  }

  async openConversation(conversationId: string): Promise<void> {
    this.state.activeView = "conversations";
    this.state.selectedConversationId = conversationId;
    this.notify();
    await this.loadConversationWorkspace(conversationId);
  }

  async runControlAction(action: DesktopControlAction): Promise<void> {
    this.state.busyAction = action;
    this.state.message = null;
    this.notify();

    try {
      const result = await this.bridge.runControlAction(action);
      this.state.message = result.ok
        ? `${capitalize(action)} requested.`
        : result.stderr || result.stdout || `Unable to ${action} Jin.`;
      this.state.snapshot = {
        status: result.status,
        compatibility: null,
        data: null,
        transportError: null,
      };
      if (!isRuntimeQueryable(result.status.runtime.state)) {
        clearConversationWorkspace(this.state);
        clearLogsWorkspace(this.state);
        clearRoutingWorkspace(this.state);
      }
      await this.refreshShell({ preserveSelection: true, preserveMessage: true });
    } catch (error) {
      this.state.message = formatError(error);
      this.notify();
    } finally {
      this.state.busyAction = null;
      this.notify();
    }
  }

  private async loadConversationWorkspace(conversationId: string): Promise<void> {
    const requestToken = ++this.detailRequestToken;
    this.state.selectedConversationId = conversationId;
    this.state.selectedConversationLoading = true;
    this.state.selectedConversationError = null;
    this.notify();

    try {
      const [detail, trace, tree] = await Promise.all([
        this.bridge.getConversationDetail(conversationId),
        this.bridge.getTraceView(conversationId),
        this.bridge.getTreeView(conversationId),
      ]);

      if (requestToken !== this.detailRequestToken) {
        return;
      }

      this.state.detail = detail;
      this.state.trace = trace;
      this.state.tree = tree;
      this.state.selectedConversationError = null;
    } catch (error) {
      if (requestToken !== this.detailRequestToken) {
        return;
      }

      clearSelectedConversation(this.state, false);
      this.state.selectedConversationId = conversationId;
      this.state.selectedConversationError = formatError(error);
    } finally {
      if (requestToken === this.detailRequestToken) {
        this.state.selectedConversationLoading = false;
        this.notify();
      }
    }
  }

  private notify(): void {
    this.onChange(this.getSnapshot());
  }
}

export function bindDesktopRendererEvents(
  root: HTMLElement,
  controller: DesktopRendererController,
): () => void {
  const handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action) {
      void controller.runControlAction(action as DesktopControlAction);
      return;
    }

    const toggle = target.closest<HTMLElement>("[data-toggle]")?.dataset.toggle;
    if (toggle === "sidebar") {
      controller.toggleSidebar();
      return;
    }

    if (toggle === "inspector") {
      controller.toggleInspector();
      return;
    }

    const homePanel =
      target.closest<HTMLElement>("[data-home-panel]")?.dataset.homePanel ?? null;
    if (isDesktopHomePanel(homePanel)) {
      controller.toggleHomePanel(homePanel);
      return;
    }

    const refresh = target.closest<HTMLElement>("[data-refresh]")?.dataset.refresh;
    if (refresh === "shell") {
      void controller.refreshShell({ preserveSelection: true });
      return;
    }

    const navigation =
      target.closest<HTMLElement>("[data-nav]")?.dataset.nav ?? null;
    if (
      navigation === "home" ||
      navigation === "conversations" ||
      navigation === "routing" ||
      navigation === "logs" ||
      navigation === "settings"
    ) {
      void controller.switchView(navigation);
      return;
    }

    const subview =
      target.closest<HTMLElement>("[data-subview]")?.dataset.subview ?? null;
    if (subview === "timeline" || subview === "trace" || subview === "tree") {
      controller.selectSubview(subview);
      return;
    }

    const conversationId =
      target
        .closest<HTMLElement>("[data-conversation-id]")
        ?.dataset.conversationId ?? null;
    if (conversationId) {
      void controller.openConversation(conversationId);
    }
  };

  const handleChange = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const filter = target.dataset.filter;
    if (filter === "adapter") {
      void controller.setAdapterFilter(target.value);
      return;
    }

    if (filter === "since") {
      void controller.setSinceFilter(target.value);
    }
  };

  root.addEventListener("click", handleClick);
  root.addEventListener("change", handleChange);

  return () => {
    root.removeEventListener("click", handleClick);
    root.removeEventListener("change", handleChange);
  };
}

export function mountDesktopRenderer(
  root: HTMLElement,
  bridge: JinDesktopBridge,
): DesktopRendererController {
  const controller = new DesktopRendererController({
    bridge,
    onChange(nextState) {
      root.innerHTML = renderApp(nextState);
    },
  });
  bindDesktopRendererEvents(root, controller);
  root.innerHTML = renderApp(controller.getSnapshot());
  void controller.refreshShell({ preserveSelection: true });
  return controller;
}

function cloneRendererState(state: RendererState): RendererState {
  return {
    ...state,
    collapsedHomePanels: {
      ...state.collapsedHomePanels,
    },
    libraryRequest: {
      ...state.libraryRequest,
    },
    logsRequest: {
      ...state.logsRequest,
    },
  };
}

function clearLogsWorkspace(state: RendererState): void {
  state.logs = null;
  state.logsLoading = false;
  state.logsError = null;
}

function clearRoutingWorkspace(state: RendererState): void {
  state.routing = null;
  state.routingLoading = false;
  state.routingError = null;
}

function clearConversationWorkspace(state: RendererState): void {
  state.library = null;
  state.libraryError = null;
  state.libraryLoading = false;
  clearSelectedConversation(state);
}

function clearSelectedConversation(
  state: RendererState,
  clearId = true,
): void {
  if (clearId) {
    state.selectedConversationId = null;
  }
  state.selectedConversationLoading = false;
  state.selectedConversationError = null;
  state.detail = null;
  state.trace = null;
  state.tree = null;
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
  const title = renderDesktopViewTitle(currentState.activeView);
  const subtitle = renderDesktopViewSubtitle(currentState);

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

  if (currentState.activeView === "routing") {
    return renderRoutingWorkspace(currentState);
  }

  if (currentState.activeView === "logs") {
    return renderLogsWorkspace(currentState);
  }

  return renderConversationWorkspace(currentState);
}

export function renderLegacyWorkspace(
  currentState: RendererState,
  view: LegacyDesktopNavigationView = currentState.activeView as LegacyDesktopNavigationView,
): string {
  if (view === "settings") {
    return renderSettingsWorkspace(currentState);
  }

  if (view === "logs") {
    return renderLogsWorkspace(currentState);
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
        <button
          type="button"
          class="sidebar-toggle ${collapsed ? "collapsed" : ""}"
          data-toggle="sidebar"
          aria-label="${collapsed ? "Expand sidebar" : "Collapse sidebar"}"
          title="${collapsed ? "Expand sidebar" : "Collapse sidebar"}"
        >
          <span class="side-panel-icon ${collapsed ? "expand" : "collapse"}" aria-hidden="true">
            <span class="side-panel-icon-rail"></span>
            <span class="side-panel-icon-main"></span>
          </span>
          <span class="sidebar-toggle-copy">${collapsed ? "Expand" : "Collapse"}</span>
        </button>
      </div>

      <nav class="nav-list" aria-label="Primary">
        ${renderNavButton("home", "Home", currentState.activeView)}
        ${renderNavButton("conversations", "Conversations", currentState.activeView)}
        ${renderNavButton("routing", "Routing", currentState.activeView)}
        ${renderNavButton("logs", "Logs", currentState.activeView)}
        ${renderNavButton("settings", "Settings", currentState.activeView)}
      </nav>

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
                  renderSidebarMetric("Cost", formatCost(overview.cost), false, {
                    estimatedCost: true,
                  }),
                ].join("")
              : [
                  renderSidebarMetric("Conversations", "-"),
                  renderSidebarMetric("Messages", "-"),
                  renderSidebarMetric("Tool calls", "-"),
                  renderSidebarMetric("Tokens", "-"),
                  renderSidebarMetric("Cost", "-", false, {
                    estimatedCost: true,
                  }),
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
      title="${escapeHtml(label)}"
    >
      <span class="nav-icon" aria-hidden="true">${renderNavIcon(view)}</span>
      <span class="nav-label">${escapeHtml(label)}</span>
    </button>
  `;
}

function renderNavIcon(view: DesktopNavigationView): string {
  if (view === "home") {
    return `
      <svg viewBox="0 0 24 24" role="img">
        <path d="M4 10.8 12 4l8 6.8" />
        <path d="M6.5 10.5V20h11v-9.5" />
        <path d="M10 20v-5h4v5" />
      </svg>
    `;
  }

  if (view === "settings") {
    return `
      <svg viewBox="0 0 24 24" role="img">
        <path d="M4 7h7" />
        <path d="M15 7h5" />
        <path d="M11 5v4" />
        <path d="M4 17h4" />
        <path d="M12 17h8" />
        <path d="M8 15v4" />
      </svg>
    `;
  }

  if (view === "logs") {
    return `
      <svg viewBox="0 0 24 24" role="img">
        <path d="M7 4.5h10v15H7z" />
        <path d="M10 8h4" />
        <path d="M10 11.5h5" />
        <path d="M10 15h3" />
      </svg>
    `;
  }

  if (view === "routing") {
    return `
      <svg viewBox="0 0 24 24" role="img">
        <path d="M5 6.5h4" />
        <path d="M5 12h4" />
        <path d="M5 17.5h4" />
        <path d="M15 7h4" />
        <path d="M15 17h4" />
        <path d="M9 6.5c3 0 3 10.5 6 10.5" />
        <path d="M9 12c2.5 0 3.5-5 6-5" />
        <path d="M9 17.5c2 0 3-0.5 6-0.5" />
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" role="img">
      <path d="M5 6.5h14v9H9l-4 3v-12Z" />
      <path d="M8 10h8" />
      <path d="M8 13h5" />
    </svg>
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
        ${
          currentState.activeView === "home"
            ? ""
            : `<div class="eyebrow">Native shell</div>`
        }
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

export function renderDesktopViewTitle(view: DesktopNavigationView): string {
  if (view === "home") {
    return "Home";
  }

  if (view === "routing") {
    return "Routing";
  }

  if (view === "logs") {
    return "Logs";
  }

  if (view === "settings") {
    return "Settings";
  }

  return "Conversations";
}

export function renderDesktopViewSubtitle(currentState: RendererState): string {
  if (currentState.activeView === "home") {
    return renderHomeSubtitle(currentState);
  }

  if (currentState.activeView === "routing") {
    return renderRoutingSubtitle(currentState);
  }

  if (currentState.activeView === "logs") {
    return renderLogsSubtitle(currentState);
  }

  if (currentState.activeView === "settings") {
    return renderSettingsSubtitle(currentState);
  }

  return renderConversationSubtitle(currentState);
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

  if (currentState.activeView === "logs" && currentState.logsError) {
    notices.push(
      `<div class="notice warning">${escapeHtml(currentState.logsError)}</div>`,
    );
  }

  if (currentState.activeView === "routing" && currentState.routingError) {
    notices.push(
      `<div class="notice warning">${escapeHtml(currentState.routingError)}</div>`,
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

function renderLogsSubtitle(currentState: RendererState): string {
  const snapshot = currentState.snapshot;
  if (!snapshot) {
    return "Desktop is waiting for runtime paths.";
  }

  if (snapshot.status.runtime.state === "stopped") {
    return "Start Jin to read daemon logs.";
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return snapshot.status.runtime.state === "starting"
      ? "Runtime startup is in progress."
      : "Runtime shutdown is in progress.";
  }

  if (currentState.logsLoading && !currentState.logs) {
    return "Loading the daemon log tail.";
  }

  if (currentState.logs) {
    return `${formatNumber(currentState.logs.returnedLines)} of ${formatNumber(
      currentState.logs.totalLines,
    )} log lines loaded.`;
  }

  return "Open the daemon log tail without leaving Desktop.";
}

function renderRoutingSubtitle(currentState: RendererState): string {
  const snapshot = currentState.snapshot;
  if (!snapshot) {
    return "Desktop is waiting for routing state.";
  }

  if (snapshot.status.runtime.state === "stopped") {
    return "Start Jin to inspect project-to-sink routing.";
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return snapshot.status.runtime.state === "starting"
      ? "Runtime startup is in progress."
      : "Runtime shutdown is in progress.";
  }

  if (currentState.routingLoading && !currentState.routing) {
    return "Loading indexed projects and sink route rules.";
  }

  if (currentState.routing) {
    return `${formatNumber(currentState.routing.projects.length)} git projects, ${formatNumber(
      currentState.routing.sinks.length,
    )} sinks, ${formatNumber(currentState.routing.routes.length)} route rules.`;
  }

  return "Map indexed git projects to the sinks they currently push to.";
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

      ${renderHomeMissionControlGraph(data)}

      ${renderTokenUsageObservatory(data)}

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

function renderLogsWorkspace(currentState: RendererState): string {
  const snapshot = currentState.snapshot;
  if (!snapshot) {
    return "";
  }

  if (snapshot.status.runtime.state === "stopped") {
    return renderLifecycleState(
      currentState,
      "Logs",
      "Daemon logs are paused while Jin is stopped.",
      "Start the daemon to stream the current runtime log tail through the Desktop API.",
    );
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return renderLifecycleState(
      currentState,
      "Logs",
      snapshot.status.runtime.state === "starting"
        ? "Jin is starting up."
        : "Jin is shutting down.",
      snapshot.status.runtime.state === "starting"
        ? "The log tail will load once the daemon is queryable."
        : "The log tail is paused until shutdown completes.",
    );
  }

  const logs = currentState.logs;
  const logPath = logs?.path ?? snapshot.status.paths.log;

  return `
    <section class="workspace-logs">
      <section class="compact-panel compact-panel-wide logs-panel">
        <div class="panel-header">
          <div>
            <span class="eyebrow">Runtime log</span>
            <h2>Daemon log tail</h2>
          </div>
          <button class="toolbar-button subtle" data-refresh="shell">
            ${currentState.logsLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div class="runtime-grid runtime-grid-paths logs-meta-grid">
          ${renderRuntimeField("Path", logPath)}
          ${renderRuntimeField(
            "Lines",
            logs
              ? `${formatNumber(logs.returnedLines)} shown / ${formatNumber(logs.totalLines)} total`
              : `Waiting for ${formatNumber(currentState.logsRequest.limit ?? DEFAULT_LOG_LIMIT)} lines`,
          )}
        </div>
        ${renderLogsBody(currentState)}
      </section>
    </section>
  `;
}

function renderLogsBody(currentState: RendererState): string {
  const logs = currentState.logs;

  if (currentState.logsLoading && !logs) {
    return `
      <div class="list-placeholder logs-placeholder">
        <div class="placeholder-line wide"></div>
        <div class="placeholder-line"></div>
        <div class="placeholder-line"></div>
        <div class="placeholder-line short"></div>
      </div>
    `;
  }

  if (currentState.logsError && !logs) {
    return `
      <div class="empty-state logs-empty">
        <h3>Daemon logs unavailable</h3>
        <p>${escapeHtml(currentState.logsError)}</p>
        <button class="toolbar-button" data-refresh="shell">Retry</button>
      </div>
    `;
  }

  if (!logs || logs.lines.length === 0) {
    return `
      <div class="empty-state logs-empty">
        <h3>No log lines available.</h3>
        <p>The daemon log file exists, but the current tail did not return any lines.</p>
      </div>
    `;
  }

  return `
    <div class="log-viewer" role="log" aria-label="Daemon log tail">
      ${
        logs.truncated
          ? `<div class="log-truncation">Showing the latest ${formatNumber(logs.returnedLines)} lines.</div>`
          : ""
      }
      ${logs.lines.map((line, index) => renderLogLine(line, index)).join("")}
    </div>
  `;
}

function renderRoutingWorkspace(currentState: RendererState): string {
  const snapshot = currentState.snapshot;
  if (!snapshot) {
    return "";
  }

  if (snapshot.status.runtime.state === "stopped") {
    return renderLifecycleState(
      currentState,
      "Routing",
      "Project routing is paused while Jin is stopped.",
      "Start the daemon to inspect how indexed git projects map to active sinks.",
    );
  }

  if (isTransitionalRuntimeState(snapshot.status.runtime.state)) {
    return renderLifecycleState(
      currentState,
      "Routing",
      snapshot.status.runtime.state === "starting"
        ? "Jin is starting up."
        : "Jin is shutting down.",
      snapshot.status.runtime.state === "starting"
        ? "Project-to-sink routing will load once the daemon is queryable."
        : "Routing inspection is paused until shutdown completes.",
    );
  }

  const routing = currentState.routing;
  if (currentState.routingLoading && !routing) {
    return `
      <section class="workspace-routing">
        <section class="compact-panel compact-panel-wide routing-flow-panel">
          <div class="panel-header">
            <div>
              <span class="eyebrow">Routing graph</span>
              <h2>Projects &rarr; Sinks</h2>
            </div>
            <span class="panel-meta">Loading...</span>
          </div>
          <div class="list-placeholder">
            <div class="placeholder-line wide"></div>
            <div class="placeholder-line"></div>
            <div class="placeholder-line"></div>
          </div>
        </section>
      </section>
    `;
  }

  if (currentState.routingError && !routing) {
    return `
      <section class="workspace-routing">
        <section class="compact-panel compact-panel-wide">
          <div class="empty-state">
            <h3>Routing graph unavailable</h3>
            <p>${escapeHtml(currentState.routingError)}</p>
            <button class="toolbar-button" data-refresh="shell">Retry</button>
          </div>
        </section>
      </section>
    `;
  }

  if (!routing || routing.projects.length === 0) {
    return `
      <section class="workspace-routing">
        <section class="compact-panel compact-panel-wide">
          <div class="empty-state">
            <h3>No git projects indexed yet.</h3>
            <p>Once Jin ingests conversations with git remotes, this view will show which sinks each project routes to.</p>
          </div>
        </section>
        ${routing ? renderRoutingSinksPanel(routing) : ""}
        ${routing ? renderRoutingRulesPanel(routing) : ""}
      </section>
    `;
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

  return `
    <section class="workspace-routing">
      <section class="compact-panel compact-panel-wide routing-flow-panel">
        <div class="panel-header">
          <div>
            <span class="eyebrow">Routing graph</span>
            <h2>Projects &rarr; Sinks</h2>
          </div>
          <div class="panel-actions">
            <span class="panel-meta">${escapeHtml(routingSummary)}</span>
          </div>
        </div>
        ${renderRoutingFlowGraph(routing)}
      </section>
      ${renderRoutingSinksPanel(routing)}
      ${renderRoutingRulesPanel(routing)}
    </section>
  `;
}

function renderRoutingSinksPanel(routing: DesktopRoutingView): string {
  return `
    <section class="compact-panel routing-side-panel">
      <div class="panel-header">
        <div>
          <span class="eyebrow">Destinations</span>
          <h2>Configured sinks</h2>
        </div>
        <span class="panel-meta">${formatNumber(routing.sinks.length)} total</span>
      </div>
      <div class="routing-card-list">
        ${routing.sinks.length > 0
          ? routing.sinks
              .map(
                (sink) => `
                  <article class="routing-sink-card">
                    <div class="routing-sink-card-head">
                      <strong>${escapeHtml(sink.name || sink.id)}</strong>
                      <span class="status-badge ${sink.enabled ? "healthy" : "stopped"}">
                        ${sink.enabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <div class="routing-sink-card-meta">
                      <span>${escapeHtml(sink.type)}</span>
                      ${sink.teamId ? `<span>team ${escapeHtml(sink.teamId)}</span>` : ""}
                      ${sink.userId ? `<span>user ${escapeHtml(sink.userId)}</span>` : ""}
                    </div>
                  </article>
                `,
              )
              .join("")
          : `<div class="empty-row">No sinks configured.</div>`}
      </div>
    </section>
  `;
}

function renderRoutingRulesPanel(routing: DesktopRoutingView): string {
  return `
    <section class="compact-panel routing-side-panel">
      <div class="panel-header">
        <div>
          <span class="eyebrow">Rules</span>
          <h2>Route rules</h2>
        </div>
        <span class="panel-meta">${formatNumber(routing.routes.length)} total</span>
      </div>
      <div class="routing-rule-list">
        ${routing.routes.length > 0
          ? routing.routes
              .map(
                (route) => `
                  <article class="routing-rule-card">
                    <div class="routing-rule-match">
                      <span>#${formatNumber(route.index + 1)}</span>
                      <strong>${escapeHtml(formatRouteMatch(route.match))}</strong>
                    </div>
                    <div class="routing-rule-sinks">
                      ${route.sinkIds.length > 0
                        ? route.sinkIds
                            .map((sinkId) => `<span>${escapeHtml(sinkId)}</span>`)
                            .join("")
                        : `<span>no sinks</span>`}
                    </div>
                  </article>
                `,
              )
              .join("")
          : `<div class="empty-row">No route rules configured.</div>`}
      </div>
    </section>
  `;
}

export function formatRouteMatch(
  match: DesktopRoutingView["routes"][number]["match"],
): string {
  const fields = [
    match.remote ? `remote=${match.remote}` : "",
    match.adapter ? `adapter=${match.adapter}` : "",
    match.branch ? `branch=${match.branch}` : "",
    match.name ? `name=${match.name}` : "",
  ].filter((field) => field.length > 0);

  return fields.length > 0 ? fields.join(" · ") : "all conversations";
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

export interface FormattedMetric {
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

function renderTokenUsageObservatory(data: DesktopHomeData): string {
  return `
    <section class="compact-panel compact-panel-wide usage-panel usage-observatory-panel">
      <div class="panel-header">
        <div>
          <span class="eyebrow">Tokens</span>
          <h2>Token &amp; Cost Observatory</h2>
        </div>
        <span class="panel-meta">Last 30 days</span>
      </div>
      ${renderTokenUsageChart(data.tokenUsageByDay ?? [])}
    </section>
  `;
}

function renderTokenUsageChart(
  entries: DesktopHomeData["tokenUsageByDay"],
): string {
  if (entries.length === 0) {
    return `<div class="empty-row">No token usage timeline is available yet.</div>`;
  }

  const dayMap = new Map<string, UsageDayBucket>();
  const adapterTotals = new Map<string, number>();

  for (const entry of entries) {
    const adapterId = entry.adapterId || "unknown";
    const day = dayMap.get(entry.day) ?? {
      day: entry.day,
      totalTokens: 0,
      totalCost: 0,
      entries: [],
    };
    day.totalTokens += entry.tokens;
    day.totalCost += entry.cost;
    day.entries.push({ adapterId, tokens: entry.tokens, cost: entry.cost });
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
    (left, right) => right.tokens - left.tokens || left.adapterId.localeCompare(right.adapterId),
  );
  const latestX = usageX(days.length - 1, days.length);

  return `
    <div class="usage-chart">
      <div class="usage-chart-heading">
        <div>
          <h3>Daily burn chart</h3>
          <p>Stacked token volume by adapter from the local SQLite store.</p>
        </div>
        <div class="usage-chart-total">
          <span>${escapeHtml(formatChartDay(latestDay.day))}</span>
          <strong>${escapeHtml(formatMetricNumber(latestDay.totalTokens).display)} tok</strong>
          <small>${escapeHtml(formatCost(latestDay.totalCost))}</small>
        </div>
      </div>
      <div class="usage-chart-frame">
        <svg class="usage-area-svg" viewBox="0 0 ${USAGE_CHART_WIDTH} ${USAGE_CHART_HEIGHT}" role="img" aria-label="Daily token usage by adapter">
          <defs>
            ${adapters
              .map(
                (adapterId, index) => `
                  <linearGradient id="usage-fill-${index}" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stop-color="${usageColorHex(index)}" stop-opacity="0.78" />
                    <stop offset="100%" stop-color="${usageColorHex(index)}" stop-opacity="0.32" />
                  </linearGradient>
                `,
              )
              .join("")}
          </defs>
          <rect class="usage-plot-bg" x="${USAGE_CHART_PLOT.x}" y="${USAGE_CHART_PLOT.y}" width="${USAGE_CHART_PLOT.width}" height="${USAGE_CHART_PLOT.height}" />
          ${yTicks
            .map((tick) => {
              const y = usageY(tick, maxDailyTokens);
              return `
                <line class="usage-grid-line" x1="${USAGE_CHART_PLOT.x}" y1="${y}" x2="${USAGE_CHART_PLOT.x + USAGE_CHART_PLOT.width}" y2="${y}" />
                <text class="usage-axis-label" x="${USAGE_CHART_PLOT.x - 14}" y="${y + 4}" text-anchor="end">${escapeHtml(formatMetricNumber(tick).display)}</text>
              `;
            })
            .join("")}
          ${areaLayers
            .map(
              (layer, index) => `
                <path class="usage-area-layer" d="${layer.path}" fill="url(#usage-fill-${index})" stroke="${usageColorHex(index)}" />
              `,
            )
            .join("")}
          ${days
            .map((day, index) => {
              if (!shouldRenderUsageDayLabel(index, days.length)) {
                return "";
              }
              const x = usageX(index, days.length);
              return `
                <line class="usage-day-marker" x1="${x}" y1="${USAGE_CHART_PLOT.y}" x2="${x}" y2="${USAGE_CHART_PLOT.y + USAGE_CHART_PLOT.height}" />
                <text class="usage-axis-label" x="${x}" y="${USAGE_CHART_PLOT.y + USAGE_CHART_PLOT.height + 28}" text-anchor="middle">${escapeHtml(formatChartDay(day.day))}</text>
              `;
            })
            .join("")}
          <line class="usage-focus-line" x1="${latestX}" y1="${USAGE_CHART_PLOT.y}" x2="${latestX}" y2="${USAGE_CHART_PLOT.y + USAGE_CHART_PLOT.height}" />
          <circle class="usage-focus-dot" cx="${latestX}" cy="${usageY(latestDay.totalTokens, maxDailyTokens)}" r="5" />
        </svg>
        <div class="usage-callout">
          <strong>${escapeHtml(formatChartDay(latestDay.day))}</strong>
          ${latestEntries
            .slice(0, 6)
            .map((entry) => {
              const colorIndex = adapterIndex.get(entry.adapterId) ?? 0;
              return `
                <span>
                  <i class="${usageColorClass(colorIndex)}"></i>
                  ${escapeHtml(entry.adapterId)}
                  <b>${escapeHtml(formatMetricNumber(entry.tokens).display)}</b>
                </span>
              `;
            })
            .join("")}
        </div>
      </div>
      <div class="usage-legend">
        ${adapters
          .map(
            (adapterId) => `
              <span>
                <i class="${usageColorClass(adapterIndex.get(adapterId) ?? 0)}"></i>
                ${escapeHtml(adapterId)}
              </span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
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
      lowerPoints.unshift(`${x.toFixed(1)},${usageY(lower, maxDailyTokens).toFixed(1)}`);
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

function renderSidebarMetric(
  label: string,
  value: number | string,
  preferCompact = true,
  options: { estimatedCost?: boolean } = {},
): string {
  const formatted =
    typeof value === "number"
      ? preferCompact
        ? formatMetricNumber(value)
        : { display: formatNumber(value) }
      : { display: value };
  const exact = formatted.exact && formatted.exact !== formatted.display ? formatted.exact : "";
  const labelCopy = options.estimatedCost ? `${label} (estimated)` : label;

  return `
    <div class="sidebar-metric ${options.estimatedCost ? "sidebar-metric-cost" : ""}" title="${escapeHtml(exact ? `${label}: ${exact}` : labelCopy)}">
      <span class="sidebar-metric-label">
        ${escapeHtml(labelCopy)}
        ${
          options.estimatedCost
            ? `<span class="sidebar-cost-info" tabindex="0" aria-label="${escapeHtml(ESTIMATED_COST_HELP)}">i</span>
               <span class="sidebar-cost-tooltip" role="tooltip">${escapeHtml(ESTIMATED_COST_HELP)}</span>`
            : ""
        }
      </span>
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

function renderLogLine(line: string, index: number): string {
  const severityClass = /\b(error|failed|failure|exception)\b/i.test(line)
    ? "error"
    : /\b(warn|warning|degraded)\b/i.test(line)
      ? "warning"
      : "";

  return `<pre class="log-line ${severityClass}"><span class="log-line-number">${formatNumber(index + 1)}</span><span class="log-line-copy">${escapeHtml(line.length > 0 ? line : " ")}</span></pre>`;
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
                <span>${formatNumber(entry.conversation.messageCount)} msg</span>
                <span>${formatNumber(entry.conversation.toolCount)} tools</span>
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
        class="tree-node tree-depth-${treeDepthClass(depth)} ${selected ? "selected" : ""}"
        data-conversation-id="${escapeHtml(node.conversation.id)}"
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

function treeDepthClass(depth: number): number {
  if (!Number.isFinite(depth) || depth <= 0) {
    return 0;
  }

  return Math.min(TREE_DEPTH_CLASS_MAX, Math.floor(depth));
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

export function renderRuntimeHeading(status: DesktopControlStatus): string {
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

export function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}..${value.slice(-2)}`;
}

export function formatDate(value: string): string {
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

export function formatDuration(value: number): string {
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

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatMetricNumber(value: number): FormattedMetric {
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

export function formatCost(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

export function isTransitionalRuntimeState(
  state: DesktopControlStatus["runtime"]["state"],
): boolean {
  return state === "starting" || state === "stopping";
}

export function isRuntimeQueryable(
  state: DesktopControlStatus["runtime"]["state"],
): boolean {
  return state === "running" || state === "degraded";
}

function isDesktopHomePanel(value: string | null): value is DesktopHomePanel {
  return value === "harness" || value === "models" || value === "usage";
}

export function getIncompatibleCompatibility(
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
