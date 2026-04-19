import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { IngestResult, PipelineWorkItem, PushSummary } from "./types";

export interface DiagnosticEvent {
  ts: string;
  event: string;
  rssMb: number;
  cpuPct: number;
  queueSize: number;
  queueItems?: string[];
  [key: string]: unknown;
}

let lastCpuUsage = process.cpuUsage();
let lastCpuAtNs = process.hrtime.bigint();

function sampleCpuPct(): number {
  const nowNs = process.hrtime.bigint();
  const usage = process.cpuUsage();
  const elapsedMs = Number(nowNs - lastCpuAtNs) / 1_000_000;
  const deltaMicros =
    usage.user +
    usage.system -
    (lastCpuUsage.user + lastCpuUsage.system);

  lastCpuUsage = usage;
  lastCpuAtNs = nowNs;

  if (elapsedMs <= 0) {
    return 0;
  }

  return Math.round(((deltaMicros / 1000) / elapsedMs) * 1000) / 10;
}

export function appendDiagnosticEvent(
  path: string,
  fields: Record<string, unknown>,
  options: {
    getRssBytes?: () => number;
    getQueueSize?: () => number;
    getQueueSnapshot?: () => string[];
  } = {},
): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const getRssBytes = options.getRssBytes ?? (() => process.memoryUsage().rss);
  const getQueueSize = options.getQueueSize ?? (() => 0);
  const getQueueSnapshot = options.getQueueSnapshot ?? (() => []);

  const entry: DiagnosticEvent = {
    ts: new Date().toISOString(),
    event: String(fields.event ?? "diagnostic:unknown"),
    rssMb: Math.round(getRssBytes() / (1024 * 1024)),
    cpuPct: sampleCpuPct(),
    queueSize: getQueueSize(),
    queueItems: getQueueSnapshot(),
    ...fields,
  };

  try {
    appendFileSync(path, JSON.stringify(entry) + "\n");
  } catch {
    // Diagnostic logging must never crash the daemon.
  }
}

export class DiagnosticLogger {
  private readonly path: string;
  private readonly getRssBytes: () => number;
  private readonly getQueueSize: () => number;
  private readonly getQueueSnapshot: () => string[];

  constructor(options: {
    path: string;
    getRssBytes: () => number;
    getQueueSize: () => number;
    getQueueSnapshot: () => string[];
  }) {
    this.path = options.path;
    this.getRssBytes = options.getRssBytes;
    this.getQueueSize = options.getQueueSize;
    this.getQueueSnapshot = options.getQueueSnapshot;

    appendDiagnosticEvent(
      this.path,
      {
        event: "diagnostic:start",
        pid: process.pid,
        version: "2",
      },
      {
        getRssBytes: this.getRssBytes,
        getQueueSize: this.getQueueSize,
        getQueueSnapshot: this.getQueueSnapshot,
      },
    );
  }

  workStart(work: PipelineWorkItem): void {
    this.emit({
      event: "work:start",
      kind: work.kind,
      ...workMeta(work),
    });
  }

  workEnd(work: PipelineWorkItem, durationMs: number, error?: string): void {
    this.emit({
      event: "work:end",
      kind: work.kind,
      durationMs: Math.round(durationMs),
      ...workMeta(work),
      ...(error ? { error } : {}),
    });
  }

  ingestResult(
    adapterId: string,
    result: IngestResult,
    durationMs: number,
  ): void {
    this.emit({
      event: "ingest:result",
      adapterId,
      scannedRefs: result.scannedRefCount,
      loadedConversations: result.loadedConversationCount,
      changed: result.anyChanged,
      changedCount: result.changedConversationIds.length,
      changedIds: result.changedConversationIds.slice(0, 20),
      durationMs: Math.round(durationMs),
    });
  }

  discoveryResult(info: {
    adapterId: string;
    hintKind?: string;
    cachedSources: number;
    invalidatedSources: number;
    freshSources: number;
    cacheDisabledReason?: string;
    invalidationReason?: string;
  }): void {
    this.emit({
      event: "discovery:result",
      adapterId: info.adapterId,
      ...(info.hintKind ? { hint: info.hintKind } : {}),
      cachedSources: info.cachedSources,
      invalidatedSources: info.invalidatedSources,
      freshSources: info.freshSources,
      ...(info.cacheDisabledReason
        ? { cacheDisabledReason: info.cacheDisabledReason }
        : {}),
      ...(info.invalidationReason
        ? { invalidationReason: info.invalidationReason }
        : {}),
    });
  }

