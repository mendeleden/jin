import type { ReactNode } from "react";
import { linkHorizontal } from "d3-shape";
import type {
  DesktopHomeData,
  DesktopRoutingSinkSummary,
  DesktopRoutingView,
} from "../src/contracts/desktop";
import { cx } from "./ui/classnames";
import {
  Eyebrow,
  Panel,
  PanelHeader,
  PanelMeta,
  PanelTitle,
} from "./ui/panel";

const GRAPH_COLOR_COUNT = 6;
const ROUTING_GRAPH_WIDTH = 1280;
const ROUTING_LANE_OUTER_PADDING = 54;
const ROUTING_PROJECT_CARD_X = 68;
const ROUTING_PROJECT_CARD_WIDTH = 398;
const ROUTING_PROJECT_LABEL_WIDTH = 326;
const ROUTING_PROJECT_LABEL_HEIGHT = 62;
const ROUTING_PROJECT_NODE_X = ROUTING_PROJECT_CARD_X + 24;
const ROUTING_PROJECT_TEXT_X = ROUTING_PROJECT_CARD_X + 56;
const ROUTING_FLOW_START_X =
  ROUTING_PROJECT_CARD_X + ROUTING_PROJECT_CARD_WIDTH + 34;
const ROUTING_PROJECT_TOOLTIP_WIDTH = 420;
const ROUTING_PROJECT_TOOLTIP_LINE_HEIGHT = 18;
const ROUTING_PROJECT_TOOLTIP_VERTICAL_PADDING = 24;
const ROUTING_SINK_LABEL_WIDTH = 254;
const ROUTING_SINK_LABEL_HEIGHT = 58;
const ROUTING_SINK_CARD_WIDTH = ROUTING_SINK_LABEL_WIDTH + 68;
const ROUTING_SINK_CARD_X =
  ROUTING_GRAPH_WIDTH - ROUTING_LANE_OUTER_PADDING - ROUTING_SINK_CARD_WIDTH;
const ROUTING_SINK_NODE_X = ROUTING_SINK_CARD_X + 24;
const ROUTING_SINK_TEXT_X = ROUTING_SINK_CARD_X + 54;
const ROUTING_FLOW_END_X = ROUTING_SINK_CARD_X - 34;
const ROUTING_SINK_TOOLTIP_WIDTH = 390;
const ROUTING_SINK_TOOLTIP_LINE_HEIGHT = 18;
const ROUTING_SINK_TOOLTIP_VERTICAL_PADDING = 24;
const ROUTING_FLOW_STROKE_WIDTH = 4;
const HOME_GRAPH_WIDTH = 1180;
const HOME_GRAPH_HEIGHT = 390;

type Point = [number, number];
type FlowLink = {
  source: Point;
  target: Point;
};

const horizontalFlow = linkHorizontal<FlowLink, Point>()
  .x((point) => point[0])
  .y((point) => point[1]);

