import { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import type { Adapter, Session, Message } from "./types";

export class CursorAdapter implements Adapter {
  id = "cursor";
  name = "Cursor CLI";
  icon = "▌";
  private chatsDir: string;

  constructor() {
    this.chatsDir = join(homedir(), ".cursor", "chats");
  }

  async detect(): Promise<boolean> {
    if (!existsSync(this.chatsDir)) return false;
    try {
      const entries = readdirSync(this.chatsDir);
      return entries.some((ws) => {
        const wsPath = join(this.chatsDir, ws);
        if (!statSync(wsPath).isDirectory()) return false;
        return readdirSync(wsPath).some((sess) => {
          const dbPath = join(wsPath, sess, "store.db");
          return existsSync(dbPath);
        });
      });
    } catch {
      return false;
    }
  }

  async sessions(): Promise<Session[]> {
    if (!existsSync(this.chatsDir)) return [];
    const sessions: Session[] = [];

    for (const wsDir of readdirSync(this.chatsDir)) {
      const wsPath = join(this.chatsDir, wsDir);
      try {
        if (!statSync(wsPath).isDirectory()) continue;
      } catch { continue; }

      for (const sessDir of readdirSync(wsPath)) {
        const dbPath = join(wsPath, sessDir, "store.db");
        if (!existsSync(dbPath)) continue;

        try {
          const meta = this.readSessionMeta(dbPath);
          if (!meta) continue;

          const stat = statSync(dbPath);
          const messages = this.readMessages(dbPath);
          let firstUserMsg = "";
          for (const m of messages) {
            if (m.role === "user" && m.content) {
              firstUserMsg = m.content.slice(0, 50);
              break;
            }
          }

          const name = (meta.name && meta.name !== "New Agent")
            ? meta.name
            : firstUserMsg || sessDir.slice(0, 8);

          sessions.push({
            id: meta.agentId || sessDir,
            name,
            adapterId: this.id,
            adapterName: this.name,
            createdAt: meta.createdAt || stat.birthtime.toISOString(),
            updatedAt: stat.mtime.toISOString(),
            durationMs: stat.mtime.getTime() - (meta.createdAt ? new Date(meta.createdAt).getTime() : stat.birthtime.getTime()),
            isActive: Date.now() - stat.mtime.getTime() < 5 * 60 * 1000,
            totalTokens: 0, // Cursor doesn't track tokens
            estCost: 0,
            messageCount: messages.length,
            sourcePath: dbPath,
            isSubAgent: false,
            metadata: { workspace: wsDir },
          });
        } catch {
          continue;
        }
      }
    }

    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  }

  async messages(sessionId: string): Promise<Message[]> {
    const dbPath = this.findSessionDb(sessionId);
    if (!dbPath) return [];
    return this.readMessages(dbPath);
  }

  watchPaths(): string[] {
    if (!existsSync(this.chatsDir)) return [];
    return [this.chatsDir];
  }

  private readSessionMeta(dbPath: string): { agentId: string; name: string; createdAt: string } | null {
    let db: Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const row = db.query("SELECT value FROM meta WHERE key = '0'").get() as any;
      if (!row?.value) return null;

      // Cursor stores hex-encoded JSON
      const jsonStr = Buffer.from(row.value, "hex").toString("utf-8");
      const meta = JSON.parse(jsonStr);
      return {
        agentId: meta.agentId || meta.id || "",
        name: meta.name || "",
        createdAt: meta.createdAt ? new Date(meta.createdAt).toISOString() : "",
      };
    } catch {
      return null;
    } finally {
      db?.close();
    }
  }

  private readMessages(dbPath: string): Message[] {
    let db: Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });

      // Read meta for session structure
      const metaRow = db.query("SELECT value FROM meta WHERE key = '0'").get() as any;
      if (!metaRow?.value) return [];
      const meta = JSON.parse(Buffer.from(metaRow.value, "hex").toString("utf-8"));

      // Read all blobs
      const blobs = new Map<string, Buffer>();
      const rows = db.query("SELECT id, data FROM blobs").all() as any[];
      for (const row of rows) {
        blobs.set(row.id, row.data);
      }

      // Traverse blob tree to collect messages
      const messages: Message[] = [];
      this.collectMessages(blobs, meta.latestRootBlobId, messages);

      // Interpolate timestamps
      if (messages.length > 0) {
        const startTime = meta.createdAt ? new Date(meta.createdAt).getTime() : Date.now();
        const stat = statSync(dbPath);
        const endTime = stat.mtime.getTime();
        const duration = endTime - startTime;

        for (let i = 0; i < messages.length; i++) {
          const progress = messages.length === 1 ? 0 : i / (messages.length - 1);
          messages[i].timestamp = new Date(startTime + duration * progress).toISOString();
        }
      }

      return messages;
    } catch {
      return [];
    } finally {
      db?.close();
    }
  }

  private collectMessages(blobs: Map<string, Buffer>, rootId: string, messages: Message[]): void {
    if (!rootId || !blobs.has(rootId)) return;

    try {
      const data = JSON.parse(blobs.get(rootId)!.toString("utf-8"));
      // Cursor stores a tree of turns; recurse through children
      if (data.parentId) {
        this.collectMessages(blobs, data.parentId, messages);
      }

      if (data.role && data.content !== undefined) {
        const content = typeof data.content === "string"
          ? data.content
          : Array.isArray(data.content)
            ? data.content.map((b: any) => b.text || "").join("\n")
            : JSON.stringify(data.content);

        messages.push({
          id: rootId,
          role: data.role === "user" ? "user" : "assistant",
          content,
          timestamp: "",
          model: data.model || "",
          inputTokens: 0,
          outputTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          toolUses: [],
          thinkingBlocks: [],
        });
      }
    } catch {
      // skip corrupt blobs
    }
  }

  private findSessionDb(sessionId: string): string | null {
    if (!existsSync(this.chatsDir)) return null;
    for (const wsDir of readdirSync(this.chatsDir)) {
      const wsPath = join(this.chatsDir, wsDir);
      try {
        if (!statSync(wsPath).isDirectory()) continue;
        const dbPath = join(wsPath, sessionId, "store.db");
        if (existsSync(dbPath)) return dbPath;
      } catch { continue; }
    }
    return null;
  }
}
