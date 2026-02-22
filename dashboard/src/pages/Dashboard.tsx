import { useQuery } from "@tanstack/react-query";
import { fetchOverview, fetchTimeline, fetchSessions } from "@/lib/api";
import { formatCost, formatTokens } from "@/lib/utils";
import StatCard from "@/components/StatCard";
import TimelineChart from "@/components/TimelineChart";
import SessionTable from "@/components/SessionTable";

export default function Dashboard() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: fetchOverview });
  const timeline = useQuery({ queryKey: ["timeline"], queryFn: () => fetchTimeline(30) });
  const recent = useQuery({
    queryKey: ["sessions", "recent"],
    queryFn: () => fetchSessions({ limit: "10" }),
  });

  const o = overview.data;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Overview</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Sessions" value={o?.sessions ?? "—"} />
        <StatCard label="Messages" value={o?.messages ?? "—"} />
        <StatCard
          label="Tokens"
          value={o ? formatTokens(o.tokens) : "—"}
        />
        <StatCard
          label="Cost"
          value={o ? formatCost(o.cost) : "—"}
        />
        <StatCard label="Projects" value={o?.projects ?? "—"} />
        <StatCard label="Artifacts" value={o?.artifacts ?? "—"} />
      </div>

      {/* Timeline chart */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">
          Sessions / day (last 30 days)
        </h3>
        {timeline.isLoading ? (
          <div className="h-60 flex items-center justify-center text-zinc-500 text-sm">
            Loading…
          </div>
        ) : timeline.data ? (
          <TimelineChart data={timeline.data} />
        ) : null}
      </div>

      {/* Recent sessions */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3">
          Recent sessions
        </h3>
        {recent.isLoading ? (
          <div className="text-zinc-500 text-sm py-8 text-center">Loading…</div>
        ) : recent.data ? (
          <SessionTable sessions={recent.data} compact />
        ) : null}
      </div>
    </div>
  );
}
