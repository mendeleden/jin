import type { DesktopHomeData } from "../../../src/contracts/desktop";
import { usageColorHex } from "./usage-visuals";

const USAGE_DAILY_WINDOW_SIZE = 14;
const USAGE_MONTHLY_WINDOW_SIZE = 4;
const USAGE_MAX_HISTORY_DAYS = 366;

export const USAGE_CHART_WIDTH = 1280;
export const USAGE_CHART_HEIGHT = 252;

export type UsageChartPeriod = "daily" | "monthly";
export type HomeBreakdownMetric = "tokens" | "conversations" | "cost";

export type UsageDayBucket = {
  day: string;
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  entries: Array<{
    adapterId: string;
    cost: number;
    sessions: number;
    tokens: number;
  }>;
};

export type UsageDisplayBucket = UsageDayBucket & {
  label?: string;
  rangeEnd?: string;
};

export type UsageChartModel = {
  days: UsageDayBucket[];
  adapters: string[];
  source: "timeline" | "snapshot" | "empty";
  weeklyDays?: UsageDisplayBucket[];
};

export type UsageWindowedChartModel = Omit<UsageChartModel, "days"> & {
  canGoNext: boolean;
  canGoPrevious: boolean;
  days: UsageDisplayBucket[];
  period: UsageChartPeriod;
  rangeLabel: string;
  windowLabel: string;
};

export type UsageChartDatum = {
  day: string;
  label: string;
  totalCost: number;
  totalSessions: number;
  totalTokens: number;
  [adapterKey: string]: string | number;
};

export type UsageChartSeries = {
  adapterId: string;
  color: string;
  key: string;
};

export function buildWindowedUsageChart(
  chart: UsageChartModel,
  period: UsageChartPeriod,
  windowOffset: number,
): UsageWindowedChartModel {
  const displayDays =
    chart.source === "snapshot"
      ? buildUsageDisplayBuckets(chart)
      : period === "monthly"
        ? chart.weeklyDays ?? []
        : chart.days;

  if (chart.source === "empty" || displayDays.length === 0) {
    return {
      ...chart,
      canGoNext: false,
      canGoPrevious: false,
      days: [],
      period,
      rangeLabel: "No usage",
      windowLabel: "No window",
    };
  }

  const windowSize =
    chart.source === "snapshot"
      ? displayDays.length
      : period === "monthly"
        ? USAGE_MONTHLY_WINDOW_SIZE
        : USAGE_DAILY_WINDOW_SIZE;
  const windowCount = Math.max(1, Math.ceil(displayDays.length / windowSize));
  const safeOffset = Math.min(Math.max(0, windowOffset), windowCount - 1);
  const end = displayDays.length - safeOffset * windowSize;
  const start = Math.max(0, end - windowSize);
  const windowDays = displayDays.slice(start, end);
  const windowNumber = windowCount - safeOffset;

  return {
    ...chart,
    canGoNext: safeOffset > 0,
    canGoPrevious: start > 0,
    days: windowDays,
    period,
    rangeLabel: formatUsageWindowRange(windowDays),
    windowLabel:
      windowCount === 1 ? "Only window" : `Window ${windowNumber} of ${windowCount}`,
  };
}

export function buildUsageChartModel(data: DesktopHomeData): UsageChartModel {
  const timelineEntries = (data.tokenUsageByDay ?? []).filter(
    (entry) => entry.sessions > 0 || entry.tokens > 0 || entry.cost > 0,
  );
  const weeklyEntries = (data.tokenUsageByWeek ?? []).filter(
    (entry) => entry.sessions > 0 || entry.tokens > 0 || entry.cost > 0,
  );

  if (timelineEntries.length > 0) {
    const chart = buildUsageChartModelFromEntries(timelineEntries, "timeline");
    return {
      ...chart,
      weeklyDays: buildUsageChartModelFromEntries(
        weeklyEntries.map((entry) => ({
          adapterId: entry.adapterId,
          cost: entry.cost,
          day: entry.weekStart,
          sessions: entry.sessions,
          tokens: entry.tokens,
        })),
        "timeline",
      ).days.map((day) => ({
        ...day,
        label: formatUsageWeekRange(
          day.day,
          weeklyEntries.find((entry) => entry.weekStart === day.day)?.weekEnd ??
            day.day,
        ),
        rangeEnd:
          weeklyEntries.find((entry) => entry.weekStart === day.day)?.weekEnd ??
          day.day,
      })),
    };
  }

  const snapshotDay = normalizeUsageSnapshotDay(data.generatedAt);
  const adapterEntries = data.topAdapters
    .filter(
      (adapter) =>
        adapter.conversations > 0 || adapter.tokens > 0 || adapter.cost > 0,
    )
    .map((adapter) => ({
      adapterId: adapter.adapterId || "unknown",
      cost: adapter.cost,
      day: snapshotDay,
      sessions: adapter.conversations,
      tokens: adapter.tokens,
    }));

  if (adapterEntries.length > 0) {
    return buildUsageChartModelFromEntries(adapterEntries, "snapshot");
  }

  if (
    data.overview.conversations > 0 ||
    data.overview.tokens > 0 ||
    data.overview.cost > 0
  ) {
    return buildUsageChartModelFromEntries(
      [
        {
          adapterId: "all adapters",
          cost: data.overview.cost,
          day: snapshotDay,
          sessions: data.overview.conversations,
          tokens: data.overview.tokens,
        },
      ],
      "snapshot",
    );
  }

  return {
    adapters: [],
    days: [],
    source: "empty",
    weeklyDays: [],
  };
}

