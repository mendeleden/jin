import { loadConfig } from "../config";
import { Store } from "../store";
import { allAdapters } from "../adapters/registry";
import { createSink } from "../sinks/registry";
import { autoTagSession } from "../tagger";
import { sinksForSession } from "../routing";
import type { Sink, PushPayload } from "../sinks/types";
import { mkdirSync, existsSync, copyFileSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";

export async function reingestCommand(opts: {
  push?: boolean;
  adapter?: string;
  json?: boolean;
}): Promise<void> {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  if (!existsSync(config.store.rawDir)) {
    mkdirSync(config.store.rawDir, { recursive: true });
  }

  const adapters = allAdapters();
  let totalSessions = 0;
  let totalMessages = 0;
  let totalArtifacts = 0;
  const allSessionIds = new Set<string>();

  for (const adapter of adapters) {
    if (!config.adapters[adapter.id]?.enabled) continue;
    if (opts.adapter && adapter.id !== opts.adapter) continue;
    try {
      if (!(await adapter.detect())) continue;
    } catch { continue; }

    console.log(`  Re-ingesting ${adapter.name}...`);

    try {
      const sessions = await adapter.sessions();
      for (const session of sessions) {
        store.upsertSession(session);
        allSessionIds.add(session.id);
        totalSessions++;

        // Copy raw file
        if (session.sourcePath && existsSync(session.sourcePath)) {
          try {
            const destDir = join(config.store.rawDir, adapter.id);
            if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
            const ext = getExt(session.sourcePath);
            const dest = join(destDir, `${session.id}${ext}`);
            const content = await Bun.file(session.sourcePath).arrayBuffer();
            const hash = createHash("sha256").update(Buffer.from(content)).digest("hex");
            copyFileSync(session.sourcePath, dest);
            session.metadata = { ...session.metadata, fileHash: hash, rawCopyPath: dest };
            store.upsertSession(session);
          } catch { /* skip copy errors */ }
        }

        try {
          const messages = await adapter.messages(session.id, session.sourcePath);
          if (messages.length > 0) {
            store.upsertMessages(session.id, messages);
            totalMessages += messages.length;
            autoTagSession(store, session, messages);
          }
        } catch { /* skip message errors */ }
      }

      // Collect context artifacts
      if (adapter.artifacts) {
        try {
          const artifacts = await adapter.artifacts();
          for (const artifact of artifacts) {
            store.upsertArtifact(artifact);
            totalArtifacts++;
          }
        } catch { /* skip artifact errors */ }
      }
    } catch (err) {
      console.error(`    Error: ${err}`);
    }
  }

  // Refresh project aggregate stats
  store.refreshProjectStats();

  console.log(`\n  Done. ${totalSessions} sessions, ${totalMessages} messages, ${totalArtifacts} artifacts re-ingested.`);

  // Push to sinks if requested
  if (opts.push) {
    const sinks: Sink[] = [];
    for (const sc of config.sinks || []) {
      try {
        const sink = createSink(sc);
        sinks.push(sink);
      } catch {}
    }

    if (sinks.length === 0) {
      console.log("  No sinks configured — skipping push.");
    } else {
      console.log(`  Pushing ${allSessionIds.size} sessions to ${sinks.length} sink(s)...`);

      const sinkPayloads = new Map<Sink, PushPayload[]>();
      for (const id of allSessionIds) {
        const session = store.getSession(id);
        if (!session) continue;
        const messages = store.getMessages(id);
        const payload: PushPayload = { session, messages };
        const targetSinks = sinksForSession(session, store, config, sinks);
        for (const sink of targetSinks) {
          if (!sinkPayloads.has(sink)) sinkPayloads.set(sink, []);
          sinkPayloads.get(sink)!.push(payload);
        }
      }

      for (const [sink, payloads] of sinkPayloads) {
        if (payloads.length === 0) continue;
        try {
          const result = await sink.push(payloads);
          console.log(`  Pushed ${result.pushed} to ${sink.name}${result.failed ? `, ${result.failed} failed` : ""}`);
          if (result.errors.length > 0) {
            for (const e of result.errors.slice(0, 3)) console.log(`    Error: ${e}`);
          }
        } catch (err) {
          console.error(`  Push error (${sink.name}): ${err}`);
        }
      }
    }
  }

  store.close();
}

function getExt(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}
