import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TimelineEntry } from "@/lib/api";
import { adapterColor } from "@/lib/utils";

interface TimelineChartProps {
  data: TimelineEntry[];
}

export default function TimelineChart({ data }: TimelineChartProps) {
  // Pivot: group by day, each adapter is a key
  const adapters = [...new Set(data.map((d) => d.adapter_id))];
  const byDay = new Map<string, Record<string, number>>();
  for (const entry of data) {
    const existing = byDay.get(entry.day) || {};
    existing[entry.adapter_id] = (existing[entry.adapter_id] || 0) + entry.sessions;
    byDay.set(entry.day, existing);
  }
  const chartData = [...byDay.entries()]
    .map(([day, vals]) => ({ day, ...vals }))
    .sort((a, b) => a.day.localeCompare(b.day));

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">
        No timeline data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: "#71717a" }}
          tickFormatter={(v) => v.slice(5)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#71717a" }}
          axisLine={false}
          tickLine={false}
          width={30}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          labelStyle={{ color: "#a1a1aa" }}
        />
        {adapters.map((a) => (
          <Area
            key={a}
            type="monotone"
            dataKey={a}
            stackId="1"
            stroke={adapterColor(a)}
            fill={adapterColor(a)}
            fillOpacity={0.3}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
