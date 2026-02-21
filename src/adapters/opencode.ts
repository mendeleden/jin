import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir, platform } from "os";
import type { Adapter, Session, Message } from "./types";

function findStorageDir(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "opencode", "storage");
  }
  const xdgData = process.env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(xdgData, "opencode", "storage");
}

export class OpenCodeAdapter implements Adapter {
  id = "opencode";
  name = "OpenCode";
  icon = "○";
  private storageDir: string;

  constructor() {
    this.storageDir = findStorageDir();
  }

  async detect(): Promise<boolean> {
    return existsSync(this.storageDir);
  }

  async sessions(): Promise<Session[]> {
    if (!existsSync(this.storageDir)) return [];
    const sessions: Session[] = [];
    const sessionsDir = join(this.storageDir, "sessions");

    if (!existsSync(sessionsDir)) {
      // Try reading directly from storage dir
      return this.scanDirectory(this.storageDir);
    }
    return this.scanDirectory(sessionsDir);
  }

  async messages(sessionId: string): Promise<Message[]> {
    const filePath = this.findSessionFile(sessionId);
    if (!filePath) return [];

    try {
      const data = await Bun.file(filePath).json();
      return this.extractMessages(data);
    } catch {
      // Try JSONL format
      try {
        const text = await Bun.file(filePath).text();
        return this.parseJsonl(text);
      } catch {
        return [];
      }
    }
  }

  watchPaths(): string[] {
    const paths: string[] = [];
    if (existsSync(this.storageDir)) paths.push(this.storageDir);
    const sessionsDir = join(this.storageDir, "sessions");
    if (existsSync(sessionsDir)) paths.push(sessionsDir);
    return paths;
  }

  private async scanDirectory(dir: string): Promise<Session[]> {
    const sessions: Session[] = [];
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && (entry.endsWith(".json") || entry.endsWith(".jsonl"))) {
          const sessionId = basename(entry, entry.endsWith(".jsonl") ? ".jsonl" : ".json");
          let msgCount = 0;
          let name = sessionId;

          if (entry.endsWith(".json")) {
            const data = await Bun.file(fullPath).json();
            const msgs = this.extractMessages(data);
            msgCount = msgs.length;
            for (const m of msgs) {
              if (m.role === "user" && m.content) {
                name = m.content.slice(0, 120).replace(/\n/g, " ");
                break;
              }
            }
          } else {
            const text = await Bun.file(fullPath).text();
            const msgs = this.parseJsonl(text);
            msgCount = msgs.length;
          }

          if (msgCount === 0) continue;

          sessions.push({
            id: sessionId,
            name,
            adapterId: this.id,
            adapterName: this.name,
            createdAt: stat.birthtime.toISOString(),
            updatedAt: stat.mtime.toISOString(),
            durationMs: stat.mtime.getTime() - stat.birthtime.getTime(),
            isActive: Date.now() - stat.mtime.getTime() < 5 * 60 * 1000,
            totalTokens: 0,
            estCost: 0,
            messageCount: msgCount,
            sourcePath: fullPath,
            isSubAgent: false,
            metadata: {},
          });
        }
      } catch { continue; }
    }
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  }

  private findSessionFile(sessionId: string): string | null {
    const dirs = [
      join(this.storageDir, "sessions"),
      this.storageDir,
    ];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const ext of [".json", ".jsonl"]) {
        const path = join(dir, `${sessionId}${ext}`);
        if (existsSync(path)) return path;
      }
    }
    return null;
  }

  private extractMessages(data: any): Message[] {
    const messages: Message[] = [];
    const turns = data.messages || data.turns || data.conversation || [];
    if (!Array.isArray(turns)) return messages;

    for (const turn of turns) {
      if (turn.role !== "user" && turn.role !== "assistant") continue;
      messages.push({
        id: turn.id || `oc-${messages.length}`,
        role: turn.role,
        content: typeof turn.content === "string" ? turn.content : JSON.stringify(turn.content || ""),
        timestamp: turn.timestamp || turn.created_at || "",
        model: turn.model || "",
        inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
        toolUses: [], thinkingBlocks: [],
      });
    }
    return messages;
  }

  private parseJsonl(text: string): Message[] {
    const messages: Message[] = [];
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const rec = JSON.parse(line);
        if (rec.role !== "user" && rec.role !== "assistant") continue;
        messages.push({
          id: rec.id || `oc-${messages.length}`,
          role: rec.role,
          content: typeof rec.content === "string" ? rec.content : JSON.stringify(rec.content || ""),
          timestamp: rec.timestamp || "",
          model: rec.model || "",
          inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
          toolUses: [], thinkingBlocks: [],
        });
      } catch { continue; }
    }
    return messages;
  }
}
