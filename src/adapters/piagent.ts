import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { Adapter, Session, Message } from "./types";

export class PiAgentAdapter implements Adapter {
  id = "piagent";
  name = "PiAgent";
  icon = "Π";
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = join(homedir(), ".pi", "agent", "sessions");
  }

  async detect(): Promise<boolean> {
    if (!existsSync(this.sessionsDir)) return false;
    return readdirSync(this.sessionsDir).some((f) => f.endsWith(".jsonl"));
  }

  async sessions(): Promise<Session[]> {
    if (!existsSync(this.sessionsDir)) return [];
    const sessions: Session[] = [];

    for (const file of readdirSync(this.sessionsDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(this.sessionsDir, file);
      try {
        const meta = await this.parseMeta(filePath);
        if (!meta || meta.msgCount === 0) continue;
        const stat = statSync(filePath);

        sessions.push({
          id: meta.id,
          name: meta.name || meta.id.slice(0, 8),
          adapterId: this.id,
          adapterName: this.name,
          createdAt: meta.firstMsg,
          updatedAt: meta.lastMsg,
          durationMs: new Date(meta.lastMsg).getTime() - new Date(meta.firstMsg).getTime(),
          isActive: Date.now() - new Date(meta.lastMsg).getTime() < 5 * 60 * 1000,
          totalTokens: 0,
          estCost: 0,
          messageCount: meta.msgCount,
          sourcePath: filePath,
          isSubAgent: false,
          parentSessionId: "",
          isCompacted: false,
          metadata: { fileSize: stat.size },
        });
      } catch { continue; }
    }

    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sessions;
  }

  async messages(sessionId: string): Promise<Message[]> {
    const filePath = this.findFile(sessionId);
    if (!filePath) return [];
    return this.parseMessages(filePath);
  }

  watchPaths(): string[] {
    return existsSync(this.sessionsDir) ? [this.sessionsDir] : [];
  }

  private findFile(sessionId: string): string | null {
    if (!existsSync(this.sessionsDir)) return null;
    for (const f of readdirSync(this.sessionsDir)) {
      if (f.includes(sessionId)) return join(this.sessionsDir, f);
    }
    return null;
  }

  private async parseMeta(filePath: string) {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter(Boolean);
    let id = basename(filePath, ".jsonl");
    let firstMsg = "";
    let lastMsg = "";
    let msgCount = 0;
    let firstUserMessage = "";

    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec.session_id || rec.id) id = rec.session_id || rec.id;
        if (rec.timestamp) {
          if (!firstMsg) firstMsg = rec.timestamp;
          lastMsg = rec.timestamp;
        }
        if (rec.role === "user" || rec.role === "assistant" || rec.type === "user" || rec.type === "assistant") {
          msgCount++;
          if ((rec.role === "user" || rec.type === "user") && !firstUserMessage) {
            const content = rec.content || rec.message?.content || "";
            firstUserMessage = (typeof content === "string" ? content : "").slice(0, 120);
          }
        }
      } catch { continue; }
    }

    return {
      id,
      name: firstUserMessage.replace(/\n/g, " ") || id.slice(0, 8),
      firstMsg: firstMsg || new Date().toISOString(),
      lastMsg: lastMsg || new Date().toISOString(),
      msgCount,
    };
  }

  private async parseMessages(filePath: string): Promise<Message[]> {
    const text = await Bun.file(filePath).text();
    const messages: Message[] = [];

    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const rec = JSON.parse(line);
        const role = rec.role || rec.type;
        if (role !== "user" && role !== "assistant") continue;

        const content = rec.content || rec.message?.content || "";
        messages.push({
          id: rec.uuid || rec.id || `piagent-${messages.length}`,
          role: role as "user" | "assistant",
          content: typeof content === "string" ? content : JSON.stringify(content),
          timestamp: rec.timestamp || "",
          model: rec.model || rec.message?.model || "",
          inputTokens: rec.usage?.input_tokens || 0,
          outputTokens: rec.usage?.output_tokens || 0,
          cacheRead: 0, cacheWrite: 0,
          toolUses: [], thinkingBlocks: [],
          recordType: "",
        });
      } catch { continue; }
    }
    return messages;
  }
}