export function RoutingFlowGraph({
  routing,
}: {
  routing: DesktopRoutingView;
}) {
  const projects = routing.projects;
  const sinkNodes = buildRoutingSinkNodes(routing);
  const topPad = 62;
  const bottomPad = 54;
  const rowHeight = 84;
  const height = Math.max(
    380,
    topPad + bottomPad + Math.max(projects.length, sinkNodes.length, 2) * rowHeight,
  );
  const projectYs = distributeYs(projects.length, topPad, height - bottomPad);
  const sinkYs = distributeYs(sinkNodes.length, topPad, height - bottomPad);
  const sinkById = new Map(sinkNodes.map((sink) => [sink.id, sink]));
  const sinkYById = new Map(
    sinkNodes.map((sink, index) => [sink.id, sinkYs[index] ?? topPad]),
  );
  return (
    <div
      className="min-h-[306px] min-w-0 flex-1 overflow-auto rounded-xl border border-[rgba(210,224,255,0.09)] bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.012)),rgba(5,8,13,0.52)]"
      data-routing-graph="project-to-sink"
    >
      <svg
        className="block h-auto w-full min-w-[1040px]"
        viewBox={`0 0 ${ROUTING_GRAPH_WIDTH} ${height}`}
        role="img"
        aria-label="Project to sink routing flow graph"
      >
        <defs>
          <filter id="routing-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect
          className="fill-[rgba(255,255,255,0.018)] stroke-[rgba(210,224,255,0.06)]"
          x="0"
          y="0"
          width={ROUTING_GRAPH_WIDTH}
          height={height}
          rx="18"
        />
        <text className="fill-[var(--text-dim)] text-[13px] uppercase tracking-normal [font-family:var(--mono)]" x={ROUTING_PROJECT_CARD_X} y="30">
          Indexed git projects
        </text>
        <text
          className="fill-[var(--text-dim)] text-[13px] uppercase tracking-normal [font-family:var(--mono)]"
          x={(ROUTING_FLOW_START_X + ROUTING_FLOW_END_X) / 2 - 56}
          y="30"
        >
          Routing flow
        </text>
        <text className="fill-[var(--text-dim)] text-[13px] uppercase tracking-normal [font-family:var(--mono)]" x={ROUTING_SINK_CARD_X} y="30">
          Configured sinks
        </text>

        {projects.flatMap((project, projectIndex) => {
          const startY = projectYs[projectIndex] ?? topPad;
          const flows = project.sinks;

          return flows.map((flow, flowIndex) => {
            return (
              <path
                key={`${project.id}-${flow.sinkId}-${flowIndex}`}
                className="fill-none stroke-[rgba(137,180,255,0.58)] opacity-[0.82] [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]"
                data-routing-flow-path
                d={flowPath(
                  [ROUTING_FLOW_START_X, startY],
                  [
                    ROUTING_FLOW_END_X,
                    sinkYById.get(flow.sinkId) ?? startY,
                  ],
                )}
                strokeWidth={ROUTING_FLOW_STROKE_WIDTH}
              />
            );
          });
        })}

        {projects.map((project, index) => {
          const y = projectYs[index] ?? topPad;
          const projectLabel = formatRoutingProjectLabel(project);
          const projectVisibleLabel = formatVisibleRoutingLabel(projectLabel, 40);
          const projectLabelTruncated = projectVisibleLabel !== projectLabel;
          const tooltipLines = formatRoutingProjectTooltipLines(project, sinkById);
          const tooltipHeight =
            tooltipLines.length * ROUTING_PROJECT_TOOLTIP_LINE_HEIGHT +
            ROUTING_PROJECT_TOOLTIP_VERTICAL_PADDING;
          const tooltipY = clamp(
            y - tooltipHeight / 2,
            42,
            height - tooltipHeight - 18,
          );
          return (
            <g
              key={project.id}
              className="group outline-none"
              data-project-node-id={project.id}
              tabIndex={0}
              aria-label={`${projectLabel} routing details`}
            >
              <title>{tooltipLines.join("\n")}</title>
              <rect
                className="fill-[rgba(255,255,255,0.038)] stroke-[rgba(210,224,255,0.12)] transition-colors group-focus:fill-[rgba(137,180,255,0.08)] group-focus:stroke-[rgba(137,180,255,0.24)] group-hover:fill-[rgba(137,180,255,0.08)] group-hover:stroke-[rgba(137,180,255,0.24)]"
                x={ROUTING_PROJECT_CARD_X}
                y={y - ROUTING_PROJECT_LABEL_HEIGHT / 2}
                width={ROUTING_PROJECT_CARD_WIDTH}
                height={ROUTING_PROJECT_LABEL_HEIGHT}
                rx="12"
              />
              <circle
                className={cx(graphFillClass(index), "stroke-[rgba(7,9,15,0.82)] stroke-2")}
                cx={ROUTING_PROJECT_NODE_X}
                cy={y}
                r="17"
                filter="url(#routing-glow)"
              />
              <foreignObject
                className="overflow-hidden"
                x={ROUTING_PROJECT_TEXT_X}
                y={y - ROUTING_PROJECT_LABEL_HEIGHT / 2 + 10}
                width={ROUTING_PROJECT_LABEL_WIDTH}
                height={ROUTING_PROJECT_LABEL_HEIGHT - 18}
                data-project-label-width={ROUTING_PROJECT_LABEL_WIDTH}
                data-label-truncated={String(projectLabelTruncated)}
              >
                <div className="grid h-full w-full min-w-0 content-center gap-[3px] overflow-hidden">
                  <div className="min-w-0 truncate text-[0.92rem] font-semibold leading-[1.2] text-[var(--text)]">
                    {projectVisibleLabel}
                  </div>
                  <div className="min-w-0 truncate text-[0.72rem] leading-[1.2] text-[var(--text-dim)]">
                    {formatRoutingProjectInlineMeta(project)}
                  </div>
                </div>
              </foreignObject>
              <foreignObject
                className="pointer-events-none opacity-0 transition-opacity group-focus:opacity-100 group-hover:opacity-100"
                x={ROUTING_FLOW_START_X + 14}
                y={tooltipY}
                width={ROUTING_PROJECT_TOOLTIP_WIDTH}
                height={tooltipHeight}
                aria-hidden="true"
              >
                <div className="min-h-full w-full rounded-xl border border-[rgba(210,224,255,0.18)] bg-[rgba(8,12,19,0.97)] px-[13px] py-[11px] text-[0.72rem] leading-[1.35] text-[var(--text-soft)] shadow-[0_18px_38px_rgba(0,0,0,0.38)] [overflow-wrap:anywhere]">
                  {tooltipLines.map((line, lineIndex) => (
                    <div
                      key={`${project.id}-tooltip-${lineIndex}`}
                      className={cx(lineIndex > 0 && "mt-1", lineIndex === 0 && "font-semibold text-[var(--text)]")}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </foreignObject>
            </g>
          );
        })}

        {sinkNodes.map((sink, index) => {
          const y = sinkYs[index] ?? topPad;
          const sinkLabel = formatRoutingSinkLabel(sink);
          const sinkVisibleLabel = formatVisibleRoutingLabel(sinkLabel, 28);
          const sinkLabelTruncated = sinkVisibleLabel !== sinkLabel;
          const tooltipLines = formatRoutingSinkTooltipLines(sink);
          const tooltipHeight =
            tooltipLines.length * ROUTING_SINK_TOOLTIP_LINE_HEIGHT +
            ROUTING_SINK_TOOLTIP_VERTICAL_PADDING;
          const tooltipY = clamp(
            y - tooltipHeight / 2,
            42,
            height - tooltipHeight - 18,
          );
          return (
            <g
              key={sink.id}
              className={cx("group outline-none", !sink.enabled && "opacity-[0.62]")}
              data-sink-node-id={sink.id}
              tabIndex={0}
              aria-label={`${sinkLabel} sink details`}
            >
              <title>{tooltipLines.join("\n")}</title>
              <rect
                className="fill-[rgba(255,255,255,0.038)] stroke-[rgba(210,224,255,0.12)] transition-colors group-focus:fill-[rgba(137,180,255,0.08)] group-focus:stroke-[rgba(137,180,255,0.24)] group-hover:fill-[rgba(137,180,255,0.08)] group-hover:stroke-[rgba(137,180,255,0.24)]"
                x={ROUTING_SINK_CARD_X}
                y={y - ROUTING_SINK_LABEL_HEIGHT / 2}
                width={ROUTING_SINK_CARD_WIDTH}
                height={ROUTING_SINK_LABEL_HEIGHT}
                rx="14"
              />
              <circle
                className={cx(sink.enabled ? "fill-[var(--success)]" : "fill-[var(--warning)]")}
                cx={ROUTING_SINK_NODE_X}
                cy={y}
                r="9"
              />
              <foreignObject
                className="overflow-hidden"
                x={ROUTING_SINK_TEXT_X}
                y={y - ROUTING_SINK_LABEL_HEIGHT / 2 + 9}
                width={ROUTING_SINK_LABEL_WIDTH}
                height={ROUTING_SINK_LABEL_HEIGHT - 16}
                data-sink-label-width={ROUTING_SINK_LABEL_WIDTH}
                data-label-truncated={String(sinkLabelTruncated)}
              >
                <div className="grid h-full w-full min-w-0 content-center gap-[3px] overflow-hidden">
                  <div className="min-w-0 truncate text-[0.92rem] font-semibold leading-[1.2] text-[var(--text)]">
                    {sinkVisibleLabel}
                  </div>
                  <div className="min-w-0 truncate text-[0.72rem] leading-[1.2] text-[var(--text-dim)]">
                    {sink.type}
                  </div>
                </div>
              </foreignObject>
              <foreignObject
                className="pointer-events-none opacity-0 transition-opacity group-focus:opacity-100 group-hover:opacity-100"
                x={ROUTING_SINK_CARD_X - ROUTING_SINK_TOOLTIP_WIDTH - 18}
                y={tooltipY}
                width={ROUTING_SINK_TOOLTIP_WIDTH}
                height={tooltipHeight}
                aria-hidden="true"
              >
                <div className="min-h-full w-full rounded-xl border border-[rgba(210,224,255,0.18)] bg-[rgba(8,12,19,0.97)] px-[13px] py-[11px] text-[0.72rem] leading-[1.35] text-[var(--text-soft)] shadow-[0_18px_38px_rgba(0,0,0,0.38)] [overflow-wrap:anywhere]">
                  {tooltipLines.map((line, lineIndex) => (
                    <div
                      key={`${sink.id}-tooltip-${lineIndex}`}
                      className={cx(lineIndex > 0 && "mt-1", lineIndex === 0 && "font-semibold text-[var(--text)]")}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-3.5 gap-y-2 border-t border-[rgba(210,224,255,0.08)] px-3 py-2.5 text-[0.78rem] text-[var(--text-dim)]">
        <span>Solid blue = routed sink path</span>
        <span>Local-only conversations stay in project cards</span>
        <span>Left = indexed git project</span>
        <span>Right = one node per configured sink</span>
      </div>
    </div>
  );
}

export function HomeMissionControlGraph({
  data,
}: {
  data: DesktopHomeData;
}) {
  const projects = data.topProjects.slice(0, 5);
  const adapters = data.topAdapters.slice(0, 5);
  const relationshipFallback: DesktopHomeData["relationshipMix"][number] = {
    relationship: "root",
    conversations: data.overview.conversations,
  };
  const relationships =
    data.relationshipMix.length > 0
      ? data.relationshipMix.slice(0, 4)
      : [relationshipFallback];

  if (projects.length === 0 || adapters.length === 0) {
    return (
      <MissionControlPanel
        meta={<PanelMeta>Waiting for indexed project data</PanelMeta>}
      >
        <div className="text-[0.9rem] text-[var(--text-dim)]">
          Ingest conversations with git remotes to populate the flow graph.
        </div>
      </MissionControlPanel>
    );
  }

  const projectX = 86;
  const adapterX = 548;
  const relationshipX = 952;
  const projectYs = distributeYs(projects.length, 82, HOME_GRAPH_HEIGHT - 72);
  const adapterYs = distributeYs(adapters.length, 84, HOME_GRAPH_HEIGHT - 82);
  const relationshipYs = distributeYs(
    relationships.length,
    98,
    HOME_GRAPH_HEIGHT - 96,
  );
  const adapterIndex = new Map(
    adapters.map((adapter, index) => [adapter.adapterId, index]),
  );
  const maxProjectConversations = Math.max(
    ...projects.map((project) => project.conversationCount),
    1,
  );
  const maxRelationshipConversations = Math.max(
    ...relationships.map((relationship) => relationship.conversations),
    1,
  );

  return (
    <MissionControlPanel
      meta={<PanelMeta>Projects -&gt; adapters -&gt; trace shape</PanelMeta>}
    >
      <div
        className="min-h-[306px] min-w-0 flex-1 overflow-auto rounded-xl border border-[rgba(210,224,255,0.09)] bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.012)),rgba(5,8,13,0.52)]"
        data-home-flow-graph="mission-control"
      >
        <svg
          className="block h-[322px] min-h-[322px] w-full min-w-full"
          viewBox={`0 0 ${HOME_GRAPH_WIDTH} ${HOME_GRAPH_HEIGHT}`}
          role="img"
          aria-label="Conversation flow from git projects to adapters and trace relationships"
        >
          <defs>
            <filter id="home-flow-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect
            className="fill-[rgba(255,255,255,0.018)] stroke-[rgba(210,224,255,0.06)]"
            x="0"
            y="0"
            width={HOME_GRAPH_WIDTH}
            height={HOME_GRAPH_HEIGHT}
            rx="18"
          />
          <text className="fill-[var(--text-dim)] text-[13px] uppercase tracking-normal [font-family:var(--mono)]" x={projectX} y="34">
            Git projects
          </text>
          <text className="fill-[var(--text-dim)] text-[13px] uppercase tracking-normal [font-family:var(--mono)]" x={adapterX} y="34">
            Adapters
          </text>
          <text className="fill-[var(--text-dim)] text-[13px] uppercase tracking-normal [font-family:var(--mono)]" x={relationshipX} y="34">
            Trace shape
          </text>

          {projects.map((project, projectIndex) => {
            const sourceY = projectYs[projectIndex] ?? 80;
            const adapterId = project.adapters[0] ?? adapters[0]?.adapterId ?? "";
            const targetIndex = adapterIndex.get(adapterId) ?? 0;
            const targetY = adapterYs[targetIndex] ?? 80;
            const strokeWidth = flowStrokeWidth(
              project.conversationCount,
              maxProjectConversations,
            );
            return (
              <path
                key={`${project.id}-adapter-flow`}
                className="fill-none stroke-[rgba(137,180,255,0.58)] opacity-[0.82] [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]"
                d={flowPath([projectX + 34, sourceY], [adapterX - 38, targetY])}
                strokeWidth={strokeWidth}
              />
            );
          })}

          {adapters.flatMap((adapter, adapterIndex_) => {
            const sourceY = adapterYs[adapterIndex_] ?? 80;
            return relationships.map((relationship, relationshipIndex) => {
              const targetY = relationshipYs[relationshipIndex] ?? 90;
              const strokeWidth = flowStrokeWidth(
                relationship.conversations,
                maxRelationshipConversations,
              );
              return (
                <path
                  key={`${adapter.adapterId}-${relationship.relationship}-${relationshipIndex}`}
                  className="fill-none stroke-[rgba(137,212,161,0.52)] opacity-[0.82] [stroke-linecap:round] [stroke-linejoin:round] [vector-effect:non-scaling-stroke]"
                  d={flowPath(
                    [adapterX + 34, sourceY],
                    [relationshipX - 38, targetY],
                  )}
                  strokeWidth={strokeWidth}
                />
              );
            });
          })}

          {projects.map((project, index) => {
            const y = projectYs[index] ?? 80;
            return (
              <g key={project.id}>
                <title>{project.name}</title>
                <circle
                  className={cx(graphFillClass(index), "stroke-[rgba(7,9,15,0.82)] stroke-2")}
                  cx={projectX}
                  cy={y}
                  r="18"
                  filter="url(#home-flow-glow)"
                />
                <text className="fill-[var(--text)] text-base font-semibold" x={projectX + 36} y={y - 8}>
                  {truncateMiddle(compactRemoteLabel(project.name), 32)}
                </text>
                <text className="fill-[var(--text-dim)] text-[12.5px]" x={projectX + 36} y={y + 13}>
                  {`${formatNumber(project.conversationCount)} conv - ${formatMetricNumber(project.totalTokens).display} tokens`}
                </text>
              </g>
            );
          })}

          {adapters.map((adapter, index) => {
            const y = adapterYs[index] ?? 80;
            return (
              <g key={adapter.adapterId}>
                <circle
                  className={cx(graphFillClass(index + 1), "stroke-[rgba(7,9,15,0.82)] stroke-2")}
                  cx={adapterX}
                  cy={y}
                  r="16"
                  filter="url(#home-flow-glow)"
                />
                <text className="fill-[var(--text)] text-base font-semibold" x={adapterX + 34} y={y - 7}>
                  {adapter.adapterId}
                </text>
                <text className="fill-[var(--text-dim)] text-[12.5px]" x={adapterX + 34} y={y + 13}>
                  {`${formatNumber(adapter.conversations)} conv - ${formatCost(adapter.cost)}`}
                </text>
              </g>
            );
          })}

          {relationships.map((relationship, index) => {
            const y = relationshipYs[index] ?? 90;
            return (
              <g key={`${relationship.relationship}-${index}`}>
                <rect
                  className="fill-[rgba(255,255,255,0.035)] stroke-[rgba(210,224,255,0.15)]"
                  x={relationshipX - 16}
                  y={y - 22}
                  width="164"
                  height="44"
                  rx="14"
                />
                <circle
                  className={graphFillClass(index + 2)}
                  cx={relationshipX}
                  cy={y}
                  r="9"
                />
                <text className="fill-[var(--text)] text-base font-semibold" x={relationshipX + 26} y={y - 6}>
                  {relationship.relationship}
                </text>
                <text className="fill-[var(--text-dim)] text-[12.5px]" x={relationshipX + 26} y={y + 13}>
                  {`${formatNumber(relationship.conversations)} conversations`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </MissionControlPanel>
  );
}

function MissionControlPanel({
  children,
  meta,
}: {
  children: ReactNode;
  meta: ReactNode;
}) {
  return (
    <Panel
      className="flex min-h-[382px] flex-col overflow-hidden bg-[radial-gradient(circle_at_18%_2%,rgba(137,180,255,0.12),transparent_32%),linear-gradient(180deg,rgba(14,20,31,0.94),rgba(8,12,18,0.94)),rgba(255,255,255,0.02)]"
      span="wide"
    >
      <PanelHeader actions={meta}>
        <Eyebrow>Mission Control</Eyebrow>
        <PanelTitle>Conversation Flow</PanelTitle>
      </PanelHeader>
      {children}
    </Panel>
  );
}

function graphFillClass(index: number): string {
  const classes = [
    "fill-[#89d4a1]",
    "fill-[#89b4ff]",
    "fill-[#f0c46d]",
    "fill-[#ff8f84]",
    "fill-[#a8d8ea]",
    "fill-[#d6b3ff]",
  ] as const;

  return classes[index % GRAPH_COLOR_COUNT] ?? classes[0];
}

function buildRoutingSinkNodes(
  routing: DesktopRoutingView,
): DesktopRoutingSinkSummary[] {
  const sinksById = new Map(routing.sinks.map((sink) => [sink.id, sink]));
  const unknownSinkIds = Array.from(
    new Set(
      routing.projects.flatMap((project) =>
        project.sinks.map((flow) => flow.sinkId),
      ),
    ),
  )
    .filter((sinkId) => sinkId.length > 0 && !sinksById.has(sinkId))
    .sort((left, right) => left.localeCompare(right));

  return [
    ...routing.sinks,
    ...unknownSinkIds.map((sinkId) => ({
      id: sinkId,
      type: "webhook" as const,
      enabled: false,
      name: sinkId,
      teamId: "",
      userId: "",
    })),
  ];
}

function flowPath(source: Point, target: Point): string {
  return (
    horizontalFlow({ source, target }) ??
    `M ${source[0]} ${source[1]} L ${target[0]} ${target[1]}`
  );
}

function formatRoutingProjectInlineMeta(
  project: DesktopRoutingView["projects"][number],
): string {
  const routed = `${formatNumber(project.routedConversations)} routed`;
  if (project.unroutedConversations <= 0) {
    return routed;
  }

  return `${routed}, ${formatNumber(project.unroutedConversations)} local only`;
}

function formatRoutingProjectLabel(
  project: DesktopRoutingView["projects"][number],
): string {
  return compactRemoteLabel(project.gitRemote || project.name || project.id);
}

function formatRoutingProjectTooltipLines(
  project: DesktopRoutingView["projects"][number],
  sinkById: Map<string, DesktopRoutingSinkSummary>,
): string[] {
  const adapters =
    project.adapters.length > 0 ? project.adapters.join(", ") : "none";
  const sinkTargets =
    project.sinks.length > 0
      ? project.sinks
          .map((flow) => {
            const sink = sinkById.get(flow.sinkId);
            const sinkLabel = sink?.name || sink?.id || flow.sinkId;
            const sinkType = sink ? ` (${sink.type})` : "";
            const activeState = flow.active ? "active" : "inactive";
            return `${sinkLabel}${sinkType}: ${formatNumber(
              flow.routedConversations,
            )} routed, ${activeState}`;
          })
          .join("; ")
      : "none";
  const localOnly =
    project.unroutedConversations > 0
      ? `; local only: ${formatNumber(project.unroutedConversations)}`
      : "";

  return [
    `Project: ${formatRoutingProjectLabel(project)}`,
    `Remote: ${formatFullRemote(project)}`,
    `Conversations: ${formatNumber(project.routedConversations)} routed / ${formatNumber(
      project.conversationCount,
    )} total`,
    `Tokens: ${formatNumber(project.totalTokens)}`,
    `Adapters: ${adapters}`,
    `Sink targets: ${sinkTargets}${localOnly}`,
  ];
}

function formatRoutingSinkLabel(sink: DesktopRoutingSinkSummary): string {
  const label = (sink.name || sink.id).trim();
  return label || "unknown sink";
}

function formatRoutingSinkTooltipLines(sink: DesktopRoutingSinkSummary): string[] {
  const ownerParts = [sink.teamId, sink.userId].filter(Boolean);
  const owner = ownerParts.length > 0 ? ownerParts.join(" / ") : "not set";
  return [
    `Sink: ${formatRoutingSinkLabel(sink)}`,
    `ID: ${sink.id}`,
    `Type: ${sink.type}`,
    `State: ${sink.enabled ? "enabled" : "disabled"}`,
    `Owner: ${owner}`,
  ];
}

function formatVisibleRoutingLabel(value: string, maxLength: number): string {
  return truncateMiddle(value, maxLength);
}

function compactRemoteLabel(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "unknown project";
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

function formatFullRemote(
  project: DesktopRoutingView["projects"][number],
): string {
  const remote = (project.gitRemote || project.name || project.id).trim();
  if (!remote) {
    return "unknown";
  }

  if (/^github\.com\//i.test(remote)) {
    return `https://${remote}`;
  }

  const githubSshMatch = /^git@github\.com:(.+)$/i.exec(remote);
  if (githubSshMatch?.[1]) {
    return `ssh://git@github.com/${githubSshMatch[1]}`;
  }

  return remote;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function distributeYs(count: number, start: number, end: number): number[] {
  if (count <= 0) {
    return [];
  }

  if (count === 1) {
    return [(start + end) / 2];
  }

  return Array.from({ length: count }, (_entry, index) => {
    return start + ((end - start) * index) / (count - 1);
  });
}

function flowStrokeWidth(value: number, maxValue: number): string {
  return String(
    Math.max(1.6, Math.min(7, 1.6 + (value / Math.max(maxValue, 1)) * 5.4)),
  );
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const visible = Math.max(maxLength - 3, 4);
  const head = Math.ceil(visible * 0.62);
  const tail = visible - head;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function formatMetricNumber(value: number): { display: string; exact?: string } {
  const exact = formatNumber(value);
  if (Math.abs(value) < 10_000) {
    return { display: exact };
  }

  return {
    display: new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value),
    exact,
  };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCost(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
