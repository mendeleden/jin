import { useQuery } from "@tanstack/react-query";
import {
  fetchTimeline,
  fetchAdapterStats,
  fetchModelStats,
  fetchToolUsage,
  fetchProjectCosts,
} from "@/lib/api";
import { formatCost, formatTokens } from "@/lib/utils";
import CostChart from "@/components/CostChart";
import AdapterBreakdown from "@/components/AdapterBreakdown";
import ModelComparison from "@/components/ModelComparison";

export default function Analytics() {
  const timeline = useQuery({ queryKey: ["timeline", 60], queryFn: () => fetchTimeline(60) });
  const adapters = useQuery({ queryKey: ["analytics", "adapters"], queryFn: fetchAdapterStats });
  const models = useQuery({ queryKey: ["analytics", "models"], queryFn: fetchModelStats });
  const tools = useQuery({ queryKey: ["analytics", "tools"], queryFn: fetchToolUsage });
  const projects = useQuery({ queryKey: ["analytics", "projects"], queryFn: fetchProjectCosts });

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Analytics</h2>

      {/* Cost over time */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">
          Cost over time (60 days)
        </h3>
        {timeline.data ? <CostChart data={timeline.data} /> : (
          <div className="h-60 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
        )}
      </div>

      {/* Adapter breakdown + Model comparison side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">
            Cost by tool
          </h3>
          {adapters.data ? <AdapterBreakdown data={adapters.data} /> : (
            <div className="h-60 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
          )}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-3">
            Tokens by model
          </h3>
          {models.data ? <ModelComparison data={models.data} /> : (
            <div className="h-60 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
          )}
        </div>
      </div>

      {/* Tool usage table */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">
          Tool usage
        </h3>
        {tools.data && tools.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="pb-2 pr-4">Tool</th>
                  <th className="pb-2 pr-4 text-right">Calls</th>
                  <th className="pb-2 text-right">Sessions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {tools.data.map((t) => (
                  <tr key={t.tool_name} className="hover:bg-zinc-800/30">
                    <td className="py-2 pr-4 font-mono text-xs text-zinc-300">
                      {t.tool_name}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-300">
                      {t.total_calls.toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums text-zinc-400">
                      {t.session_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-zinc-500 text-sm text-center py-6">No tool usage data</div>
        )}
      </div>

      {/* Project costs */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">
          Cost by project
        </h3>
        {projects.data && projects.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="pb-2 pr-4">Project</th>
                  <th className="pb-2 pr-4">Tool</th>
                  <th className="pb-2 pr-4 text-right">Sessions</th>
                  <th className="pb-2 pr-4 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {projects.data.map((p, i) => (
                  <tr key={i} className="hover:bg-zinc-800/30">
                    <td className="py-2 pr-4 text-zinc-300">{p.project_name}</td>
                    <td className="py-2 pr-4 text-xs text-zinc-400">{p.adapter_id}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-300">{p.sessions}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-300">{formatTokens(p.tokens)}</td>
                    <td className="py-2 text-right tabular-nums text-zinc-300">{formatCost(p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-zinc-500 text-sm text-center py-6">No project cost data</div>
        )}
      </div>
    </div>
  );
}