export function buildUsageRechartsData(
  days: UsageDisplayBucket[],
  adapters: string[],
  metric: HomeBreakdownMetric,
): { chartData: UsageChartDatum[]; series: UsageChartSeries[] } {
  const metricTotals = new Map<string, number>();
  for (const adapterId of adapters) {
    const total = days.reduce(
      (sum, day) =>
        sum +
        day.entries
          .filter((entry) => entry.adapterId === adapterId)
          .reduce(
            (entrySum, entry) =>
              entrySum + usageEntryMetricValue(entry, metric),
            0,
          ),
      0,
    );
    metricTotals.set(adapterId, total);
  }
  const orderedAdapters = [...adapters].sort(
    (left, right) =>
      (metricTotals.get(right) ?? 0) - (metricTotals.get(left) ?? 0) ||
      left.localeCompare(right),
  );

  const series = orderedAdapters.map((adapterId, index) => ({
    adapterId,
    color: usageColorHex(index),
    key: `adapter_${index}`,
  }));

  const chartData = days.map((day) => {
    const datum: UsageChartDatum = {
      day: day.day,
      label: formatUsageDisplayDay(day),
      totalCost: day.totalCost,
      totalSessions: day.totalSessions,
      totalTokens: day.totalTokens,
    };

    for (const [index, adapterId] of orderedAdapters.entries()) {
      datum[`adapter_${index}`] = day.entries
        .filter((entry) => entry.adapterId === adapterId)
        .reduce((sum, entry) => sum + usageEntryMetricValue(entry, metric), 0);
    }

    return datum;
  });

  return { chartData, series };
}

export function usageEntryMetricValue(
  entry: { cost: number; sessions: number; tokens: number },
  metric: HomeBreakdownMetric,
): number {
  if (metric === "conversations") {
    return entry.sessions;
  }
  if (metric === "cost") {
    return entry.cost;
  }
  return entry.tokens;
}

export function usageMetricUsageLabel(metric: HomeBreakdownMetric): string {
  if (metric === "conversations") {
    return "conversation";
  }
  if (metric === "cost") {
    return "cost";
  }
  return "token";
}

export function formatUsageDisplayDay(day: UsageDisplayBucket): string {
  return day.label ?? formatChartDay(day.day);
}

function formatUsageWindowRange(days: UsageDisplayBucket[]): string {
  const first = days[0];
  const last = days.at(-1);

  if (!first || !last) {
    return "No usage";
  }

  const firstLabel = formatUsageDisplayDay(first);
  const lastLabel = formatUsageDisplayDay(last);

  if (first.rangeEnd || last.rangeEnd) {
    const rangeStart = formatChartDay(first.day);
    const rangeEnd = formatChartDay(last.rangeEnd ?? last.day);
    return rangeStart === rangeEnd ? rangeStart : `${rangeStart} - ${rangeEnd}`;
  }

  return firstLabel === lastLabel ? firstLabel : `${firstLabel} - ${lastLabel}`;
}

function buildUsageChartModelFromEntries(
  entries: Array<{
    adapterId: string;
    cost: number;
    day: string;
    sessions: number;
    tokens: number;
  }>,
  source: UsageChartModel["source"],
): UsageChartModel {
  const dayMap = new Map<string, UsageDayBucket>();
  const adapterTotals = new Map<string, number>();

  for (const entry of entries) {
    const adapterId = entry.adapterId || "unknown";
    const day = dayMap.get(entry.day) ?? {
      day: entry.day,
      entries: [],
      totalCost: 0,
      totalSessions: 0,
      totalTokens: 0,
    };
    day.totalTokens += entry.tokens;
    day.totalCost += entry.cost;
    day.totalSessions += entry.sessions;
    const existingEntry = day.entries.find(
      (dayEntry) => dayEntry.adapterId === adapterId,
    );
    if (existingEntry) {
      existingEntry.cost += entry.cost;
      existingEntry.sessions += entry.sessions;
      existingEntry.tokens += entry.tokens;
    } else {
      day.entries.push({
        adapterId,
        cost: entry.cost,
        sessions: entry.sessions,
        tokens: entry.tokens,
      });
    }
    dayMap.set(entry.day, day);
    adapterTotals.set(
      adapterId,
      (adapterTotals.get(adapterId) ?? 0) + entry.tokens + entry.sessions,
    );
  }

  const adapters = Array.from(adapterTotals.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([adapterId]) => adapterId);
  const days = Array.from(dayMap.values())
    .sort((left, right) => left.day.localeCompare(right.day))
    .slice(-USAGE_MAX_HISTORY_DAYS);

  return {
    adapters,
    days,
    source,
  };
}

function normalizeUsageSnapshotDay(value: string): string {
  if (!value) {
    return "snapshot";
  }

  const [day] = value.split("T");
  return day && day.length > 0 ? day : value;
}

function buildUsageDisplayBuckets(chart: UsageChartModel): UsageDisplayBucket[] {
  if (chart.source !== "snapshot" || chart.days.length !== 1) {
    return chart.days;
  }

  const snapshotDay = chart.days[0]!;
  return [
    {
      ...snapshotDay,
      day: `${snapshotDay.day}:snapshot`,
      label: "Snapshot",
    },
    {
      ...snapshotDay,
      day: `${snapshotDay.day}:current`,
      label: "Current",
    },
  ];
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
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatUsageWeekRange(weekStart: string, weekEnd: string): string {
  const startDate = new Date(`${weekStart}T00:00:00`);
  const endDate = new Date(`${weekEnd}T00:00:00`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return formatChartDay(weekStart);
  }

  const sameMonth = startDate.getMonth() === endDate.getMonth();
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const startLabel = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: sameMonth ? undefined : "short",
    year: sameYear ? undefined : "numeric",
  }).format(endDate);

  return `${startLabel} - ${endLabel}`;
}
