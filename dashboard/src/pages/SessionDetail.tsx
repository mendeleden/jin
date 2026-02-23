import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchSession } from "@/lib/api";
import type { SessionSummary } from "@/lib/api";
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

  const { session: s, messages, tags, parent, children } = data;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Link
            to="/sessions"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Sessions
          </Link>
          {parent && (
            <>
              <span className="text-zinc-700 text-xs">/</span>
              <Link
                to={`/sessions/${parent.id}`}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors truncate max-w-[200px]"
              >
                {parent.name || parent.id.slice(0, 12)}
              </Link>
            </>
          )}
        </div>
        <h2 className="text-lg font-semibold mt-1.5 leading-snug">
          {s.name || s.id.slice(0, 16)}
        </h2>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span
            className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full"
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

      {/* Stats — compact inline row */}
      <div className="flex items-center gap-4 text-xs text-zinc-400 flex-wrap">
        <span className="tabular-nums">{messages.length} messages</span>
        <span className="text-zinc-700">·</span>
        <span className="tabular-nums">{formatTokens(s.totalTokens)} tokens</span>
        <span className="text-zinc-700">·</span>
        <span className="tabular-nums">{formatCost(s.estCost)}</span>
        <span className="text-zinc-700">·</span>
        <span>{formatDuration(s.durationMs)}</span>
        <span className="text-zinc-700">·</span>
        <span>{timeAgo(s.updatedAt)}</span>
        {children.length > 0 && (
          <>
            <span className="text-zinc-700">·</span>
            <span className="text-amber-400/70">
              {children.length} sub-agent{children.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>

      {/* Children list (if any) */}
      {children.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {children.map((child) => (
            <Link
              key={child.id}
              to={`/sessions/${child.id}`}
              className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-amber-500/15 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
            >
              <span className="text-amber-400/60">↳</span>
              <span className="text-zinc-300 truncate max-w-[200px]">
                {child.name || child.id.slice(0, 12)}
              </span>
              <span className="text-zinc-600 tabular-nums">
                {child.messageCount} msgs
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Message thread */}
      <MessageThread messages={messages} children={children} />
    </div>
  );
}
