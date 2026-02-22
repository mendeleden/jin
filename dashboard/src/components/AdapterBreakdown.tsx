import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { adapterColor, formatCost } from "@/lib/utils";

interface AdapterBreakdownProps {
  data: Record<string, { sessions: number; messages: number; tokens: number; cost: number }>;
}

export default function AdapterBreakdown({ data }: AdapterBreakdownProps) {
  const chartData = Object.entries(data)
    .map(([adapter, stats]) => ({ adapter, ...stats }))
    .sort((a, b) => b.cost - a.cost);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">
        No adapter data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="adapter"
          tick={{ fontSize: 10, fill: "#71717a" }}
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
        <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
          {chartData.map((entry) => (
            <Cell key={entry.adapter} fill={adapterColor(entry.adapter)} fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
