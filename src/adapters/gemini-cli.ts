import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { Adapter, Session, Message } from "./types";

export class GeminiCliAdapter implements Adapter {
  id = "gemini-cli";
  name = "Gemini CLI";
  icon = "✦";
  private baseDir: string;

  constructor() {
    this.baseDir = join(homedir(), ".gemini");
  }

  async detect(): Promise<boolean> {
    const tmpDir = join(this.baseDir, "tmp");
    if (!existsSync(tmpDir)) return false;
    try {
      return readdirSync(tmpDir).some(
        (f) => f.startsWith("session-") && f.endsWith(".json")
      );
    } catch {
      return false;
    }
  }

  async sessions(): Promise<Session[]> {
    const sessions: Session[] = [];
    const dirs = [join(this.baseDir, "tmp"), this.baseDir];

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.startsWith("session-") || !file.endsWith(".json")) continue;
        const filePath = join(dir, file);
        try {
          const data = await Bun.file(filePath).json();
          const stat = statSync(filePath);
          const sessionId = basename(file, ".json");

          const messages = this.extractMessages(data);
          let name = "";
          for (const m of messages) {
            if (m.role === "user" && m.content) {
              name = m.content.slice(0, 120).replace(/\n/g, " ");
              break;
            }
          }

          sessions.push({
            id: sessionId,
            name: name || sessionId,
            adapterId: this.id,
            adapterName: this.name,
            createdAt: stat.birthtime.toISOString(),
            updatedAt: stat.mtime.toISOString(),
            durationMs: stat.mtime.getTime() - stat.birthtime.getTime(),
            isActive: Date.now() - stat.mtime.getTime() < 5 * 60 * 1000,
            totalTokens: 0,
            estCost: 0,
            messageCount: messages.length,
            sourcePath: filePath,
            isSubAgent: false,
            metadata: {},
          });
        } catch { continue; }
      }
    }

    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  }

  async messages(sessionId: string): Promise<Message[]> {
    const filePath = this.findSessionFile(sessionId);
    if (!filePath) return [];
    try {
      const data = await Bun.file(filePath).json();
      return this.extractMessages(data);
    } catch {
      return [];
    }
  }

  watchPaths(): string[] {
    const paths: string[] = [];
    const tmpDir = join(this.baseDir, "tmp");
    if (existsSync(tmpDir)) paths.push(tmpDir);
    if (existsSync(this.baseDir)) paths.push(this.baseDir);
    return paths;
  }

  private findSessionFile(sessionId: string): string | null {
    const dirs = [join(this.baseDir, "tmp"), this.baseDir];
    for (const dir of dirs) {
      const path = join(dir, `${sessionId}.json`);
      if (existsSync(path)) return path;
    }
    return null;
  }

  private extractMessages(data: any): Message[] {
    const messages: Message[] = [];
    const turns = data.turns || data.messages || data.conversation || [];
    if (!Array.isArray(turns)) return messages;

    for (const turn of turns) {
      const role = turn.role === "user" ? "user" : "assistant";
      let content = "";

      if (typeof turn.content === "string") {
        content = turn.content;
      } else if (Array.isArray(turn.parts)) {
        content = turn.parts.map((p: any) => p.text || "").join("\n");
      } else if (typeof turn.text === "string") {
        content = turn.text;
      }

      if (content) {
        messages.push({
          id: turn.id || `gemini-${messages.length}`,
          role,
          content,
          timestamp: turn.timestamp || turn.createTime || "",
          model: turn.model || data.model || "",
          inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
          toolUses: [], thinkingBlocks: [],
        });
      }
    }
    return messages;
  }
}
