import type { Conversation } from "../src/contracts/conversations";
import type {
  DesktopCompatibilityStatus,
  DesktopConversationDetailView,
  DesktopConversationListRequest,
  DesktopConversationListView,
  DesktopControlAction,
  DesktopControlStatus,
  DesktopHomeSnapshot,
  DesktopLogsRequest,
  DesktopLogsView,
  DesktopRoutingView,
  DesktopTraceView,
  DesktopTreeView,
} from "../src/contracts/desktop";
import type { JinDesktopBridge } from "./bridge";

export type DesktopNavigationView =
  | "home"
  | "conversations"
  | "routing"
  | "logs"
  | "settings";
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

export interface FormattedMetric {
  display: string;
  exact?: string;
}

const DEFAULT_CONVERSATION_LIMIT = 48;
const DEFAULT_LOG_LIMIT = 240;
export const ESTIMATED_COST_HELP =
  "Calculated from API pricing estimates; not subscription usage or billing-plan spend.";

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
        clearLogsWorkspace(this.state);
        clearRoutingWorkspace(this.state);
      }
    } catch (error) {
      if (requestToken !== this.shellRequestToken) {
        return;
      }

      this.state.snapshot = null;
      clearConversationWorkspace(this.state);
      clearLogsWorkspace(this.state);
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

  const selected = currentState.detail?.conversation;
  if (!selected) {
    return `${formatNumber(library.conversations.length)} conversations indexed`;
  }

  const tokens =
    selected.inputTokens +
    selected.outputTokens +
    selected.cacheRead +
    selected.cacheWrite;
  return `${formatNumber(library.conversations.length)} conversations indexed - ${selected.adapterId} - ${formatMetricNumber(tokens).display} tokens`;
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

export function renderRuntimeHeading(status: DesktopControlStatus): string {
  if (
    status.health.status === "degraded" &&
    status.health.issueSubsystems.length > 0
  ) {
    return `Degraded in ${status.health.issueSubsystems.join(", ")}`;
  }

  return `Daemon ${status.runtime.state}`;
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

export function getIncompatibleCompatibility(
  currentState: RendererState,
): DesktopCompatibilityStatus | null {
  const compatibility = currentState.snapshot?.compatibility ?? null;
  return compatibility && !compatibility.compatible ? compatibility : null;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
