import { linkHorizontal } from "d3-shape";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  DesktopHomeData,
  DesktopRoutingSinkSummary,
  DesktopRoutingView,
} from "../src/contracts/desktop";

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

export function renderRoutingFlowGraph(routing: DesktopRoutingView): string {
  return renderToStaticMarkup(<RoutingFlowGraph routing={routing} />);
}

export function renderHomeMissionControlGraph(data: DesktopHomeData): string {
  return renderToStaticMarkup(<HomeMissionControlGraph data={data} />);
}

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
    <div className="routing-flow-canvas" data-routing-graph="project-to-sink">
      <svg
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
          className="routing-canvas-bg"
          x="0"
          y="0"
          width={ROUTING_GRAPH_WIDTH}
          height={height}
          rx="18"
        />
        <text className="routing-canvas-label" x={ROUTING_PROJECT_CARD_X} y="30">
          Indexed git projects
        </text>
        <text
          className="routing-canvas-label"
          x={(ROUTING_FLOW_START_X + ROUTING_FLOW_END_X) / 2 - 56}
          y="30"
        >
          Routing flow
        </text>
        <text className="routing-canvas-label" x={ROUTING_SINK_CARD_X} y="30">
          Configured sinks
        </text>

        {projects.flatMap((project, projectIndex) => {
          const startY = projectYs[projectIndex] ?? topPad;
          const flows = project.sinks;

          return flows.map((flow, flowIndex) => {
            return (
              <path
                key={`${project.id}-${flow.sinkId}-${flowIndex}`}
                className="routing-flow-path"
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
              className="routing-project-svg-node"
              data-project-node-id={project.id}
              tabIndex={0}
              aria-label={`${projectLabel} routing details`}
            >
              <title>{tooltipLines.join("\n")}</title>
              <rect
                className="routing-project-label-bg"
                x={ROUTING_PROJECT_CARD_X}
                y={y - ROUTING_PROJECT_LABEL_HEIGHT / 2}
                width={ROUTING_PROJECT_CARD_WIDTH}
                height={ROUTING_PROJECT_LABEL_HEIGHT}
                rx="12"
              />
              <circle
                className={`routing-svg-node-${index % GRAPH_COLOR_COUNT}`}
                cx={ROUTING_PROJECT_NODE_X}
                cy={y}
                r="17"
                filter="url(#routing-glow)"
              />
              <foreignObject
                className="routing-node-label-object"
                x={ROUTING_PROJECT_TEXT_X}
                y={y - ROUTING_PROJECT_LABEL_HEIGHT / 2 + 10}
                width={ROUTING_PROJECT_LABEL_WIDTH}
                height={ROUTING_PROJECT_LABEL_HEIGHT - 18}
                data-project-label-width={ROUTING_PROJECT_LABEL_WIDTH}
                data-label-truncated={String(projectLabelTruncated)}
              >
                <div className="routing-node-label-copy">
                  <div className="routing-node-label-title">
                    {projectVisibleLabel}
                  </div>
                  <div className="routing-node-label-meta">
                    {formatRoutingProjectInlineMeta(project)}
                  </div>
                </div>
              </foreignObject>
              <foreignObject
                className="routing-project-tooltip"
                x={ROUTING_FLOW_START_X + 14}
                y={tooltipY}
                width={ROUTING_PROJECT_TOOLTIP_WIDTH}
                height={tooltipHeight}
                aria-hidden="true"
              >
                <div className="routing-project-tooltip-card">
                  {tooltipLines.map((line, lineIndex) => (
                    <div
                      key={`${project.id}-tooltip-${lineIndex}`}
                      className={
                        lineIndex === 0
                          ? "routing-project-tooltip-line routing-tooltip-title"
                          : "routing-project-tooltip-line"
                      }
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
              className={`routing-sink-svg-node ${sink.enabled ? "" : "disabled"}`}
              data-sink-node-id={sink.id}
              tabIndex={0}
              aria-label={`${sinkLabel} sink details`}
            >
              <title>{tooltipLines.join("\n")}</title>
              <rect
                className="routing-sink-label-bg"
                x={ROUTING_SINK_CARD_X}
                y={y - ROUTING_SINK_LABEL_HEIGHT / 2}
                width={ROUTING_SINK_CARD_WIDTH}
                height={ROUTING_SINK_LABEL_HEIGHT}
                rx="14"
              />
              <circle cx={ROUTING_SINK_NODE_X} cy={y} r="9" />
              <foreignObject
                className="routing-node-label-object"
                x={ROUTING_SINK_TEXT_X}
                y={y - ROUTING_SINK_LABEL_HEIGHT / 2 + 9}
                width={ROUTING_SINK_LABEL_WIDTH}
                height={ROUTING_SINK_LABEL_HEIGHT - 16}
                data-sink-label-width={ROUTING_SINK_LABEL_WIDTH}
                data-label-truncated={String(sinkLabelTruncated)}
              >
                <div className="routing-node-label-copy">
                  <div className="routing-node-label-title">
                    {sinkVisibleLabel}
                  </div>
                  <div className="routing-node-label-meta">
                    {sink.type}
                  </div>
                </div>
              </foreignObject>
              <foreignObject
                className="routing-sink-tooltip"
                x={ROUTING_SINK_CARD_X - ROUTING_SINK_TOOLTIP_WIDTH - 18}
                y={tooltipY}
                width={ROUTING_SINK_TOOLTIP_WIDTH}
                height={tooltipHeight}
                aria-hidden="true"
              >
                <div className="routing-project-tooltip-card">
                  {tooltipLines.map((line, lineIndex) => (
                    <div
                      key={`${sink.id}-tooltip-${lineIndex}`}
                      className={
                        lineIndex === 0
                          ? "routing-project-tooltip-line routing-tooltip-title"
                          : "routing-project-tooltip-line"
                      }
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
      <div className="routing-flow-legend">
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
      <section className="compact-panel compact-panel-wide mission-control-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Mission Control</span>
            <h2>Conversation Flow</h2>
          </div>
          <span className="panel-meta">Waiting for indexed project data</span>
        </div>
        <div className="empty-row">
          Ingest conversations with git remotes to populate the flow graph.
        </div>
      </section>
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
    <section className="compact-panel compact-panel-wide mission-control-panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Mission Control</span>
          <h2>Conversation Flow</h2>
        </div>
        <span className="panel-meta">Projects -&gt; adapters -&gt; trace shape</span>
      </div>
      <div className="home-flow-canvas" data-home-flow-graph="mission-control">
        <svg
          className="home-flow-svg"
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
            className="home-flow-bg"
            x="0"
            y="0"
            width={HOME_GRAPH_WIDTH}
            height={HOME_GRAPH_HEIGHT}
            rx="18"
          />
          <text className="home-flow-label" x={projectX} y="34">
            Git projects
          </text>
          <text className="home-flow-label" x={adapterX} y="34">
            Adapters
          </text>
          <text className="home-flow-label" x={relationshipX} y="34">
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
                className="home-flow-path"
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
                  className="home-flow-path secondary"
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
              <g key={project.id} className="home-flow-node">
                <circle
                  className={`routing-svg-node-${index % GRAPH_COLOR_COUNT}`}
                  cx={projectX}
                  cy={y}
                  r="18"
                  filter="url(#home-flow-glow)"
                />
                <text className="home-flow-title" x={projectX + 36} y={y - 8}>
                  {truncateMiddle(project.name, 34)}
                </text>
                <text className="home-flow-meta" x={projectX + 36} y={y + 13}>
                  {`${formatNumber(project.conversationCount)} conv - ${formatMetricNumber(project.totalTokens).display} tokens`}
                </text>
              </g>
            );
          })}

          {adapters.map((adapter, index) => {
            const y = adapterYs[index] ?? 80;
            return (
              <g key={adapter.adapterId} className="home-flow-node adapter">
                <circle
                  className={`routing-svg-node-${(index + 1) % GRAPH_COLOR_COUNT}`}
                  cx={adapterX}
                  cy={y}
                  r="16"
                  filter="url(#home-flow-glow)"
                />
                <text className="home-flow-title" x={adapterX + 34} y={y - 7}>
                  {adapter.adapterId}
                </text>
                <text className="home-flow-meta" x={adapterX + 34} y={y + 13}>
                  {`${formatNumber(adapter.conversations)} conv - ${formatCost(adapter.cost)}`}
                </text>
              </g>
            );
          })}

          {relationships.map((relationship, index) => {
            const y = relationshipYs[index] ?? 90;
            return (
              <g key={`${relationship.relationship}-${index}`} className="home-flow-node relationship">
                <rect x={relationshipX - 16} y={y - 22} width="164" height="44" rx="14" />
                <circle
                  className={`routing-svg-node-${(index + 2) % GRAPH_COLOR_COUNT}`}
                  cx={relationshipX}
                  cy={y}
                  r="9"
                />
                <text className="home-flow-title" x={relationshipX + 26} y={y - 6}>
                  {relationship.relationship}
                </text>
                <text className="home-flow-meta" x={relationshipX + 26} y={y + 13}>
                  {`${formatNumber(relationship.conversations)} conversations`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
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
