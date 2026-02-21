import { loadConfig } from "../config";
import { Store } from "../store";
import { allAdapters } from "../adapters/registry";
import { mkdirSync, existsSync, copyFileSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";

export async function ingestCommand(): Promise<void> {
  const config = await loadConfig();
  const store = new Store(config.store.dbPath);

  if (!existsSync(config.store.rawDir)) {
    mkdirSync(config.store.rawDir, { recursive: true });
  }

  const adapters = allAdapters();
  let totalSessions = 0;
  let totalMessages = 0;

  for (const adapter of adapters) {
    if (!config.adapters[adapter.id]?.enabled) continue;
    try {
      if (!(await adapter.detect())) continue;
    } catch { continue; }

    console.log(`  Ingesting ${adapter.name}...`);

    try {
      const sessions = await adapter.sessions();
      for (const session of sessions) {
        store.upsertSession(session);
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
          const messages = await adapter.messages(session.id);
          if (messages.length > 0) {
            store.upsertMessages(session.id, messages);
            totalMessages += messages.length;
          }
        } catch { /* skip message errors */ }
      }
    } catch (err) {
      console.error(`    Error: ${err}`);
    }
  }

  console.log(`\n  Done. ${totalSessions} sessions, ${totalMessages} messages ingested.`);
  store.close();
}

function getExt(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}
