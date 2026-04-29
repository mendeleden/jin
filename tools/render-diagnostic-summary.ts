import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

type DiagnosticEvent = {
  ts: string;
  event: string;
  rssMb: number;
  queueSize: number;
  queueItems?: string[];
  kind?: string;
  adapterId?: string;
  durationMs?: number;
  error?: string;
  processedRefs?: number;
  totalRefs?: number;
  activeAdapterCount?: number;
};

type WorkSpan = {
  lane: string;
  label: string;
  start: number;
  end: number;
  color: string;
  error: boolean;
};

function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error(
      "usage: bun tools/render-diagnostic-summary.ts <debug.jsonl> <output.svg>",
    );
    process.exit(1);
  }

  const events = readEvents(inputPath);
  if (events.length === 0) {
    console.error("no events");
    process.exit(1);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderSvg(events));
  console.log(outputPath);
}

function readEvents(path: string): DiagnosticEvent[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DiagnosticEvent);
}

function renderSvg(events: DiagnosticEvent[]): string {
  const width = 1500;
  const headerH = 88;
  const rssH = 220;
  const timelineH = 260;
  const traceH = 240;
  const height = headerH + rssH + timelineH + traceH;
  const start = toMs(events[0].ts);
  const end = toMs(events.at(-1)?.ts ?? events[0].ts);
  const range = Math.max(1, end - start);
  const left = 120;
  const right = 36;
  const chartW = width - left - right;
  const rssTop = 100;
  const timelineTop = rssTop + rssH + 32;
  const traceTop = timelineTop + timelineH + 32;
  const rssMax = Math.max(260, ...events.map((event) => event.rssMb || 0));
  const spans = buildWorkSpans(events);
  const lanes = [...new Set(spans.map((span) => span.lane))];
  const laneMap = new Map(lanes.map((lane, index) => [lane, index]));
  const detectResult = [...events]
    .reverse()
    .find((event) => event.event === "detect:result");
  const maxEvent = events.reduce((best, event) =>
    event.rssMb > best.rssMb ? event : best,
  );
  const tail = events
    .filter((event) =>
      event.event.startsWith("detect:") ||
      event.event.startsWith("queue:") ||
      event.event === "work:start" ||
      event.event === "work:end" ||
      event.event === "ingest:result",
    )
    .slice(-10);

  const rssPath = events
    .map((event, index) => {
      const x = left + ((toMs(event.ts) - start) / range) * chartW;
      const y = rssTop + rssH - ((event.rssMb || 0) / rssMax) * (rssH - 30);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const rssGrid = [0, 50, 100, 150, 200, 256]
    .filter((value) => value <= rssMax)
    .map((value) => {
      const y = rssTop + rssH - (value / rssMax) * (rssH - 30);
      const color =
        value === 256 ? "#f85149" : value === 200 ? "#d29922" : "#30363d";
      const dash = value >= 200 ? ' stroke-dasharray="5 5"' : "";
      return `
        <line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="${color}" stroke-width="1"${dash}/>
        <text x="${left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#8b949e">${value}</text>
      `;
    })
    .join("");

  const laneLabels = lanes
    .map((lane, index) => {
      const y = timelineTop + 28 + index * 28;
      return `
        <text x="12" y="${y}" font-size="12" fill="#8b949e">${escapeXml(lane)}</text>
        <line x1="${left}" y1="${y + 8}" x2="${width - right}" y2="${y + 8}" stroke="#30363d" stroke-width="1"/>
      `;
    })
    .join("");

  const timelineRects = spans
    .map((span) => {
      const laneIndex = laneMap.get(span.lane) ?? 0;
      const y = timelineTop + 16 + laneIndex * 28;
      const x = left + ((span.start - start) / range) * chartW;
      const x2 = left + ((span.end - start) / range) * chartW;
      const w = Math.max(3, x2 - x);
      return `
        <rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="16" rx="3" fill="${span.color}" fill-opacity="${span.error ? 0.96 : 0.78}"/>
        ${w > 80 ? `<text x="${(x + 4).toFixed(1)}" y="${y + 12}" font-size="11" fill="#c9d1d9">${escapeXml(span.label)}</text>` : ""}
      `;
    })
    .join("");

  const timeTicks = buildTimeTicks(start, end, left, chartW)
    .map(
      (tick) => `
        <text x="${tick.x.toFixed(1)}" y="${traceTop - 18}" text-anchor="middle" font-size="11" fill="#8b949e">${escapeXml(tick.label)}</text>
      `,
    )
    .join("");

  const traceRows = tail
    .map((event, index) => {
      const y = traceTop + 24 + index * 18;
      const snapshot =
        event.queueItems && event.queueItems.length > 0
          ? event.queueItems.join(" -> ")
          : "[]";
      const detail = [
        event.kind ? `kind=${event.kind}` : "",
        event.adapterId ? `adapter=${event.adapterId}` : "",
        typeof event.processedRefs === "number" &&
        typeof event.totalRefs === "number"
          ? `${event.processedRefs}/${event.totalRefs}`
          : "",
        event.error ? `error=${event.error}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <text x="12" y="${y}" font-size="11" fill="#c9d1d9">${escapeXml(shortTime(event.ts))}  ${escapeXml(event.event)}</text>
        <text x="320" y="${y}" font-size="11" fill="#8b949e">q=${event.queueSize}</text>
        <text x="380" y="${y}" font-size="11" fill="#8b949e">${escapeXml(snapshot)}</text>
        <text x="1040" y="${y}" font-size="11" fill="${event.error ? "#f85149" : "#8b949e"}">${escapeXml(detail)}</text>
      `;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0d1117"/>
  <text x="12" y="28" font-size="22" fill="#c9d1d9" font-family="system-ui, sans-serif">jin cold-start diagnostic summary</text>
  <text x="12" y="52" font-size="13" fill="#8b949e" font-family="system-ui, sans-serif">
    detected=${detectResult?.activeAdapterCount ?? "?"} · events=${events.length} · peak=${maxEvent.rssMb} MB at ${escapeXml(maxEvent.event)}
  </text>
  <text x="12" y="72" font-size="13" fill="#8b949e" font-family="system-ui, sans-serif">
    window=${escapeXml(shortTime(events[0].ts))} → ${escapeXml(shortTime(events.at(-1)?.ts ?? events[0].ts))}
  </text>

  <text x="12" y="${rssTop - 12}" font-size="14" fill="#c9d1d9" font-family="system-ui, sans-serif">RSS over time</text>
  ${rssGrid}
  <path d="${rssPath}" fill="none" stroke="#58a6ff" stroke-width="2"/>

  <text x="12" y="${timelineTop - 12}" font-size="14" fill="#c9d1d9" font-family="system-ui, sans-serif">Work timeline</text>
  ${laneLabels}
  ${timelineRects}

  ${timeTicks}

  <text x="12" y="${traceTop - 12}" font-size="14" fill="#c9d1d9" font-family="system-ui, sans-serif">Queue / startup trace tail</text>
  <line x1="12" y1="${traceTop - 2}" x2="${width - 12}" y2="${traceTop - 2}" stroke="#30363d" stroke-width="1"/>
  ${traceRows}
</svg>`;
}

function buildWorkSpans(events: DiagnosticEvent[]): WorkSpan[] {
  const spans: WorkSpan[] = [];
  const active = new Map<
    string,
    { start: number; lane: string; label: string; color: string }
  >();
  let detectStart: number | null = null;

  for (const event of events) {
    const ts = toMs(event.ts);
    if (event.event === "detect:start") {
      detectStart = ts;
      continue;
    }
    if (event.event === "detect:result" && detectStart !== null) {
      spans.push({
        lane: "detect",
        label: `detect ${event.activeAdapterCount ?? ""}`.trim(),
        start: detectStart,
        end: ts,
        color: "#ff7b72",
        error: false,
      });
      detectStart = null;
      continue;
    }
    if (event.event === "work:start") {
      const key = `${event.kind}:${event.adapterId ?? ""}`;
      active.set(key, {
        start: ts,
        lane:
          event.kind === "ingest-adapter"
            ? `${event.adapterId}`
            : event.kind ?? "work",
        label:
          event.kind === "ingest-adapter"
            ? `${event.adapterId} ingest`
            : event.kind ?? "work",
        color:
          event.kind === "push"
            ? "#bc8cff"
            : event.kind === "shutdown-flush"
              ? "#f85149"
              : event.kind === "reconcile-adapters"
                ? "#39d2c0"
                : "#3fb950",
      });
      continue;
    }
    if (event.event === "work:end") {
      const key = `${event.kind}:${event.adapterId ?? ""}`;
      const span = active.get(key);
      if (!span) continue;
      spans.push({
        lane: span.lane,
        label: span.label,
        start: span.start,
        end: ts,
        color: span.color,
        error: !!event.error,
      });
      active.delete(key);
    }
  }

  return spans;
}

function buildTimeTicks(start: number, end: number, left: number, width: number) {
  const ticks = 6;
  const range = Math.max(1, end - start);
  return Array.from({ length: ticks + 1 }, (_, index) => {
    const ratio = index / ticks;
    const ts = start + range * ratio;
    return {
      x: left + width * ratio,
      label: shortTime(new Date(ts).toISOString()),
    };
  });
}

function toMs(ts: string) {
  return new Date(ts).getTime();
}

function shortTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

main();