  ingestBatch(info: {
    adapterId: string;
    processedRefs: number;
    totalRefs: number;
    batchRefIds?: string[];
    batchSourcePaths?: string[];
    reclaim?: {
      beforeRssMb: number;
      afterRssMb: number;
      deltaMb: number;
    };
  }): void {
    this.emit({
      event: "ingest:batch",
      adapterId: info.adapterId,
      processedRefs: info.processedRefs,
      totalRefs: info.totalRefs,
      progress:
        info.totalRefs > 0
          ? Math.round((info.processedRefs / info.totalRefs) * 100)
          : 0,
      ...(info.batchRefIds ? { batchRefIds: info.batchRefIds.slice(0, 5) } : {}),
      ...(info.batchSourcePaths
        ? { batchSourcePaths: info.batchSourcePaths.slice(0, 3) }
        : {}),
      ...(info.reclaim ? { reclaim: info.reclaim } : {}),
    });
  }

  adapterBoundaryReclaim(
    adapterId: string,
    reclaim: {
      beforeRssMb: number;
      afterRssMb: number;
      deltaMb: number;
    },
  ): void {
    this.emit({
      event: "reclaim:adapter-boundary",
      adapterId,
      reclaim,
    });
  }

  pushStart(sinkId: string, dirtyCount: number): void {
    this.emit({
      event: "push:start",
      sinkId,
      dirtyConversations: dirtyCount,
    });
  }

  pushBatch(
    sinkId: string,
    batchSize: number,
    conversationIds: string[],
  ): void {
    this.emit({
      event: "push:batch",
      sinkId,
      batchSize,
      conversationIds: conversationIds.slice(0, 10),
    });
  }

  pushConversation(
    sinkId: string,
    conversationId: string,
    ok: boolean,
    error?: string,
  ): void {
    this.emit({
      event: ok ? "push:ok" : "push:fail",
      sinkId,
      conversationId,
      ...(error ? { error: error.slice(0, 200) } : {}),
    });
  }

  pushResult(
    summary: PushSummary,
    durationMs: number,
    sinkBreakdown?: { sinkId: string; pushed: number; failed: number }[],
  ): void {
    this.emit({
      event: "push:result",
      sinkAttempts: summary.sinkAttempts,
      pushed: summary.pushedConversations,
      failed: summary.failedConversations,
      durationMs: Math.round(durationMs),
      ...(sinkBreakdown ? { sinks: sinkBreakdown } : {}),
    });
  }

  queueEvent(
    action: "queued" | "coalesced" | "handed-off",
    kind: string,
    adapterId?: string,
  ): void {
    this.emit({
      event: `queue:${action}`,
      kind,
      ...(adapterId ? { adapterId } : {}),
    });
  }

  reconcileResult(
    adapterCount: number,
    adapterIds: string[],
    durationMs: number,
  ): void {
    this.emit({
      event: "reconcile:result",
      adapterCount,
      adapterIds,
      durationMs: Math.round(durationMs),
    });
  }

  periodicTick(): void {
    this.emit({ event: "periodic:tick" });
  }

  sinkHealth(sinkId: string, ok: boolean, error?: string): void {
    this.emit({
      event: "sink:health",
      sinkId,
      ok,
      ...(error ? { error: error.slice(0, 200) } : {}),
    });
  }

  private emit(fields: Record<string, unknown>): void {
    appendDiagnosticEvent(this.path, fields, {
      getRssBytes: this.getRssBytes,
      getQueueSize: this.getQueueSize,
      getQueueSnapshot: this.getQueueSnapshot,
    });
  }
}

function workMeta(work: PipelineWorkItem): Record<string, unknown> {
  switch (work.kind) {
    case "ingest-adapter":
      return {
        adapterId: work.adapterId,
        hint: work.hint.kind,
        ...(Array.isArray(work.hint.changedPaths) &&
        work.hint.changedPaths.length > 0
          ? { changedPaths: work.hint.changedPaths.slice(0, 8) }
          : {}),
      };
    case "ingest-all":
      return {
        hint: work.hint.kind,
        ...(Array.isArray(work.hint.changedPaths) &&
        work.hint.changedPaths.length > 0
          ? { changedPaths: work.hint.changedPaths.slice(0, 8) }
          : {}),
      };
    default:
      return {};
  }
}
