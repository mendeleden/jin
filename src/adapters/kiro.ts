import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import type { Adapter, Session, Message } from "./types";

function findKiroDb(): string {
  const home = homedir();
  const candidates: string[] = [
    join(home, ".kiro", "data.sqlite3"),
  ];

  if (platform() === "darwin") {
    candidates.push(join(home, "Library", "Application Support", "kiro-cli", "data.sqlite3"));
  }
  if (platform() === "linux") {
    const xdgData = process.env.XDG_DATA_HOME || join(home, ".local", "share");
    candidates.push(join(xdgData, "kiro-cli", "data.sqlite3"));
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, ".config");
    candidates.push(join(xdgConfig, "kiro-cli", "data.sqlite3"));
  }
  // Legacy Amazon Q path
  candidates.push(join(home, ".amazonq", "data.sqlite3"));

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0] || "";
}

export class KiroAdapter implements Adapter {
  id = "kiro";
  name = "Kiro";
  icon = "K";
  private dbPath: string;

  constructor() {
    this.dbPath = findKiroDb();
  }

  async detect(): Promise<boolean> {
    return existsSync(this.dbPath);
  }

  async sessions(): Promise<Session[]> {
    if (!existsSync(this.dbPath)) return [];
    let db: Database | null = null;
    try {
      db = new Database(this.dbPath, { readonly: true });

      // Try common table names for Kiro/Amazon Q
      const tables = db.query(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all() as any[];
      const tableNames = tables.map((t) => t.name);

      // Look for conversations/sessions/chats table
      let sessionsTable = "";
      for (const candidate of ["conversations", "sessions", "chats"]) {
        if (tableNames.includes(candidate)) {
          sessionsTable = candidate;
          break;
        }
      }
      if (!sessionsTable) return [];

      const rows = db.query(
        `SELECT * FROM ${sessionsTable} ORDER BY rowid DESC LIMIT 500`
      ).all() as any[];

      return rows.map((r, i) => ({
        id: r.id || r.session_id || r.conversation_id || `kiro-${i}`,
        name: r.title || r.name || r.id?.slice(0, 8) || `Kiro Session ${i}`,
        adapterId: this.id,
        adapterName: this.name,
        createdAt: r.created_at || r.createdAt || new Date().toISOString(),
        updatedAt: r.updated_at || r.updatedAt || new Date().toISOString(),
        durationMs: 0,
        isActive: false,
        totalTokens: 0,
        estCost: 0,
        messageCount: r.message_count || 0,
        sourcePath: this.dbPath,
        isSubAgent: false,
        metadata: {},
      }));
    } catch {
      return [];
    } finally {
      db?.close();
    }
  }

  async messages(sessionId: string): Promise<Message[]> {
    if (!existsSync(this.dbPath)) return [];
    let db: Database | null = null;
    try {
      db = new Database(this.dbPath, { readonly: true });

      const tables = db.query(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all() as any[];
      const tableNames = tables.map((t) => t.name);

      let messagesTable = "";
      for (const candidate of ["messages", "turns", "chat_messages"]) {
        if (tableNames.includes(candidate)) {
          messagesTable = candidate;
          break;
        }
      }
      if (!messagesTable) return [];

      // Try common foreign key column names
      let rows: any[] = [];
      for (const fk of ["conversation_id", "session_id", "chat_id"]) {
        try {
          rows = db.query(
            `SELECT * FROM ${messagesTable} WHERE ${fk} = ? ORDER BY rowid ASC`
          ).all(sessionId) as any[];
          if (rows.length > 0) break;
        } catch { continue; }
      }

      return rows.map((r, i) => ({
        id: r.id || `kiro-msg-${i}`,
        role: (r.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: r.content || r.text || r.body || "",
        timestamp: r.created_at || r.timestamp || "",
        model: r.model || "",
        inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
        toolUses: [], thinkingBlocks: [],
      }));
    } catch {
      return [];
    } finally {
      db?.close();
    }
  }

  watchPaths(): string[] {
    return existsSync(this.dbPath) ? [this.dbPath] : [];
  }
}
