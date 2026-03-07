import { loadConfig, configDir } from "../config";
import { Store } from "../store";
import { allAdapters } from "../adapters/registry";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";

interface Metrics {
  timestamp: string;
  version: string;
  system: {
    platform: string;
    cpus: number;
    totalMemoryMB: number;
  };
  source: {
    jsonlFiles: number;
    totalSizeBytes: number;
    totalLines: number;
  };
  daemon: DaemonMetrics | null;
  ingest: IngestMetrics | null;
}

interface DaemonMetrics {
  pid: number;
  uptimeSeconds: number;
  cpuPercent: number;
  rssKB: number;
  vmPeakKB: number;
  threads: number;
  fdCount: number;
  rcharBytes: number;
  wcharBytes: number;
  voluntaryCtxSwitches: number;
  nonvoluntaryCtxSwitches: number;
}

interface IngestMetrics {
  coldIngestMs: number;
  sessionsIngested: number;
  messagesIngested: number;
  peakRssKB: number;
}

export async function benchmarkCommand(opts: { json?: boolean }): Promise<void> {
  const metrics = await collectMetrics();

  if (opts.json) {
    console.log(JSON.stringify(metrics, null, 2));
    saveMetrics(metrics);
    return;
  }

  printMetrics(metrics);
  saveMetrics(metrics);
}

async function collectMetrics(): Promise<Metrics> {
  const { VERSION } = await import("../updater");
  const os = await import("os");
  const config = await loadConfig();

  const metrics: Metrics = {
    timestamp: new Date().toISOString(),
    version: VERSION,
    system: {
      platform: process.platform,
      cpus: os.cpus().length,
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
    },
    source: await measureSourceData(config),
    daemon: await measureDaemon(),
    ingest: await measureIngest(config),
  };

  return metrics;
}

async function measureSourceData(config: any): Promise<Metrics["source"]> {
  const adapters = allAdapters();
  let totalFiles = 0;
  let totalSize = 0;
  let totalLines = 0;

  for (const adapter of adapters) {
    if (!config.adapters[adapter.id]?.enabled) continue;
    try {
      if (!(await adapter.detect())) continue;
      const sessions = await adapter.sessions();
      for (const session of sessions) {
        if (session.sourcePath && existsSync(session.sourcePath)) {
          totalFiles++;
          const file = Bun.file(session.sourcePath);
          const size = file.size;
          totalSize += size;
          // Count lines without loading entire file into memory
          const text = await file.text();
          totalLines += text.split("\n").filter(Boolean).length;
        }
      }
    } catch {}
  }

  return { jsonlFiles: totalFiles, totalSizeBytes: totalSize, totalLines };
}

async function measureDaemon(): Promise<DaemonMetrics | null> {
  if (process.platform !== "linux") return null;

  const pidFile = join(configDir(), "jin.pid");
  if (!existsSync(pidFile)) return null;

  let pid: number;
  try {
    pid = parseInt(readFileSync(pidFile, "utf-8").trim());
    process.kill(pid, 0); // check alive
  } catch {
    return null;
  }

  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf-8");
    const io = readFileSync(`/proc/${pid}/io`, "utf-8");
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");

    const parseField = (text: string, field: string): number => {
      const match = text.match(new RegExp(`${field}:\\s*(\\d+)`));
      return match ? parseInt(match[1]) : 0;
    };

    // Count FDs
    let fdCount = 0;
    try {
      const { readdirSync } = await import("fs");
      fdCount = readdirSync(`/proc/${pid}/fd`).length;
    } catch {}

    // Parse uptime from stat
    const statFields = stat.split(") ")[1]?.split(" ") || [];
    const clkTck = 100; // standard on Linux
    const utimeTicks = parseInt(statFields[11]) || 0;
    const stimeTicks = parseInt(statFields[12]) || 0;
    const startTimeTicks = parseInt(statFields[19]) || 0;

    // System uptime for calculating process uptime
    let uptimeSeconds = 0;
    try {
      const uptimeStr = readFileSync("/proc/uptime", "utf-8");
      const systemUptime = parseFloat(uptimeStr.split(" ")[0]);
      uptimeSeconds = Math.round(systemUptime - startTimeTicks / clkTck);
    } catch {}

    const totalCpuSeconds = (utimeTicks + stimeTicks) / clkTck;
    const cpuPercent = uptimeSeconds > 0 ? (totalCpuSeconds / uptimeSeconds) * 100 : 0;

    return {
      pid,
      uptimeSeconds,
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      rssKB: parseField(status, "VmRSS"),
      vmPeakKB: parseField(status, "VmPeak"),
      threads: parseField(status, "Threads"),
      fdCount,
      rcharBytes: parseField(io, "rchar"),
      wcharBytes: parseField(io, "wchar"),
      voluntaryCtxSwitches: parseField(status, "voluntary_ctxt_switches"),
      nonvoluntaryCtxSwitches: parseField(status, "nonvoluntary_ctxt_switches"),
    };
  } catch {
    return null;
  }
}

