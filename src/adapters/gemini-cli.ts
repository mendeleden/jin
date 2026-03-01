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
    return this.findSessionFiles().length > 0;
  }

  /** Recursively find all session-*.json files under ~/.gemini/tmp */
  private findSessionFiles(): string[] {
    const files: string[] = [];
    const tmpDir = join(this.baseDir, "tmp");
    if (!existsSync(tmpDir)) return files;
    this.walkForSessions(tmpDir, files, 0);
    return files;
  }

  private walkForSessions(dir: string, out: string[], depth: number): void {
    if (depth > 4) return; // don't recurse too deep
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          this.walkForSessions(join(dir, entry.name), out, depth + 1);
        } else if (entry.name.startsWith("session-") && entry.name.endsWith(".json")) {
          out.push(join(dir, entry.name));
        }
      }
    } catch {}
  }

  async sessions(): Promise<Session[]> {
    const sessions: Session[] = [];
    const sessionFiles = this.findSessionFiles();

    // Also check for session files directly in baseDir (legacy)
    if (existsSync(this.baseDir)) {
      try {
        for (const file of readdirSync(this.baseDir)) {
          if (file.startsWith("session-") && file.endsWith(".json")) {
            sessionFiles.push(join(this.baseDir, file));
          }
        }
      } catch {}
    }

    for (const filePath of sessionFiles) {
      try {
        const data = await Bun.file(filePath).json();
        const stat = statSync(filePath);
        const sessionId = data.sessionId || basename(filePath, ".json");

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
          createdAt: data.startTime || stat.birthtime.toISOString(),
          updatedAt: data.lastUpdated || stat.mtime.toISOString(),
          durationMs: stat.mtime.getTime() - stat.birthtime.getTime(),
          isActive: Date.now() - stat.mtime.getTime() < 5 * 60 * 1000,
          totalTokens: 0,
          estCost: 0,
          messageCount: messages.length,
          sourcePath: filePath,
          isSubAgent: data.kind === "subagent",
          parentSessionId: "",
          isCompacted: false,
          metadata: {},
        });
      } catch { continue; }
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
    // Search all session files for matching sessionId
    for (const filePath of this.findSessionFiles()) {
      const fileName = basename(filePath, ".json");
      if (fileName === sessionId || filePath.includes(sessionId)) return filePath;
    }
    // Also check legacy locations
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
      // Gemini uses "type": "user"/"model", older format uses "role"
      const rawRole = turn.role || turn.type || "";
      const role = rawRole === "model" ? "assistant" : rawRole === "user" ? "user" : "assistant";
      let content = "";

      if (typeof turn.content === "string") {
        content = turn.content;
      } else if (Array.isArray(turn.content)) {
        // Gemini format: content is array of {text: "..."} objects
        content = turn.content.map((p: any) => p.text || "").filter(Boolean).join("\n");
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
          recordType: "",
        });
      }
    }
    return messages;
  }
}
