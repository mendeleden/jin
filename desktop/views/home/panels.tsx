import { useState } from "react";
import type { DesktopHomeData } from "../../../src/contracts/desktop";
import { formatDate } from "../../renderer";
import { cx } from "../../ui/classnames";
import {
  Eyebrow,
  Panel,
  PanelHeader,
  PanelTitle,
} from "../../ui/panel";
import { EmptyState } from "../../ui/primitives";
import { formatProjectReference } from "../../ui/project-reference";
import {
  buildUsageChartModel,
  buildWindowedUsageChart,
  formatUsageDisplayDay,
  type HomeBreakdownMetric,
  type UsageChartPeriod,
} from "./usage-chart-model";
import type { HomePanelLayoutContext } from "./layout";
import {
  HomeMetricToggle,
  TokenUsageChart,
  formatHomeMetricValue,
} from "./token-usage-chart";
import {
  usageColorClass,
  usageHeightClass,
  usageWidthClass,
} from "./usage-visuals";

export function HomePulsePanel({
  data,
  panel,
}: {
  data: DesktopHomeData;
  panel: HomePanelLayoutContext;
}) {
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
    <Panel
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--home-usage-panel-bg)]"
      data-home-panel-density={panel.density}
      data-home-panel-height={panel.height}
      data-home-panel-stack-below={String(panel.stackedBelowPx)}
      data-home-panel-width={panel.width}
      span="none"
    >
      <TokenUsageChart
        chart={windowedChart}
        monthlyAvailable={monthlyAvailable}
        onNextWindow={() => setWindowOffset((current) => Math.max(0, current - 1))}
        onPeriodChange={(nextPeriod) => {
          setPeriod(nextPeriod);
          setWindowOffset(0);
        }}
        onPreviousWindow={() => setWindowOffset((current) => current + 1)}
        panel={panel}
      />
    </Panel>
  );
}

