import { Link } from "react-router-dom";
import type { EnrichedSession } from "@/lib/api";
import { formatCost, formatTokens, timeAgo, adapterColor } from "@/lib/utils";
import TagBadge from "./TagBadge";

interface SessionTableProps {
  sessions: EnrichedSession[];
  compact?: boolean;
}

export default function SessionTable({ sessions, compact }: SessionTableProps) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        No sessions found. Run <code className="text-zinc-400">jin init</code> to import data.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wider">
            <th className="pb-2 pr-4">Session</th>
            <th className="pb-2 pr-4">Tool</th>
            {!compact && <th className="pb-2 pr-4">Project</th>}
            <th className="pb-2 pr-4 text-right">Messages</th>
            <th className="pb-2 pr-4 text-right">Tokens</th>
            <th className="pb-2 pr-4 text-right">Cost</th>
            <th className="pb-2 text-right">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {sessions.map((s) => (
            <tr key={s.id} className="hover:bg-zinc-800/30 transition-colors">
              <td className="py-2.5 pr-4 max-w-xs">
                <div className="flex items-center gap-1.5">
                  <Link
                    to={`/sessions/${s.id}`}
                    className="text-zinc-200 hover:text-jin-400 transition-colors truncate"
                  >
                    {s.name || s.id.slice(0, 12)}
                  </Link>
                  {!!s.is_sub_agent && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 whitespace-nowrap">
                      sub-agent
                    </span>
                  )}
                  {!!s.is_active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 whitespace-nowrap">
                      active
                    </span>
                  )}
                </div>
                {s.tag_names && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {s.tag_names.split(",").slice(0, 3).map((t) => (
                      <TagBadge key={t} name={t} />
                    ))}
                  </div>
                )}
              </td>
              <td className="py-2.5 pr-4">
                <span
                  className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: adapterColor(s.adapter_id) + "18",
                    color: adapterColor(s.adapter_id),
                  }}
                >
                  {s.adapter_name}
                </span>
              </td>
              {!compact && (
                <td className="py-2.5 pr-4 text-zinc-400 text-xs truncate max-w-[180px]">
                  {s.project_names || "—"}
                </td>
              )}
              <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-300">
                {s.message_count}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-300">
                {formatTokens(s.total_tokens)}
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-300">
                {formatCost(s.est_cost)}
              </td>
              <td className="py-2.5 text-right text-zinc-500 text-xs whitespace-nowrap">
                {timeAgo(s.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
