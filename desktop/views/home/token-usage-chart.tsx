import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatCost,
  formatMetricNumber,
  formatNumber,
} from "../../renderer";
import { Button } from "../../ui/button";
import { cx } from "../../ui/classnames";
import {
  EmptyState,
  SegmentedControl,
  type SegmentedControlOption,
} from "../../ui/primitives";
import {
  USAGE_CHART_HEIGHT,
  USAGE_CHART_WIDTH,
  buildUsageRechartsData,
  formatUsageDisplayDay,
  usageMetricUsageLabel,
  type HomeBreakdownMetric,
  type UsageChartDatum,
  type UsageChartPeriod,
  type UsageDisplayBucket,
  type UsageWindowedChartModel,
} from "./usage-chart-model";
import type { HomePanelLayoutContext } from "./layout";
import {
  usageColorClass,
  usageColorClassForColor,
  usageHeightClass,
} from "./usage-visuals";

export function HomeMetricToggle({
  compact = false,
  metric,
  onChange,
  values = ["tokens", "conversations", "cost"],
}: {
  compact?: boolean;
  metric: HomeBreakdownMetric;
  onChange(metric: HomeBreakdownMetric): void;
  values?: HomeBreakdownMetric[];
}) {
  const options = values.map<SegmentedControlOption<HomeBreakdownMetric>>(
    (value) => ({
      label: homeMetricLabel(value),
      value,
    }),
  );

  return (
    <SegmentedControl
      ariaLabel="Breakdown metric"
      buttonClassName={cx(
        "text-[0.68rem] font-semibold uppercase tracking-normal",
        compact && "px-1.5 text-[0.64rem]",
      )}
      onChange={onChange}
      options={options}
      value={metric}
    />
  );
}

export function homeMetricLabel(metric: HomeBreakdownMetric): string {
  if (metric === "conversations") {
    return "Convs";
  }
  if (metric === "cost") {
    return "Cost";
  }
  return "Tokens";
}

export function formatHomeMetricValue(
  value: number,
  metric: HomeBreakdownMetric,
): string {
  if (metric === "cost") {
    return formatCost(value);
  }
  if (metric === "conversations") {
    return `${formatNumber(value)} conv`;
  }
  return `${formatMetricNumber(value).display} tok`;
}