export function HomeProjectActivityPanel({
  data,
  panel,
}: {
  data: DesktopHomeData;
  panel: HomePanelLayoutContext;
}) {
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
  const visibleProjectCount = homePanelItemLimit(panel, {
    compact: 3,
    expanded: 10,
    standard: 5,
  });
  const showProjectMeta = panel.density !== "compact";

  return (
    <Panel
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--home-project-panel-bg)]"
      data-home-panel-density={panel.density}
      data-home-panel-height={panel.height}
      data-home-panel-stack-below={String(panel.stackedBelowPx)}
      data-home-panel-width={panel.width}
      span="none"
    >
      <PanelHeader
        actions={
          <HomeMetricToggle
            compact={panel.density === "compact"}
            metric={metric}
            onChange={setMetric}
          />
        }
        className={cx(
          "max-[1220px]:flex-col max-[1220px]:items-start",
          panel.density === "compact" && "mb-2 gap-2",
        )}
      >
        <Eyebrow>Projects</Eyebrow>
        <PanelTitle>Project Stacks</PanelTitle>
      </PanelHeader>
      <div
        className={cx(
          "grid min-h-0 gap-2",
          panel.height === "tall" ? "overflow-auto pr-1" : "overflow-hidden",
        )}
        data-home-panel-visible-items={String(visibleProjectCount)}
      >
        {projects.length > 0 ? (
          projects.slice(0, visibleProjectCount).map((project) => {
            const total = projectMetricValue(project, metric);
            return (
              <article
                className={cx(
                  "min-w-0 rounded-xl border border-[var(--control-border-subtle)] bg-[var(--item-bg)]",
                  panel.density === "compact"
                    ? "px-2 py-2"
                    : "px-2.5 pb-2.5 pt-[9px]",
                )}
                key={project.id}
              >
                <div className="flex min-w-0 items-baseline justify-between gap-2.5">
                  <strong
                    className="truncate text-[0.84rem] text-[var(--text)]"
                    title={project.name}
                  >
                    {formatProjectReference(project.name)}
                  </strong>
                  <span className="text-[0.7rem] text-[var(--text-dim)]">
                    {formatHomeMetricValue(total, metric)}
                  </span>
                </div>
                <div
                  className={cx(
                    "mt-2 overflow-hidden rounded-full bg-[var(--track-bg)]",
                    showProjectMeta ? "my-[7px] h-2.5" : "h-2",
                  )}
                  title={`${formatProjectReference(project.name)}: ${formatHomeMetricValue(
                    total,
                    metric,
                  )}`}
                >
                  <div
                    className={cx(
                      "flex h-full overflow-hidden rounded-[inherit]",
                      usageWidthClass(total, maxValue, 7),
                    )}
                  >
                    {project.adapters.map((adapter, index) => {
                      const value = adapterMetricValue(adapter, metric);
                      if (value <= 0 || total <= 0) {
                        return null;
                      }
                      return (
                        <span
                          className={cx(
                            "block h-full min-w-[3px]",
                            usageColorClass(index),
                            usageWidthClass(value, total, 3),
                          )}
                          key={adapter.adapterId}
                          title={`${adapter.adapterId}: ${formatHomeMetricValue(
                            value,
                            metric,
                          )}`}
                        />
                      );
                    })}
                  </div>
                </div>
                {showProjectMeta ? (
                  <div className="flex flex-wrap gap-x-2.5 gap-y-[7px] text-[0.7rem] text-[var(--text-dim)] max-[1220px]:hidden">
                    <span>Last seen {formatDate(project.lastSeen)}</span>
                    <span>
                      {project.adapters.map((adapter) => adapter.adapterId).join(", ") ||
                        "unknown adapter"}
                    </span>
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <EmptyState title="No linked projects yet." />
        )}
      </div>
    </Panel>
  );
}

export function HomeAdapterMixPanel({
  data,
  panel,
}: {
  data: DesktopHomeData;
  panel: HomePanelLayoutContext;
}) {
  const [metric, setMetric] =
    useState<Extract<HomeBreakdownMetric, "tokens" | "conversations">>(
      "tokens",
    );
  const chart = buildUsageChartModel(data);
  const windowedChart = buildWindowedUsageChart(chart, "daily", 0);
  const visibleAdapterCount = homePanelItemLimit(panel, {
    compact: 3,
    expanded: 8,
    standard: 5,
  });
  const adapters = windowedChart.adapters.slice(0, visibleAdapterCount);
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
  const showAdapterSubtitle = panel.density !== "compact";

  return (
    <Panel
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-home-panel-density={panel.density}
      data-home-panel-height={panel.height}
      data-home-panel-stack-below={String(panel.stackedBelowPx)}
      data-home-panel-width={panel.width}
      span="none"
    >
      <PanelHeader
        actions={
          <HomeMetricToggle
            compact={panel.density === "compact"}
            metric={metric}
            onChange={(nextMetric) => {
              if (nextMetric !== "cost") {
                setMetric(nextMetric);
              }
            }}
            values={["tokens", "conversations"]}
          />
        }
        className={cx(
          "max-[1220px]:flex-col max-[1220px]:items-start",
          panel.density === "compact" && "mb-2 gap-2",
        )}
      >
        <Eyebrow>Harnesses</Eyebrow>
        <PanelTitle>Harness Timeline</PanelTitle>
      </PanelHeader>
      <div
        className={cx(
          "grid min-h-0 gap-2",
          panel.height === "tall" ? "overflow-auto pr-1" : "overflow-hidden",
        )}
        data-home-panel-visible-items={String(visibleAdapterCount)}
      >
        {adapters.length > 0 ? (
          adapters.map((adapterId, index) => {
            const total =
              totals.find((entry) => entry.adapterId === adapterId)?.value ?? 0;
            return (
              <article
                className="grid min-w-0 grid-cols-[10px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 rounded-xl border border-[var(--control-border-subtle)] bg-[var(--item-bg)] px-2.5 py-[9px]"
                key={adapterId}
              >
                <i
                  className={cx(
                    "h-2.5 w-2.5 rounded-full shadow-[0_0_16px_currentColor]",
                    usageColorClass(index),
                  )}
                />
                <div>
                  <strong className="block truncate text-[0.82rem] text-[var(--text)]">
                    {adapterId}
                  </strong>
                  {showAdapterSubtitle ? (
                    <span className="block truncate text-[0.7rem] text-[var(--text-dim)] max-[1220px]:hidden">
                      {formatHomeMetricValue(total, metric)} over current window
                    </span>
                  ) : null}
                </div>
                <div
                  className={cx(
                    "col-start-2 grid grid-flow-col auto-cols-[minmax(5px,1fr)] items-end gap-[3px] rounded-[10px] bg-[var(--track-bg)]",
                    panel.density === "compact" ? "h-[24px] p-1" : "h-[34px] p-[5px]",
                  )}
                  aria-hidden="true"
                >
                  {days.map((day) => {
                    const dayValue = day.entries
                      .filter((entry) => entry.adapterId === adapterId)
                      .reduce(
                        (sum, entry) =>
                          sum + (metric === "tokens" ? entry.tokens : entry.sessions),
                        0,
                      );
                    return (
                      <span className="flex h-full min-w-0 items-end" key={day.day}>
                        <i
                          className={cx(
                            "block min-h-0 w-full rounded-t-full rounded-b-sm",
                            usageColorClass(index),
                            usageHeightClass(
                              dayValue,
                              maxValue,
                              dayValue > 0 ? 12 : 2,
                            ),
                          )}
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
          <EmptyState title="No adapter activity recorded yet." />
        )}
      </div>
    </Panel>
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

function homePanelItemLimit(
  panel: HomePanelLayoutContext,
  limits: {
    compact: number;
    expanded: number;
    standard: number;
  },
): number {
  if (panel.density === "expanded") {
    return limits.expanded;
  }
  if (panel.density === "compact") {
    return limits.compact;
  }
  return limits.standard;
}
