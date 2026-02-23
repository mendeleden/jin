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

      {/* Session tree: parent + children */}
      {(parent || children.length > 0) && (
        <SessionTree
          current={s}
          parent={parent}
          children={children}
        />
      )}

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

function SessionTree({
  current,
  parent,
  children,
}: {
  current: { id: string; name: string };
  parent: SessionSummary | null;
  children: SessionSummary[];
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
        Session Tree
      </h3>
      <div className="space-y-1 text-sm">
        {/* Parent */}
        {parent && (
          <div className="flex items-center gap-2">
            <span className="text-zinc-600 w-5 text-center">↑</span>
            <Link
              to={`/sessions/${parent.id}`}
              className="text-zinc-300 hover:text-jin-400 transition-colors truncate"
            >
              {parent.name || parent.id.slice(0, 16)}
            </Link>
            <span className="text-[10px] text-zinc-500">parent</span>
            <span className="text-[10px] text-zinc-600">
              {parent.messageCount} msgs · {formatTokens(parent.totalTokens)} · {formatCost(parent.estCost)}
            </span>
          </div>
        )}

        {/* Current (highlighted) */}
        <div className="flex items-center gap-2">
          <span className="text-jin-400 w-5 text-center">●</span>
          <span className="text-zinc-100 font-medium truncate">
            {current.name || current.id.slice(0, 16)}
          </span>
          <span className="text-[10px] text-jin-400">current</span>
        </div>

        {/* Children */}
        {children.map((child, i) => (
          <div key={child.id} className="flex items-center gap-2">
            <span className="text-zinc-600 w-5 text-center">
              {i === children.length - 1 ? "└" : "├"}
            </span>
            <Link
              to={`/sessions/${child.id}`}
              className="text-zinc-300 hover:text-jin-400 transition-colors truncate"
            >
              {child.name || child.id.slice(0, 16)}
            </Link>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400/80">
              sub-agent
            </span>
            <span className="text-[10px] text-zinc-600">
              {child.messageCount} msgs · {formatTokens(child.totalTokens)} · {formatCost(child.estCost)}
            </span>
          </div>
        ))}
      </div>

      {/* Aggregate stats for children */}
      {children.length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center gap-4 text-xs text-zinc-500">
          <span>{children.length} sub-agent{children.length !== 1 ? "s" : ""}</span>
          <span>
            {formatTokens(children.reduce((a, c) => a + c.totalTokens, 0))} tokens total
          </span>
          <span>
            {formatCost(children.reduce((a, c) => a + c.estCost, 0))} cost total
          </span>
        </div>
      )}
    </div>
  );
}
