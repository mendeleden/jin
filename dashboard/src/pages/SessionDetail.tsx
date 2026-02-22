import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchSession } from "@/lib/api";
import { formatCost, formatTokens, formatDuration, timeAgo, adapterColor } from "@/lib/utils";
import MessageThread from "@/components/MessageThread";
import TagBadge from "@/components/TagBadge";

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["session", id],
    queryFn: () => fetchSession(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="text-zinc-500 text-sm py-12 text-center">Loading…</div>;
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-500">Session not found</p>
        <Link to="/sessions" className="text-jin-400 text-sm mt-2 inline-block">
          Back to sessions
        </Link>
      </div>
    );
  }

  const { session: s, messages, tags } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          to="/sessions"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← Sessions
        </Link>
        <h2 className="text-xl font-semibold mt-1">
          {s.name || s.id.slice(0, 16)}
        </h2>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: adapterColor(s.adapterId) + "18",
              color: adapterColor(s.adapterId),
            }}
          >
            {s.adapterName}
          </span>
          {tags.map((t) => (
            <TagBadge key={t.name} name={t.name} color={t.color} />
          ))}
          {s.isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
              active
            </span>
          )}
          {s.isSubAgent && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
              sub-agent
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded border border-zinc-800 px-3 py-2">
          <p className="text-[10px] text-zinc-500 uppercase">Messages</p>
          <p className="text-lg font-semibold tabular-nums">{s.messageCount}</p>
        </div>
        <div className="rounded border border-zinc-800 px-3 py-2">
          <p className="text-[10px] text-zinc-500 uppercase">Tokens</p>
          <p className="text-lg font-semibold tabular-nums">{formatTokens(s.totalTokens)}</p>
        </div>
        <div className="rounded border border-zinc-800 px-3 py-2">
          <p className="text-[10px] text-zinc-500 uppercase">Cost</p>
          <p className="text-lg font-semibold tabular-nums">{formatCost(s.estCost)}</p>
        </div>
        <div className="rounded border border-zinc-800 px-3 py-2">
          <p className="text-[10px] text-zinc-500 uppercase">Duration</p>
          <p className="text-lg font-semibold tabular-nums">{formatDuration(s.durationMs)}</p>
        </div>
        <div className="rounded border border-zinc-800 px-3 py-2">
          <p className="text-[10px] text-zinc-500 uppercase">Updated</p>
          <p className="text-sm text-zinc-300 mt-0.5">{timeAgo(s.updatedAt)}</p>
        </div>
      </div>

      {/* Message thread */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3">
          Messages ({messages.length})
        </h3>
        <MessageThread messages={messages} />
      </div>
    </div>
  );
}
