import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatTokens } from "@/lib/utils";

interface ModelComparisonProps {
  data: Record<string, { messages: number; inputTokens: number; outputTokens: number }>;
}

export default function ModelComparison({ data }: ModelComparisonProps) {
  const chartData = Object.entries(data)
    .map(([model, stats]) => ({
      model: model.length > 20 ? model.slice(0, 18) + "…" : model,
      input: stats.inputTokens,
      output: stats.outputTokens,
    }))
    .sort((a, b) => (b.input + b.output) - (a.input + a.output))
    .slice(0, 10);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">
        No model data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
      >
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: "#71717a" }}
          tickFormatter={(v) => formatTokens(v)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="model"
          tick={{ fontSize: 10, fill: "#71717a" }}
          axisLine={false}
          tickLine={false}
          width={140}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#18181b",
            border: "1px solid #3f3f46",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          formatter={(v: number) => formatTokens(v)}
          labelStyle={{ color: "#a1a1aa" }}
        />
        <Legend
          wrapperStyle={{ fontSize: "11px", color: "#a1a1aa" }}
        />
        <Bar dataKey="input" name="Input" fill="#3b82f6" radius={[0, 4, 4, 0]} />
        <Bar dataKey="output" name="Output" fill="#10b981" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
