import { useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/utils";

interface FeedEvent {
  type: string;
  data: Record<string, unknown>;
  receivedAt: string;
}

export default function Feed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || "";
    const es = new EventSource(`${baseUrl}/api/feed`);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setConnected(true);
    });

    es.addEventListener("session_created", (e) => {
      addEvent("session_created", JSON.parse(e.data));
    });

    es.addEventListener("session_updated", (e) => {
      addEvent("session_updated", JSON.parse(e.data));
    });

    es.addEventListener("message_added", (e) => {
      addEvent("message_added", JSON.parse(e.data));
    });

    es.addEventListener("artifact_changed", (e) => {
      addEvent("artifact_changed", JSON.parse(e.data));
    });

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
    };
  }, []);

  function addEvent(type: string, data: Record<string, unknown>) {
    setEvents((prev) => [
      { type, data, receivedAt: new Date().toISOString() },
      ...prev.slice(0, 99),
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Live Feed</h2>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            connected
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-red-500/15 text-red-400"
          }`}
        >
          {connected ? "connected" : "disconnected"}
        </span>
      </div>

      <p className="text-xs text-zinc-500">
        Real-time events from jin ingestion. Keep <code className="text-zinc-400">jin start</code> running to see activity.
      </p>

      <div ref={feedRef} className="space-y-1 max-h-[70vh] overflow-y-auto">
        {events.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 text-sm">
            Waiting for events…
          </div>
        ) : (
          events.map((evt, i) => (
            <div
              key={i}
              className="rounded border border-zinc-800 bg-zinc-900/50 px-4 py-2 flex items-start gap-3"
            >
              <EventIcon type={evt.type} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-zinc-300">{evt.type}</span>
                  <span className="text-[10px] text-zinc-500">
                    {timeAgo(evt.receivedAt)}
                  </span>
                </div>
                <pre className="text-[10px] text-zinc-500 mt-0.5 truncate">
                  {JSON.stringify(evt.data)}
                </pre>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EventIcon({ type }: { type: string }) {
  const color =
    type === "session_created"
      ? "text-emerald-400"
      : type === "session_updated"
      ? "text-blue-400"
      : type === "message_added"
      ? "text-amber-400"
      : "text-purple-400";
  return <span className={`text-xs mt-0.5 ${color}`}>●</span>;
}