export function TokenUsageChart({
  chart,
  monthlyAvailable,
  onNextWindow,
  onPeriodChange,
  onPreviousWindow,
  panel,
}: {
  chart: UsageWindowedChartModel;
  monthlyAvailable: boolean;
  onNextWindow(): void;
  onPeriodChange(period: UsageChartPeriod): void;
  onPreviousWindow(): void;
  panel: HomePanelLayoutContext;
}) {
  const [metric, setMetric] = useState<HomeBreakdownMetric>("tokens");

  if (chart.source === "empty" || chart.days.length === 0) {
    return <EmptyState title="No token usage has been recorded yet." />;
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
  const chartSize = getUsageChartSize(panel);
  const compactChrome = chartSize.variant === "compact";
  const showSessionRail = !compactChrome && panel.width !== "narrow";
  const showLegend = !compactChrome && panel.width !== "narrow";
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
  const periodOptions: SegmentedControlOption<UsageChartPeriod>[] = [
    {
      label: "Daily",
      value: "daily",
    },
    {
      disabled: !monthlyAvailable,
      label: "Monthly",
      title: monthlyAvailable
        ? "Monthly rollup"
        : "Monthly rollup requires weekly usage buckets",
      value: "monthly",
    },
  ];

  return (
    <div
      className="grid min-h-0 flex-1 gap-2"
      data-usage-chart-density={panel.density}
      data-usage-chart-height={chartSize.variant}
      data-usage-chart-source={chart.source}
      data-usage-period={chart.period}
      data-usage-window={chart.windowLabel}
    >
      <div
        className={cx(
          "flex min-w-0 items-start justify-between gap-3",
          compactChrome && "gap-2",
          panel.width === "narrow" && "flex-col",
          "max-[1220px]:flex-col max-[1220px]:gap-2",
        )}
      >
        <div>
          <h3
            className={cx(
              "m-0 tracking-normal text-[var(--text)]",
              compactChrome ? "text-[0.98rem]" : "text-[1.08rem]",
            )}
          >
            {title}
          </h3>
          {compactChrome ? null : (
            <p className="m-0 mt-1 text-[0.76rem] text-[var(--text-dim)] max-[1220px]:hidden">
              {description}
            </p>
          )}
        </div>
        <div
          className={cx(
            "flex min-w-0 flex-wrap items-center justify-end gap-2",
            compactChrome && "gap-1.5",
            "max-[1220px]:justify-start max-[1220px]:gap-1.5",
          )}
          aria-label="Usage chart controls"
        >
          <HomeMetricToggle
            compact={compactChrome || panel.width === "narrow"}
            metric={metric}
            onChange={setMetric}
          />
          <SegmentedControl
            ariaLabel="Usage period"
            buttonClassName={cx(
              "min-w-[72px] px-2.5",
              (compactChrome || panel.width === "narrow") && "min-w-0 px-2",
            )}
            onChange={onPeriodChange}
            options={periodOptions}
            value={chart.period}
          />
          <div
            className="inline-flex min-w-0 items-center gap-1.5 text-[0.76rem] text-[var(--text-dim)]"
            aria-label={chart.rangeLabel}
          >
            <Button
              aria-label="Previous usage window"
              className="h-[30px] w-[30px] border-[rgba(137,180,255,0.3)] bg-[linear-gradient(180deg,rgba(137,180,255,0.18),rgba(137,180,255,0.08))] p-0 text-[var(--text)] hover:border-[rgba(137,180,255,0.55)] hover:bg-[linear-gradient(180deg,rgba(137,180,255,0.28),rgba(137,180,255,0.12))] hover:shadow-[0_0_0_3px_rgba(137,180,255,0.08)] disabled:cursor-default disabled:border-[rgba(210,224,255,0.07)] disabled:bg-white/[0.02] disabled:text-[rgba(164,175,196,0.32)] disabled:opacity-100"
              disabled={!chart.canGoPrevious}
              onClick={onPreviousWindow}
              title="Previous window"
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span
              className={cx(
                "min-w-[118px] max-w-[178px] truncate rounded-full border border-[rgba(210,224,255,0.1)] bg-white/[0.035] px-2.5 py-[7px] text-center",
                compactChrome && "hidden",
                "max-[1220px]:hidden",
              )}
              title={chart.windowLabel}
            >
              {chart.rangeLabel}
            </span>
            <Button
              aria-label="Next usage window"
              className="h-[30px] w-[30px] border-[rgba(137,180,255,0.3)] bg-[linear-gradient(180deg,rgba(137,180,255,0.18),rgba(137,180,255,0.08))] p-0 text-[var(--text)] hover:border-[rgba(137,180,255,0.55)] hover:bg-[linear-gradient(180deg,rgba(137,180,255,0.28),rgba(137,180,255,0.12))] hover:shadow-[0_0_0_3px_rgba(137,180,255,0.08)] disabled:cursor-default disabled:border-[rgba(210,224,255,0.07)] disabled:bg-white/[0.02] disabled:text-[rgba(164,175,196,0.32)] disabled:opacity-100"
              disabled={!chart.canGoNext}
              onClick={onNextWindow}
              title="Next window"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
      <div
        className={cx(
          "grid gap-[7px]",
          panel.width === "narrow" ? "grid-cols-1" : "grid-cols-3",
          "max-[1220px]:grid-cols-1",
        )}
        data-usage-chart-kpis
      >
        <span className="grid min-w-0 gap-1 rounded-[10px] border border-[var(--line)] bg-white/[0.028] px-2.5 py-2 text-[0.7rem] text-[var(--text-dim)]">
          <strong className="text-[0.98rem] text-[var(--text)]">
            {formatMetricNumber(totalTokens).display}
          </strong>
          {compactChrome ? "tok" : "tokens"}
        </span>
        <span className="grid min-w-0 gap-1 rounded-[10px] border border-[var(--line)] bg-white/[0.028] px-2.5 py-2 text-[0.7rem] text-[var(--text-dim)]">
          <strong className="text-[0.98rem] text-[var(--text)]">
            {formatNumber(totalSessions)}
          </strong>
          {compactChrome ? "conv" : "conversations"}
        </span>
        <span className="grid min-w-0 gap-1 rounded-[10px] border border-[var(--line)] bg-white/[0.028] px-2.5 py-2 text-[0.7rem] text-[var(--text-dim)]">
          <strong className="text-[0.98rem] text-[var(--text)]">
            {formatCost(totalCost)}
          </strong>
          {compactChrome ? "cost" : "est. cost"}
        </span>
      </div>
      <div
        className={cx(
          "relative overflow-hidden rounded-[14px] border border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.014)),radial-gradient(circle_at_70%_18%,rgba(137,180,255,0.1),transparent_32%)]",
          chartSize.className,
        )}
      >
        <div
          aria-label={ariaLabel}
          className={cx("relative w-full", chartSize.className)}
          role="img"
        >
          <ComposedChart
            accessibilityLayer
            barCategoryGap={useWeeklyBars ? "28%" : "10%"}
            className={cx("relative z-[1] block w-full outline-none", chartSize.className)}
            data={chartData}
            height={chartSize.height}
            margin={chartSize.margin}
            width={USAGE_CHART_WIDTH}
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
      {showSessionRail ? (
        <UsageSessionRail className="max-[1220px]:hidden" days={displayDays} />
      ) : null}
      {showLegend ? (
        <div className="flex flex-wrap gap-x-3.5 gap-y-2 text-[0.8rem] text-[var(--text-soft)] max-[1220px]:hidden">
          {series.map((adapter, index) => (
            <span className="inline-flex items-center gap-[7px]" key={adapter.key}>
              <i className={cx("h-[9px] w-[9px] rounded-full", usageColorClass(index))} />
              {adapter.adapterId}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getUsageChartSize(panel: HomePanelLayoutContext): {
  className: string;
  height: number;
  margin: {
    bottom: number;
    left: number;
    right: number;
    top: number;
  };
  variant: "compact" | "standard" | "expanded";
} {
  if (panel.layout.h <= 4 || panel.width === "narrow") {
    return {
      className: "h-[168px] min-h-[168px]",
      height: 168,
      margin: { bottom: 28, left: 4, right: 18, top: 10 },
      variant: "compact",
    };
  }

  if (panel.density === "expanded") {
    return {
      className: "h-[318px] min-h-[318px]",
      height: 318,
      margin: { bottom: 38, left: 12, right: 38, top: 20 },
      variant: "expanded",
    };
  }

  return {
    className: "h-[252px] min-h-[252px]",
    height: USAGE_CHART_HEIGHT,
    margin: { bottom: 36, left: 12, right: 36, top: 18 },
    variant: "standard",
  };
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
    dataKey?: string | number;
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
    <div className="pointer-events-none static grid min-w-[190px] gap-2 rounded-xl border border-[rgba(210,224,255,0.18)] bg-[rgba(17,22,32,0.86)] p-3 shadow-[0_18px_38px_rgba(0,0,0,0.28)] backdrop-blur-[14px]">
      <strong className="text-[0.92rem] text-[var(--text)]">{label}</strong>
      {rows[0]?.payload ? (
        <>
          <span className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-[0.82rem] text-[var(--text-soft)]">
            <i className="h-[9px] w-[9px] rounded-full bg-[rgba(246,248,253,0.72)]" />
            tokens
            <b className="font-semibold text-[var(--text)]">
              {formatMetricNumber(rows[0].payload.totalTokens).display}
            </b>
          </span>
          <span className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-[0.82rem] text-[var(--text-soft)]">
            <i className="h-[9px] w-[9px] rounded-full bg-[rgba(246,248,253,0.72)]" />
            conversations
            <b className="font-semibold text-[var(--text)]">
              {formatNumber(rows[0].payload.totalSessions)}
            </b>
          </span>
          <span className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-[0.82rem] text-[var(--text-soft)]">
            <i className="h-[9px] w-[9px] rounded-full bg-[rgba(246,248,253,0.72)]" />
            est. cost
            <b className="font-semibold text-[var(--text)]">
              {formatCost(rows[0].payload.totalCost)}
            </b>
          </span>
        </>
      ) : null}
      {rows.slice(0, 6).map((entry) => (
        <span
          className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-[0.82rem] text-[var(--text-soft)]"
          key={entry.name}
        >
          <i className={cx("h-[9px] w-[9px] rounded-full", usageTooltipMarkerClass(entry))} />
          {entry.name}
          <b className="font-semibold text-[var(--text)]">
            {formatHomeMetricValue(Number(entry.value), metric)}
          </b>
        </span>
      ))}
    </div>
  );
}

function UsageSessionRail({
  className,
  days,
}: {
  className?: string;
  days: UsageDisplayBucket[];
}) {
  if (days.length === 0) {
    return null;
  }

  const maxSessions = Math.max(...days.map((day) => day.totalSessions), 1);

  return (
    <div
      className={cx(
        "grid h-[34px] grid-flow-col auto-cols-[minmax(6px,1fr)] items-end gap-[3px] rounded-[10px] border border-[rgba(210,224,255,0.08)] bg-white/[0.02] p-1.5",
        className,
      )}
      aria-label="Conversation volume by day"
    >
      {days.map((day) => (
        <span
          className="flex h-full min-w-0 items-end"
          key={day.day}
          title={`${formatUsageDisplayDay(day)}: ${formatNumber(
            day.totalSessions,
          )} conversations`}
        >
          <i
            className={cx(
              "block w-full rounded-t-full rounded-b-[3px] bg-[linear-gradient(180deg,rgba(246,248,253,0.7),rgba(137,180,255,0.36))]",
              usageHeightClass(day.totalSessions, maxSessions, 10),
            )}
          />
        </span>
      ))}
    </div>
  );
}

function usageTooltipMarkerClass(entry: {
  color?: string;
  dataKey?: string | number;
}): string {
  if (typeof entry.dataKey === "string") {
    const match = /^adapter_(\d+)$/.exec(entry.dataKey);
    if (match?.[1]) {
      return usageColorClass(Number(match[1]));
    }
  }

  return usageColorClassForColor(entry.color);
}