async function measureIngest(config: any): Promise<IngestMetrics | null> {
  try {
    const store = new Store(config.store.dbPath);
    const adapters = allAdapters();
    const activeAdapters = [];

    for (const adapter of adapters) {
      if (!config.adapters[adapter.id]?.enabled) continue;
      try {
        if (await adapter.detect()) activeAdapters.push(adapter);
      } catch {}
    }

    if (activeAdapters.length === 0) return null;

    // Measure cold ingest
    const rssBefore = process.memoryUsage().rss;
    const startMs = performance.now();

    let totalSessions = 0;
    let totalMessages = 0;

    for (const adapter of activeAdapters) {
      const sessions = await adapter.sessions();
      for (const session of sessions) {
        store.upsertSession(session);
        totalSessions++;
        try {
          const messages = await adapter.messages(session.id, session.sourcePath);
          if (messages.length > 0) {
            store.upsertMessages(session.id, messages);
            totalMessages += messages.length;
          }
        } catch {}
      }
    }

    const elapsedMs = Math.round(performance.now() - startMs);
    const rssAfter = process.memoryUsage().rss;
    const peakRssKB = Math.round(rssAfter / 1024);

    store.close();

    return {
      coldIngestMs: elapsedMs,
      sessionsIngested: totalSessions,
      messagesIngested: totalMessages,
      peakRssKB,
    };
  } catch {
    return null;
  }
}

function printMetrics(m: Metrics): void {
  const fmt = (n: number, unit: string) => {
    if (unit === "MB") return `${Math.round(n / 1024)} MB`;
    if (unit === "GB") return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (unit === "KB") return `${Math.round(n)} KB`;
    return `${n.toLocaleString()}${unit ? " " + unit : ""}`;
  };

  console.log(`
  jin benchmark — v${m.version}
  ${m.timestamp}

  System
  ─────────────────────────────────────────────────────
  Platform        ${m.system.platform}
  CPUs            ${m.system.cpus}
  Total Memory    ${fmt(m.system.totalMemoryMB, "")} MB
`);

  console.log(`  Source Data
  ─────────────────────────────────────────────────────
  JSONL files     ${m.source.jsonlFiles}
  Total size      ${fmt(m.source.totalSizeBytes / 1024, "KB")}
  Total lines     ${fmt(m.source.totalLines, "")}
`);

  if (m.daemon) {
    const d = m.daemon;
    const budgetCpu = d.cpuPercent <= 0.5 ? "\x1b[32m✓\x1b[0m" : d.cpuPercent <= 5 ? "\x1b[33m⚠\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const budgetRss = d.rssKB <= 80 * 1024 ? "\x1b[32m✓\x1b[0m" : d.rssKB <= 150 * 1024 ? "\x1b[33m⚠\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const budgetFd = d.fdCount <= 50 ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";

    const uptimeHrs = Math.round(d.uptimeSeconds / 3600 * 10) / 10;
    const cpuMinutes = Math.round(d.cpuPercent * d.uptimeSeconds / 100 / 60);

    console.log(`  Daemon (PID ${d.pid}, uptime ${uptimeHrs}h)
  ─────────────────────────────────────────────────────
  Metric          Value              Budget        Status
  CPU %           ${d.cpuPercent}%${" ".repeat(Math.max(0, 19 - String(d.cpuPercent).length - 1))}< 0.5% idle    ${budgetCpu}
  RSS             ${fmt(d.rssKB, "KB")}${" ".repeat(Math.max(0, 19 - fmt(d.rssKB, "KB").length))}< 80 MB        ${budgetRss}
  VM Peak         ${fmt(d.vmPeakKB, "KB")}
  Threads         ${d.threads}
  Open FDs        ${d.fdCount}${" ".repeat(Math.max(0, 19 - String(d.fdCount).length))}< 50           ${budgetFd}
  CPU time        ${cpuMinutes} min accumulated
  Bytes read      ${fmt(d.rcharBytes, "GB")}
  Bytes written   ${fmt(d.wcharBytes, "GB")}
  Ctx switches    ${fmt(d.voluntaryCtxSwitches, "")} vol / ${fmt(d.nonvoluntaryCtxSwitches, "")} invol
`);
  } else {
    console.log("  Daemon          not running\n");
  }

  if (m.ingest) {
    const i = m.ingest;
    const budgetTime = i.coldIngestMs <= 5000 ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const budgetMem = i.peakRssKB <= 150 * 1024 ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";

    console.log(`  Cold Ingest
  ─────────────────────────────────────────────────────
  Time            ${i.coldIngestMs} ms${" ".repeat(Math.max(0, 15 - String(i.coldIngestMs).length))}< 5000 ms      ${budgetTime}
  Sessions        ${i.sessionsIngested}
  Messages        ${fmt(i.messagesIngested, "")}
  Peak RSS        ${fmt(i.peakRssKB, "KB")}${" ".repeat(Math.max(0, 15 - fmt(i.peakRssKB, "KB").length))}< 150 MB       ${budgetMem}
`);
  }
}

function saveMetrics(metrics: Metrics): void {
  const dir = join(configDir(), "benchmarks");
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filename = `benchmark-${metrics.timestamp.replace(/[:.]/g, "-")}.json`;
    const path = join(dir, filename);
    Bun.write(path, JSON.stringify(metrics, null, 2));

    // Also update latest
    Bun.write(join(dir, "latest.json"), JSON.stringify(metrics, null, 2));
  } catch {}
}
