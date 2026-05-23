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

export function HomePulsePanel({ data }: { data: DesktopHomeData }) {
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
      className="flex h-full min-h-[448px] flex-col overflow-hidden bg-[radial-gradient(circle_at_18%_4%,rgba(137,180,255,0.16),transparent_30%),radial-gradient(circle_at_78%_0%,rgba(137,212,161,0.1),transparent_28%),linear-gradient(180deg,rgba(14,20,31,0.95),rgba(7,10,16,0.95))]"
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
      />
    </Panel>
  );
}

export function HomeProjectActivityPanel({ data }: { data: DesktopHomeData }) {
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
    <Panel
      className="h-full min-h-80 overflow-hidden bg-[radial-gradient(circle_at_18%_0%,rgba(240,196,109,0.1),transparent_30%),linear-gradient(180deg,rgba(14,19,28,0.95),rgba(7,10,16,0.95))]"
      span="none"
    >
      <PanelHeader actions={<HomeMetricToggle metric={metric} onChange={setMetric} />}>
        <Eyebrow>Projects</Eyebrow>
        <PanelTitle>Project Stacks</PanelTitle>
      </PanelHeader>
      <div className="grid gap-2">
        {projects.length > 0 ? (
          projects.slice(0, 7).map((project) => {
            const total = projectMetricValue(project, metric);
            return (
              <article
                className="min-w-0 rounded-xl border border-[rgba(210,224,255,0.08)] bg-white/[0.024] px-2.5 pb-2.5 pt-[9px]"
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
                  className="my-[7px] mt-2 h-2.5 overflow-hidden rounded-full bg-[rgba(210,224,255,0.075)]"
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
                <div className="flex flex-wrap gap-x-2.5 gap-y-[7px] text-[0.7rem] text-[var(--text-dim)]">
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
          <EmptyState title="No linked projects yet." />
        )}
      </div>
    </Panel>
  );
}

export function HomeAdapterMixPanel({ data }: { data: DesktopHomeData }) {
  const [metric, setMetric] =
    useState<Extract<HomeBreakdownMetric, "tokens" | "conversations">>(
      "tokens",
    );
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
    <Panel className="h-full min-h-80 overflow-hidden" span="none">
      <PanelHeader
        actions={
          <HomeMetricToggle
            metric={metric}
            onChange={(nextMetric) => {
              if (nextMetric !== "cost") {
                setMetric(nextMetric);
              }
            }}
            values={["tokens", "conversations"]}
          />
        }
      >
        <Eyebrow>Harnesses</Eyebrow>
        <PanelTitle>Harness Timeline</PanelTitle>
      </PanelHeader>
      <div className="grid gap-2">
        {adapters.length > 0 ? (
          adapters.map((adapterId, index) => {
            const total =
              totals.find((entry) => entry.adapterId === adapterId)?.value ?? 0;
            return (
              <article
                className="grid min-w-0 grid-cols-[10px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 rounded-xl border border-[rgba(210,224,255,0.08)] bg-white/[0.024] px-2.5 py-[9px]"
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
                  <span className="block truncate text-[0.7rem] text-[var(--text-dim)]">
                    {formatHomeMetricValue(total, metric)} over current window
                  </span>
                </div>
                <div
                  className="col-start-2 grid h-[34px] grid-flow-col auto-cols-[minmax(5px,1fr)] items-end gap-[3px] rounded-[10px] bg-[rgba(210,224,255,0.045)] p-[5px]"
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
