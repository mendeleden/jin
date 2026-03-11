import { loadConfig } from "../config";
import { Store } from "../store";
import { allAdapters } from "../adapters/registry";
import { autoTagSession } from "../tagger";
import { existsSync, mkdirSync } from "fs";

export async function ingestCommand(): Promise<void> {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  if (!existsSync(config.store.rawDir)) {
    mkdirSync(config.store.rawDir, { recursive: true });
  }

  const adapters = allAdapters();
  let totalSessions = 0;
  let totalMessages = 0;
  let totalArtifacts = 0;

  for (const adapter of adapters) {
    if (!config.adapters[adapter.id]?.enabled) continue;
    try {
      if (!(await adapter.detect())) continue;
    } catch { continue; }

    console.log(`  Ingesting ${adapter.name}...`);

    try {
      const sessions = await adapter.sessions();
      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        store.upsertSession(session);
        totalSessions++;

        try {
          const messages = await adapter.messages(session.id, session.sourcePath);
          if (messages.length > 0) {
            store.upsertMessages(session.id, messages);
            totalMessages += messages.length;

            // Auto-tag: derive project, tags, tool usage stats
            autoTagSession(store, session, messages);
          }
        } catch { /* skip message errors */ }

        // Backpressure: yield between batches so GC can reclaim file buffers
        if ((i + 1) % 20 === 0) {
          Bun.gc(false);
          await Bun.sleep(0);
        }
      }

      // Collect context artifacts (memory, configs, rules, etc.)
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

  console.log(`\n  Done. ${totalSessions} sessions, ${totalMessages} messages, ${totalArtifacts} artifacts ingested.`);
  store.close();
}
