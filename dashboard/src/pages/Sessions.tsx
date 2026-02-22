import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSessions } from "@/lib/api";
import SessionTable from "@/components/SessionTable";

export default function Sessions() {
  const [adapter, setAdapter] = useState("");
  const [search, setSearch] = useState("");

  const params: Record<string, string> = {};
  if (adapter) params.adapter = adapter;
  if (search) params.search = search;

  const { data, isLoading } = useQuery({
    queryKey: ["sessions", params],
    queryFn: () => fetchSessions(Object.keys(params).length > 0 ? params : undefined),
  });

  // Extract unique adapters for filter
  const adapters = data
    ? [...new Set(data.map((s) => s.adapter_id))].sort()
    : [];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Sessions</h2>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search sessions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-jin-500 w-64"
        />
        <select
          value={adapter}
          onChange={(e) => setAdapter(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-jin-500"
        >
          <option value="">All tools</option>
          {adapters.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {(adapter || search) && (
          <button
            onClick={() => {
              setAdapter("");
              setSearch("");
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-zinc-500 text-sm py-12 text-center">Loading…</div>
      ) : data ? (
        <>
          <div className="text-xs text-zinc-500">{data.length} sessions</div>
          <SessionTable sessions={data} />
        </>
      ) : null}
    </div>
  );
}
