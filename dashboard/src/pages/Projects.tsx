import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchProjects, fetchProjectSessions } from "@/lib/api";
import { formatCost, formatTokens, timeAgo } from "@/lib/utils";
import SessionTable from "@/components/SessionTable";

export default function Projects() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
  });
  const { data: projectSessions } = useQuery({
    queryKey: ["project-sessions", selectedId],
    queryFn: () => fetchProjectSessions(selectedId!),
    enabled: !!selectedId,
  });

  if (isLoading) {
    return <div className="text-zinc-500 text-sm py-12 text-center">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Projects</h2>

      {!projects || projects.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          No projects found. Projects are auto-detected during ingestion.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}
              className={`text-left rounded-lg border p-4 transition-colors ${
                selectedId === p.id
                  ? "border-jin-500/50 bg-jin-500/5"
                  : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
              }`}
            >
              <h3 className="font-medium text-zinc-200 truncate">{p.name}</h3>
              {p.directory && (
                <p className="text-[10px] text-zinc-500 font-mono truncate mt-0.5">
                  {p.directory}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-zinc-400">
                <span>{p.session_count} sessions</span>
                <span>{formatTokens(p.total_tokens)} tokens</span>
                <span>{formatCost(p.total_cost)}</span>
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-500">
                {p.tools && p.tools.split(",").map((t: string) => (
                  <span key={t}>{t}</span>
                ))}
                {p.language && <span>· {p.language}</span>}
                {p.last_seen && <span>· {timeAgo(p.last_seen)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Drill-down */}
      {selectedId && projectSessions && (
        <div>
          <h3 className="text-sm font-medium text-zinc-400 mb-3">
            Sessions for project
          </h3>
          <SessionTable sessions={projectSessions} />
        </div>
      )}
    </div>
  );
}
