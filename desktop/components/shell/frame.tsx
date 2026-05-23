import type { ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
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
import type { DesktopControlStatus } from "../../../src/contracts/desktop";
import {
  ESTIMATED_COST_HELP,
  formatCost,
  formatMetricNumber,
  formatNumber,
  getIncompatibleCompatibility,
  renderRuntimeHeading,
  type DesktopNavigationView,
  type RendererState,
} from "../../renderer";
import { StatusBadge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { cx } from "../../ui/classnames";
import type { DesktopShellActions } from "./actions";

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

export function ShellFrame({
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
    <div
      className={cx(
        "grid h-dvh min-h-dvh overflow-hidden",
        state.sidebarCollapsed
          ? "grid-cols-[64px_minmax(0,1fr)] max-[880px]:grid-cols-1"
          : "grid-cols-[220px_minmax(0,1fr)] max-[880px]:grid-cols-1",
      )}
    >
      <Sidebar actions={actions} state={state} />
      <main className="flex h-full max-h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden px-[18px] py-4 pb-[18px]">
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
    <aside
      className={cx(
        "flex h-full min-h-0 flex-col gap-3 overflow-hidden border-r border-[var(--line)] bg-[linear-gradient(180deg,rgba(12,15,23,0.98),rgba(10,12,20,0.96)),linear-gradient(180deg,transparent,rgba(255,255,255,0.02))] px-3.5 pb-4 pt-12 backdrop-blur-[14px] max-[880px]:border-r-0 max-[880px]:border-b",
        collapsed && "items-center gap-2.5 px-2.5 pb-3.5",
      )}
      data-sidebar
      data-sidebar-collapsed={String(collapsed)}
    >
      <div className="flex w-full items-center justify-center gap-2.5">
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cx(
            "inline-flex h-8 min-w-9 flex-none cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-[var(--line)] bg-white/[0.03] px-2.5 text-[var(--text-soft)] hover:border-[var(--line-strong)] hover:text-[var(--text)]",
            collapsed && "w-8 px-0",
          )}
          onClick={() => actions.toggleSidebar()}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          <ToggleIcon aria-hidden="true" />
          <span
            className={cx(
              "text-[0.72rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]",
              collapsed && "hidden",
            )}
          >
            {collapsed ? "Expand" : "Collapse"}
          </span>
        </button>
      </div>

      <nav
        aria-label="Primary"
        className={cx(
          "flex w-full flex-col items-stretch gap-1.5 max-[880px]:flex-row max-[880px]:flex-wrap",
          collapsed && "items-center",
        )}
      >
        {NAV_ITEMS.map(({ Icon, label, view }) => (
          <button
            aria-current={state.activeView === view ? "page" : undefined}
            className={cx(
              "relative flex min-h-9 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-[9px] border border-transparent bg-transparent px-2.5 py-2 text-left font-semibold leading-none text-[var(--text-soft)] transition-colors hover:border-[rgba(137,180,255,0.14)] hover:bg-white/[0.03] hover:text-[var(--text)]",
              state.activeView === view &&
                "border-[rgba(137,180,255,0.22)] bg-[linear-gradient(180deg,rgba(137,180,255,0.12),rgba(137,180,255,0.04))] text-[var(--accent-strong)]",
              collapsed && "h-10 w-10 justify-center p-0",
            )}
            key={view}
            onClick={() => void actions.switchView(view)}
            title={label}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cx(
                "inline-flex h-[22px] w-[22px] flex-none items-center justify-center rounded-lg border border-[rgba(210,224,255,0.08)] bg-white/[0.025] text-current transition-colors [&_svg]:h-4 [&_svg]:w-4 [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:stroke-[1.8]",
                state.activeView === view &&
                  "border-[rgba(137,180,255,0.3)] bg-[rgba(137,180,255,0.12)]",
                collapsed && "h-[26px] w-[26px]",
              )}
            >
              <Icon aria-hidden="true" />
            </span>
            <span
              className={cx(
                "min-w-0 flex-1 truncate text-[0.84rem] tracking-normal",
                collapsed && "hidden",
              )}
            >
              {label}
            </span>
          </button>
        ))}
      </nav>

      <div className="mt-auto" />

      <section
        className={cx(
          "mt-auto flex max-h-[460px] min-h-0 w-full flex-col gap-2.5 overflow-auto rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--panel-subtle)] p-3",
          collapsed && "items-center px-1.5 py-2.5",
        )}
        data-sidebar-runtime
      >
        <div
          className={cx(
            "text-[0.72rem] font-semibold uppercase tracking-normal text-[var(--text-dim)]",
            collapsed && "hidden",
          )}
        >
          Runtime
        </div>
        <div className="flex flex-col gap-2.5">
          <StatusBadge value={runtimeState} />
          <span
            className={cx(
              "text-[0.88rem] leading-[1.45] text-[var(--text-soft)]",
              collapsed && "hidden",
            )}
          >
            {state.snapshot
              ? renderRuntimeHeading(state.snapshot.status)
              : "Waiting for preload bridge"}
          </span>
        </div>
        <div
          className={cx("grid grid-cols-2 gap-[7px]", collapsed && "hidden")}
          data-sidebar-metrics
        >
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
      className={cx(
        "grid min-w-0 gap-[3px] text-[0.78rem] text-[var(--text-soft)]",
        estimatedCost && "relative col-span-full",
      )}
      data-sidebar-metric={estimatedCost ? "cost" : label.toLowerCase()}
      title={exact ? `${label}: ${exact}` : labelCopy}
    >
      <span
        className="inline-flex min-w-0 items-center gap-[5px] text-[var(--text-dim)]"
        data-sidebar-metric-label
      >
        {labelCopy}
        {estimatedCost ? (
          <RadixTooltip.Provider delayDuration={80} skipDelayDuration={0}>
            <RadixTooltip.Root>
              <RadixTooltip.Trigger asChild>
                <button
                  aria-label={ESTIMATED_COST_HELP}
                  className="inline-flex h-[17px] w-[17px] cursor-pointer items-center justify-center rounded-full border border-[rgba(210,224,255,0.2)] bg-[rgba(137,180,255,0.08)] p-0 text-[var(--accent-strong)] outline-none hover:border-[rgba(137,180,255,0.4)] focus-visible:border-[rgba(137,180,255,0.4)] data-[state=delayed-open]:border-[rgba(137,180,255,0.56)] data-[state=delayed-open]:bg-[rgba(137,180,255,0.16)] data-[state=instant-open]:border-[rgba(137,180,255,0.56)] data-[state=instant-open]:bg-[rgba(137,180,255,0.16)] [&_svg]:h-[11px] [&_svg]:w-[11px]"
                  data-cost-popover-trigger="estimated-cost"
                  type="button"
                >
                  <Info aria-hidden="true" />
                </button>
              </RadixTooltip.Trigger>
              <RadixTooltip.Portal>
                <RadixTooltip.Content
                  className="z-[1000] w-[260px] max-w-[min(260px,calc(100vw-36px))] rounded-[10px] border border-[rgba(210,224,255,0.18)] bg-[rgba(8,12,19,0.98)] px-2.5 py-[9px] text-[0.74rem] leading-[1.4] text-[var(--text-soft)] shadow-[0_16px_34px_rgba(0,0,0,0.36)] max-[880px]:w-auto max-[880px]:max-w-[calc(100vw-36px)]"
                  data-cost-popover="estimated-cost"
                  side="right"
                  sideOffset={8}
                >
                  {ESTIMATED_COST_HELP}
                  <RadixTooltip.Arrow className="fill-[rgba(8,12,19,0.98)]" />
                </RadixTooltip.Content>
              </RadixTooltip.Portal>
            </RadixTooltip.Root>
          </RadixTooltip.Provider>
        ) : null}
      </span>
      <strong
        className={cx(
          "text-[0.92rem]",
          estimatedCost
            ? "overflow-visible whitespace-normal [overflow-wrap:anywhere]"
            : "truncate",
        )}
      >
        {formatted.display}
      </strong>
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
    <header
      className="flex min-h-11 items-center justify-between gap-[18px] max-[880px]:flex-col max-[880px]:items-start"
      data-topbar
    >
      <div className="min-w-0">
        <h1 className="m-0 text-[1.58rem] leading-none tracking-normal">{title}</h1>
        {subtitle ? (
          <p className="m-0 mt-[5px] max-w-[76ch] truncate text-[0.82rem] text-[var(--text-dim)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-[7px] max-[880px]:justify-start">
        <StatusBadge value={runtimeState} />
        {status ? (
          <RuntimeActions
            actions={actions}
            runtimeState={status.runtime.state}
            state={state}
          />
        ) : null}
        <Button
          onClick={() => void actions.refreshShell()}
        >
          <RefreshCw aria-hidden="true" />
          {state.refreshing ? "Refreshing..." : "Refresh"}
        </Button>
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
      <Button
        disabled={state.busyAction === "start"}
        onClick={() => void actions.runControlAction("start")}
        variant="primary"
      >
        <Play aria-hidden="true" />
        {state.busyAction === "start" ? "Starting..." : "Start Jin"}
      </Button>
    );
  }

  if (runtimeState === "starting" || runtimeState === "stopping") {
    return null;
  }

  return (
    <>
      <Button
        disabled={state.busyAction === "restart"}
        onClick={() => void actions.runControlAction("restart")}
      >
        <RotateCw aria-hidden="true" />
        {state.busyAction === "restart" ? "Restarting..." : "Restart"}
      </Button>
      <Button
        disabled={state.busyAction === "stop"}
        onClick={() => void actions.runControlAction("stop")}
      >
        <Square aria-hidden="true" />
        {state.busyAction === "stop" ? "Stopping..." : "Stop"}
      </Button>
    </>
  );
}

export function NoticeStack({ state }: { state: RendererState }) {
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
    <div className="grid gap-2">
      {notices.map((notice, index) => (
        <div
          className={cx(
            "rounded-xl border px-3 py-2.5 text-[0.9rem]",
            notice.tone === "warning"
              ? "border-[rgba(240,196,109,0.2)] bg-[rgba(240,196,109,0.08)] text-[#f4d79a]"
              : "border-[rgba(137,180,255,0.16)] bg-[rgba(137,180,255,0.08)] text-[var(--accent-strong)]",
          )}
          key={`${notice.value}-${index}`}
        >
          {notice.value}
        </div>
      ))}
    </div>
  );
}
