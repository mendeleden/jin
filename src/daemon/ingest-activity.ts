import { closeSync, existsSync, openSync, readSync, statSync } from "fs";
import { join } from "path";
import { configDir } from "../config";

const TAIL_BYTES = 64 * 1024;

export interface IngestActivity {
  active: {
    adapter: string;
    hint: string;
    processedRefs?: number;
    totalRefs?: number;
    currentSourcePath?: string;
  } | null;
  queued: string[];
  coldStart: boolean;
}

export function readIngestActivity(): IngestActivity | null {
  const debugPath = join(configDir(), "debug.jsonl");
  if (!existsSync(debugPath)) return null;

  const lines = readTailLines(debugPath, TAIL_BYTES);
  if (lines.length === 0) return null;

  const workSlots = new Map<string, { start: Event | null; end: Event | null }>();
  let queueSnapshot: string[] = [];

  for (const line of lines) {
    const evt = safeParse(line);
    if (!evt) continue;
    const event = evt.event;
    const adapterId = typeof evt.adapterId === "string" ? evt.adapterId : "";

    if (event === "work:start" && evt.kind === "ingest-adapter" && adapterId) {
      workSlots.set(adapterId, { start: evt, end: null });
    } else if (event === "work:end" && evt.kind === "ingest-adapter" && adapterId) {
      const slot = workSlots.get(adapterId);
      if (slot) slot.end = evt;
    }

    if (Array.isArray(evt.queueItems)) {
      queueSnapshot = (evt.queueItems as string[]).filter((s) =>
        s.startsWith("ingest-adapter:"),
      );
    }
  }

  let activeAdapter: string | null = null;
  let activeHint = "";
  for (const [adapter, slot] of workSlots) {
    if (slot.start && !slot.end) {
      activeAdapter = adapter;
      activeHint = typeof slot.start.hint === "string" ? slot.start.hint : "";
      break;
    }
  }

  let processedRefs: number | undefined;
  let totalRefs: number | undefined;
  let currentSourcePath: string | undefined;

  if (activeAdapter) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const evt = safeParse(lines[i]!);
      if (!evt) continue;
      if (evt.event === "ingest:batch" && evt.adapterId === activeAdapter) {
        if (typeof evt.processedRefs === "number") processedRefs = evt.processedRefs;
        if (typeof evt.totalRefs === "number") totalRefs = evt.totalRefs;
        if (Array.isArray(evt.batchSourcePaths) && evt.batchSourcePaths.length > 0) {
          const last = evt.batchSourcePaths[evt.batchSourcePaths.length - 1];
          if (typeof last === "string") currentSourcePath = last;
        }
        break;
      }
    }
  }

  const queued = queueSnapshot
    .map((s) => s.replace(/^ingest-adapter:/, ""))
    .filter((q) => q !== activeAdapter);

  return {
    active: activeAdapter
      ? {
          adapter: activeAdapter,
          hint: activeHint,
          processedRefs,
          totalRefs,
          currentSourcePath,
        }
      : null,
    queued,
    coldStart: activeHint === "startup-scan",
  };
}

type Event = Record<string, unknown>;

function safeParse(line: string): Event | null {
  try {
    return JSON.parse(line) as Event;
  } catch {
    return null;
  }
}

function readTailLines(path: string, byteWindow: number): string[] {
  const stats = statSync(path);
  const offset = Math.max(0, stats.size - byteWindow);
  const length = stats.size - offset;
  if (length === 0) return [];

  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, offset);
    return buffer.toString("utf-8").split("\n").filter((s) => s.length > 0);
  } finally {
    closeSync(fd);
  }
}
