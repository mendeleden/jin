import type { ReactNode } from "react";
import type { DesktopRoutingView } from "../../../src/contracts/desktop";
import { RoutingFlowGraph } from "../../graph-components";
import {
  formatNumber,
  formatRouteMatch,
  type RendererState,
} from "../../renderer";
import { RuntimeStateGate } from "../../components/shell/status-panels";
import type { DesktopShellActions } from "../../components/shell/actions";
import { Badge } from "../../ui/badge";
import { cx } from "../../ui/classnames";
import {
  Eyebrow,
  Panel,
  PanelHeader,
  PanelMeta,
  PanelTitle,
} from "../../ui/panel";
import { EmptyState, ListPlaceholder } from "../../ui/primitives";

export function RoutingWorkspace({
  actions,
  state,
}: {
  actions: DesktopShellActions;
  state: RendererState;
}) {
  return (
    <RuntimeStateGate
      actions={actions}
      state={state}
      stopped={{
        description:
          "Start the daemon to inspect how indexed git projects map to active sinks.",
        label: "Routing",
        showRefresh: false,
        title: "Project routing is paused while Jin is stopped.",
      }}
      transition={{
        label: "Routing",
        showRefresh: false,
        startingDescription:
          "Project-to-sink routing will load once the daemon is queryable.",
        stoppingDescription: "Routing inspection is paused until shutdown completes.",
      }}
    >
      {() => <RoutingReadyWorkspace routing={state.routing} state={state} />}
    </RuntimeStateGate>
  );
}

function RoutingReadyWorkspace({
  routing,
  state,
}: {
  routing: DesktopRoutingView | null;
  state: RendererState;
}) {
  if (state.routingLoading && !routing) {
    return (
      <RoutingWorkspaceGrid>
        <RoutingFlowPanel>
          <PanelHeader actions={<PanelMeta>Loading...</PanelMeta>}>
            <Eyebrow>Routing graph</Eyebrow>
            <PanelTitle>Projects -&gt; Sinks</PanelTitle>
          </PanelHeader>
          <ListPlaceholder />
        </RoutingFlowPanel>
      </RoutingWorkspaceGrid>
    );
  }

  if (state.routingError && !routing) {
    return (
      <RoutingWorkspaceGrid>
        <Panel span="wide">
          <EmptyState title="Routing graph unavailable">
            <p>{state.routingError}</p>
          </EmptyState>
        </Panel>
      </RoutingWorkspaceGrid>
    );
  }

  if (!routing || routing.projects.length === 0) {
    return (
      <RoutingWorkspaceGrid>
        <Panel span="wide">
          <EmptyState title="No git projects indexed yet.">
            <p>
              Once Jin ingests conversations with git remotes, this view will
              show which sinks each project routes to.
            </p>
          </EmptyState>
        </Panel>
        {routing ? (
          <>
            <RoutingSinksPanel routing={routing} />
            <RoutingRulesPanel routing={routing} />
          </>
        ) : null}
      </RoutingWorkspaceGrid>
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
    <RoutingWorkspaceGrid>
      <RoutingFlowPanel>
        <PanelHeader actions={<PanelMeta>{routingSummary}</PanelMeta>}>
          <Eyebrow>Routing graph</Eyebrow>
          <PanelTitle>Projects -&gt; Sinks</PanelTitle>
        </PanelHeader>
        <RoutingFlowGraph routing={routing} />
      </RoutingFlowPanel>
      <RoutingSinksPanel routing={routing} />
      <RoutingRulesPanel routing={routing} />
    </RoutingWorkspaceGrid>
  );
}

function RoutingSinksPanel({ routing }: { routing: DesktopRoutingView }) {
  return (
    <Panel className="grid gap-[7px]" span="span">
      <PanelHeader actions={<PanelMeta>{formatNumber(routing.sinks.length)} total</PanelMeta>}>
        <Eyebrow>Destinations</Eyebrow>
        <PanelTitle>Configured sinks</PanelTitle>
      </PanelHeader>
      <div className="grid min-w-0 gap-[7px]">
        {routing.sinks.length > 0 ? (
          routing.sinks.map((sink) => (
            <article
              className="grid gap-[9px] rounded-[11px] border border-[var(--line)] bg-[var(--routing-item-bg)] px-[9px] py-2"
              key={sink.id}
            >
              <div className="flex min-w-0 items-center justify-between gap-2.5">
                <strong className="block truncate text-[0.8rem] text-[var(--text)]">
                  {sink.name || sink.id}
                </strong>
                <Badge tone={sink.enabled ? "success" : "danger"}>
                  {sink.enabled ? "enabled" : "disabled"}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <RoutingMetaPill>{sink.type}</RoutingMetaPill>
                {sink.teamId ? <RoutingMetaPill>team {sink.teamId}</RoutingMetaPill> : null}
                {sink.userId ? <RoutingMetaPill>user {sink.userId}</RoutingMetaPill> : null}
              </div>
            </article>
          ))
        ) : (
          <div className="text-[0.9rem] text-[var(--text-dim)]">No sinks configured.</div>
        )}
      </div>
    </Panel>
  );
}

function RoutingRulesPanel({ routing }: { routing: DesktopRoutingView }) {
  return (
    <Panel className="grid gap-[7px]" span="span">
      <PanelHeader actions={<PanelMeta>{formatNumber(routing.routes.length)} total</PanelMeta>}>
        <Eyebrow>Rules</Eyebrow>
        <PanelTitle>Route rules</PanelTitle>
      </PanelHeader>
      <div className="grid min-w-0 gap-[7px]">
        {routing.routes.length > 0 ? (
          routing.routes.map((route) => (
            <article
              className="grid gap-[9px] rounded-[11px] border border-[var(--line)] bg-[var(--routing-item-bg)] px-[9px] py-2"
              key={route.index}
            >
              <div className="flex min-w-0 items-center justify-between gap-2.5">
                <span className="text-[0.74rem] text-[var(--text-dim)] [font-family:var(--mono)]">
                  #{formatNumber(route.index + 1)}
                </span>
                <strong className="block truncate text-[0.8rem] text-[var(--text)]">
                  {formatRouteMatch(route.match)}
                </strong>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {route.sinkIds.length > 0 ? (
                  route.sinkIds.map((sinkId) => (
                    <RoutingMetaPill key={sinkId}>{sinkId}</RoutingMetaPill>
                  ))
                ) : (
                  <RoutingMetaPill>no sinks</RoutingMetaPill>
                )}
              </div>
            </article>
          ))
        ) : (
          <div className="text-[0.9rem] text-[var(--text-dim)]">No route rules configured.</div>
        )}
      </div>
    </Panel>
  );
}

function RoutingWorkspaceGrid({ children }: { children: ReactNode }) {
  return (
    <section
      className="grid min-h-0 flex-1 auto-rows-max grid-cols-12 content-start gap-3.5 overflow-auto pb-0.5"
      data-routing-workspace
    >
      {children}
    </section>
  );
}

function RoutingFlowPanel({ children }: { children: ReactNode }) {
  return (
    <Panel
      className={cx(
        "flex min-h-0 flex-col overflow-visible",
        "bg-[var(--routing-flow-panel-bg)]",
      )}
      span="wide"
    >
      {children}
    </Panel>
  );
}

function RoutingMetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--routing-pill-border)] bg-[var(--routing-pill-bg)] px-[7px] py-[3px] text-[0.68rem] text-[var(--text-dim)]">
      {children}
    </span>
  );
}
