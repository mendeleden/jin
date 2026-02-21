import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import type { Adapter, Session, Message } from "./types";

function findWarpDb(): string {
  const home = homedir();
  const p = platform();
  const candidates: string[] = [];

  if (p === "darwin") {
    candidates.push(
      join(home, "Library", "Group Containers", "2BBY89MBSN.dev.warp",
        "Library", "Application Support", "dev.warp.Warp-Stable", "warp.sqlite")
    );
  }
  if (p === "linux") {
    const xdgState = process.env.XDG_STATE_HOME || join(home, ".local", "state");
    candidates.push(join(xdgState, "warp-terminal", "warp.sqlite"));
  }
  if (p === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    candidates.push(join(localAppData, "warp", "Warp", "data", "warp.sqlite"));
  }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0] || "";
}

export class WarpAdapter implements Adapter {
  id = "warp";
  name = "Warp Terminal";
  icon = "⌘";
  private dbPath: string;

  constructor() {
    this.dbPath = findWarpDb();
  }

  async detect(): Promise<boolean> {
    return existsSync(this.dbPath);
  }

  async sessions(): Promise<Session[]> {
    if (!existsSync(this.dbPath)) return [];
    let db: Database | null = null;
    try {
      db = new Database(this.dbPath, { readonly: true });
      const rows = db.query(
        `SELECT DISTINCT working_directory, MIN(created_at) as first_at, MAX(created_at) as last_at,
         COUNT(*) as query_count
         FROM ai_queries GROUP BY working_directory ORDER BY last_at DESC`
      ).all() as any[];

      return rows.map((r, i) => ({
        id: `warp-${i}-${r.working_directory}`,
        name: r.working_directory?.split("/").pop() || "Warp Session",
        adapterId: this.id,
        adapterName: this.name,
        createdAt: r.first_at || new Date().toISOString(),
        updatedAt: r.last_at || new Date().toISOString(),
        durationMs: r.last_at && r.first_at
          ? new Date(r.last_at).getTime() - new Date(r.first_at).getTime() : 0,
        isActive: false,
        totalTokens: 0,
        estCost: 0,
        messageCount: r.query_count || 0,
        sourcePath: this.dbPath,
        isSubAgent: false,
        parentSessionId: "",
        isCompacted: false,
        metadata: { workingDirectory: r.working_directory },
      }));
    } catch {
      return [];
    } finally {
      db?.close();
    }
  }

  async messages(sessionId: string): Promise<Message[]> {
    if (!existsSync(this.dbPath)) return [];
    // Extract working_directory from session ID
    const parts = sessionId.split("-");
    const workDir = parts.slice(2).join("-");

    let db: Database | null = null;
    try {
      db = new Database(this.dbPath, { readonly: true });
      const rows = db.query(
        `SELECT query, response, created_at, model FROM ai_queries
         WHERE working_directory = ? ORDER BY created_at ASC`
      ).all(workDir) as any[];

      const messages: Message[] = [];
      for (const r of rows) {
        // Strip ANSI escape codes
        const clean = (s: string) => s?.replace(/\x1b\[[0-9;]*m/g, "") || "";

        messages.push({
          id: `warp-q-${messages.length}`,
          role: "user",
          content: clean(r.query),
          timestamp: r.created_at || "",
          model: "",
          inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
          toolUses: [], thinkingBlocks: [],
          recordType: "",
        });
        if (r.response) {
          messages.push({
            id: `warp-r-${messages.length}`,
            role: "assistant",
            content: clean(r.response),
            timestamp: r.created_at || "",
            model: r.model || "",
            inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
            toolUses: [], thinkingBlocks: [],
            recordType: "",
          });
        }
      }
      return messages;
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
