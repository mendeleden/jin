import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchArtifacts } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
import ArtifactViewer from "@/components/ArtifactViewer";

export default function Artifacts() {
  const [kindFilter, setKindFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const params: Record<string, string> = {};
  if (kindFilter) params.kind = kindFilter;

  const { data, isLoading } = useQuery({
    queryKey: ["artifacts", params],
    queryFn: () => fetchArtifacts(Object.keys(params).length > 0 ? params : undefined),
  });

  const kinds = data
    ? [...new Set(data.map((a) => a.kind))].sort()
    : [];

  const selected = data?.find((a) => a.id === selectedId);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Artifacts</h2>

      <div className="flex items-center gap-3">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-jin-500"
        >
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        {data && <span className="text-xs text-zinc-500">{data.length} artifacts</span>}
      </div>

      {isLoading ? (
        <div className="text-zinc-500 text-sm py-12 text-center">Loading…</div>
      ) : !data || data.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          No artifacts found.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* List */}
          <div className="space-y-1 lg:col-span-1 max-h-[600px] overflow-y-auto">
            {data.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={`w-full text-left rounded px-3 py-2 transition-colors ${
                  selectedId === a.id
                    ? "bg-zinc-800 border border-zinc-700"
                    : "hover:bg-zinc-800/50 border border-transparent"
                }`}
              >
                <p className="text-sm text-zinc-200 truncate">{a.name}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-500">
                  <span className="bg-zinc-800 px-1.5 py-0.5 rounded">{a.kind}</span>
                  <span>{a.scope}</span>
                  <span>{a.adapterId}</span>
                  {a.updatedAt && <span>{timeAgo(a.updatedAt)}</span>}
                </div>
              </button>
            ))}
          </div>

          {/* Viewer */}
          <div className="lg:col-span-2">
            {selected ? (
              <ArtifactViewer content={selected.content} kind={selected.kind} name={selected.name} />
            ) : (
              <div className="flex items-center justify-center h-48 text-zinc-500 text-sm rounded-lg border border-zinc-800 bg-zinc-900/50">
                Select an artifact to view
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
