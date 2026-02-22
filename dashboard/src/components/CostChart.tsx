import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TimelineEntry } from "@/lib/api";
import { adapterColor, formatCost } from "@/lib/utils";

interface CostChartProps {
  data: TimelineEntry[];
}

export default function CostChart({ data }: CostChartProps) {
  const adapters = [...new Set(data.map((d) => d.adapter_id))];
  const byDay = new Map<string, Record<string, number>>();
  for (const entry of data) {
    const existing = byDay.get(entry.day) || {};
    existing[entry.adapter_id] = (existing[entry.adapter_id] || 0) + entry.cost;
    byDay.set(entry.day, existing);
  }
  const chartData = [...byDay.entries()]
    .map(([day, vals]) => ({ day, ...vals }))
    .sort((a, b) => a.day.localeCompare(b.day));

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">
        No cost data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: "#71717a" }}
          tickFormatter={(v) => v.slice(5)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#71717a" }}
          tickFormatter={(v) => formatCost(v)}
          axisLine={false}
          tickLine={false}
          width={50}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          formatter={(v: number) => formatCost(v)}
          labelStyle={{ color: "#a1a1aa" }}
        />
        {adapters.map((a) => (
          <Line
            key={a}
            type="monotone"
            dataKey={a}
            stroke={adapterColor(a)}
            dot={false}
            strokeWidth={2}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
